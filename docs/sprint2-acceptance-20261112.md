# Sprint 2 验收记录：TLS、断线重连与 Quarantined

日期：2026-11-12（Asia/Shanghai）  
远端节点：`d1n41a25g01`，Xterminal server id `6acf46e5c094fd2d65a23d28`  
实验 GPU：GPU2，UUID `GPU-524bcc1c-f383-b658-a36d-983fa7efc56c`

## 本轮实现

- Controller 支持可选 TLS；配置 `--tls-client-ca` 时要求客户端证书，形成 mTLS。Agent 支持 CA、客户端证书、私钥和 TLS domain 参数。
- Agent 使用有界重连退避（250ms 起，最多 5s）。连接关闭会先把自己的执行 scope 停掉，等待 active task 结束，再建立下一条会话。
- Controller 为每个 Agent 分配 session_id。新 Hello 会回收该 Agent 的 leased/running 任务；旧会话的消息和 unregister 不会修改新会话。
- AgentHello/AgentHeartbeat 携带 `AgentHealth`。NVML 初始化、inventory、snapshot 或 Claim 读取失败时进入 `AGENT_QUARANTINED`，Controller 调度器跳过隔离 Agent。
- ResultCommit 使用流式 SHA-256，单文件上限 64 GiB，并检查文件在摘要期间没有变化。

## 本地门禁

以下命令均通过，0 warning、0 error：

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

workspace 共 21 个单元测试通过：Agent 4、Controller 7、Core 10；protocol crate 没有独立单元测试。

## 远端 TLS/mTLS 闭环

远端使用本项目目录下生成的短期 CA、server certificate 和 client certificate，证书只用于本次 smoke，没有写入系统信任库。最终版本复核使用独立端口 `50072`，Agent 通过 `https://localhost:50072` 建立 mTLS stream。

随后提交 `sprint02-final-clean-true` 到 GPU2，Controller 最终记录为：

```text
sprint02-final-clean-true succeeded GPU-524bcc1c-f383-b658-a36d-983fa7efc56c /bin/true
```

GPU2 在任务前后均为 2 MiB，没有残留 scope 或本项目进程。远端构建的 ELF SHA-256：

```text
Agent      3287b72d6febc87177270d4c3c59f6b0b5cfdc72b0987c737f6b882f283206a0
Controller 5dd5b15bee8eb834c16f99ade04ebb14970d163f1c9ba0b9143bea2a6131e054
```

## 最终版本远端 smoke：断线清理与重连复用

同一端口 `50072`、同一 mTLS 证书和独立 DB `sprint02-final-clean.sqlite3` 下，提交
`sprint02-final-clean-cuda` 运行 `/usr/bin/env CUDA_VISIBLE_DEVICES=2 cuda_hold`。任务运行时
GPU2 为 683 MiB，自有进程使用约 672 MiB。

只停止本次创建的 Controller 后，Agent 保持运行并进入有界重连；约 4 秒后 GPU2 回到 2 MiB，
自有任务进程和 `gpu-scavenger-sprint02-final-clean-cuda-*.scope` 均为空。随后在 Controller
停止期间激活本地 Claim，重启同一 DB 的 Controller，Agent 重新建立 ESTABLISHED TLS 连接。
新的 Hello 将任务回收到 `queued`（`lease_epoch=1`、`agent_id` 为空），数据库事件仍只有一条
`TaskEventStarted`；GPU2 保持 2 MiB，没有再次启动任务。

## 断线、HardStop 与租约回收

使用端口 `50069` 和独立 SQLite DB。任务 `sprint02-reconnect2-cuda` 运行 `/usr/bin/env CUDA_VISIBLE_DEVICES=2 cuda_hold`，断线前状态为 `running`，GPU2 为 683 MiB，NVML 报告的自有进程使用约 672 MiB。

只停止本次创建的 Controller 后，Agent 日志出现 stream 断开和连接拒绝重试；Agent 自己的 scope 被 HardStop，GPU2 在约 3 秒检查点回到 2 MiB，cgroup scope 为空。此时数据库仍暂存 `running`，事件表只有 Started，说明旧连接没有伪造 Stop/Release 事件。

随后激活本地 Claim、重启同一端口和 DB 的 Controller。Agent 重新建立 ESTABLISHED TLS 连接；新的 Hello 触发 `requeue_agent_tasks`，任务最终为 `queued`、`lease_epoch=1`、`agent_id` 为空，事件表仍只有 Started。GPU2 保持 2 MiB。

## Quarantined 运行态

为不触碰宿主 NVML，测试在 `/root/gpu-scavenger-mvp-run-20261112/fake-nvml-sprint02/` 下编译了只返回 `NVML_ERROR_DRIVER_NOT_LOADED` 的假 NVML 动态库，并通过本项目 Agent 的 `LD_LIBRARY_PATH` 注入。Controller 使用同一 mTLS 配置，端口 `50070`。

隔离 Agent 能保持进程并完成控制连接，但不会领取任务。提交 `sprint02-quarantine-task` 后，Controller 数据库保持：

```text
sprint02-quarantine-task queued GPU-524bcc1c-f383-b658-a36d-983fa7efc56c /bin/true
```

该 DB 没有 TaskEvent，GPU2 保持 2 MiB；这验证了 Agent 健康态上报与 Controller Quarantined 调度门禁。假库只在本项目运行目录中使用，未替换宿主库、驱动或系统服务。

## 安全与清理

最终检查确认没有本项目 Agent、Controller、systemd scope 或 Claim 残留，GPU2 为 2 MiB。远端保留 `/root/gpu-scavenger-mvp-run-20261112/` 中的最终二进制、独立 DB、日志、公开证书和测试 helper；临时源码、vendor、私有 rustup/cargo、压缩包和私钥均已删除。

只读 GPU 进程快照仍包含其他任务的外部 PID（包括 PID `2597197`、约 21774 MiB 的进程，以及两个约 69704 MiB 的进程）。本轮没有对这些 GPU、PID、Claim 或驱动执行操作。

## 尚未交付

本轮没有实现 enrollment token/凭证轮换、完整 command sequence、Degraded 指标链路、容器 runner 矩阵、MIG 资源调度、多节点恢复、Stateful checkpoint 或 artifact 存储协议。TLS 证书仅用于验收，生产部署仍需要正式 PKI 和 enrollment 流程。
