# Sprint 0/1 验收记录：Linux/NVIDIA stateless 闭环

日期：2026-11-12（Asia/Shanghai）  
远端节点：`d1n41a25g01`  通过 Xterminal server id `6acf46e5c094fd2d65a23d28`

## 范围

本记录只覆盖 Linux x86_64、NVIDIA NVML、cgroup v2、systemd scope、SQLite WAL 和 stateless TaskShard。远端实验使用 GPU2：`GPU-524bcc1c-f383-b658-a36d-983fa7efc56c`。没有操作其他 GPU 的任务，也没有执行 GPU reset、驱动重载、全局 Docker 清理、系统服务修改或外部 PID 终止。

## 本地实现与门禁

- `scavenger-core` 新增纯函数 ReleaseVerifier：cgroup 为空、Agent 自有 GPU 进程数为零、显存回到任务启动基线 ±64 MiB，并连续满足 2 次才通过；最多 40 次、每次 50ms。
- Agent 记录确定性的 `TaskEvent.event_id` 和 `ResultCommit.event_id`。Controller 对同一 `task_id + lease_epoch` 的完全相同结果重复提交返回成功，元数据冲突返回错误；成功事件在结果提交缺失时被拒绝。
- Controller 调度器按稳定 Agent ID 做 round-robin，跳过 busy、Claim active 和有进程的设备；所有 Agent/Controller channel 容量为 32。
- NVML 错误映射到 `PermissionDenied`、`DriverUnavailable`、`NotSupported` 和 `Transient`；GPU snapshot 保存 GPU instance / compute instance identity。
- 修复短命令竞态：scope 在 ControlGroup 路径可见前已经退出时，Agent 以空 scope 继续读取退出码和结果，不把正常短任务当成启动失败。
- 门禁命令全部通过：
  - `cargo fmt --all -- --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo test --workspace`
- Sprint 1 收尾时 workspace 单元测试共 21 个通过：Agent 4、Controller 7、Core 10；没有失败、忽略或警告。
- 远端最终 ELF 在主机上重新构建，便于链接宿主 glibc；Agent SHA-256 为 `560180945d04c94050e99d47e16e4c28f9eba31b7c83817bece3a5bc831b6dc1`，Controller SHA-256 为 `433e25bfb9ca90fbd5c6017154f814c3c9bdfc9da50647d0cabeb3a763c10d09`。

## 远端支持矩阵边界

- 主机：Linux 5.15.0-119-generic，cgroup `cgroup2fs`。
- GPU：8 张 NVIDIA A800-SXM4-80GB，驱动 `580.105.08`。
- GPU2 在实验前为空闲，`nvidia-smi` 显示 2 MiB；MIG 当前/待生效状态均为 `Disabled`。
- NVML 只读探针观察到 Compute、Graphics 和空闲设备；GPU2 在实验过程中没有外部进程。
- 以 `nobody` 运行只读探针仍获得 NVML 读取权限，因此本机没有产生真实权限拒绝样本；权限错误分类由本地 NVML 映射测试覆盖，没有通过改权限制造样本。

## 真实边界结果

### Claim、CUDA hold、ReleaseVerifier

任务：`sprint01-cuda-release-3`。scope：`gpu-scavenger-sprint01-cuda-release-3-1.scope`。程序是本次构建的 256 MiB CUDA hold helper，日志记录了自有 PID `1880836`。

- Claim 前 GPU2 观测到 683 MiB 显存占用。
- Claim 激活到 scope 消失：339ms。
- Claim 激活到 GPU2 回到 2 MiB：472ms。
- ReleaseVerifier 通过后 Controller 状态为 `queued`，说明未提交的 stateless 分片可安全重排。
- 初始全机快照为 GPU0/1/2/3/4/5/6/7=`69735/69717/2/2/2/2/74441/2 MiB`；测试结束 GPU2 为 2 MiB，最终快照为 `69735/69717/2/2/2/2/2/2 MiB`。GPU6 在会话期间由外部环境从 74441 MiB 变为 2 MiB；本次只对 GPU2 做任务、Claim 和 scope 操作，没有对 GPU6 执行写操作、任务启动、PID 终止或驱动变更，因此不把 GPU6 的外部变化归因于本项目。

### fork/setsid cgroup 回收

任务：`sprint01-fork-setsid`。scope：`gpu-scavenger-sprint01-fork-setsid-1.scope`。helper 在同一 scope 中创建 parent PID `1736151` 和调用 `setsid()` 的 child PID `1736155`；scope 的 `cgroup.procs` 同时列出两个 PID。

Claim 激活到 scope 消失为 328ms。scope 消失后两个 `/proc/<pid>` 均不存在，Controller 在事件处理完成后将任务保持为 `queued`。整个回收过程只作用于该自有 scope。

### 短命令与幂等结果提交

任务：`sprint01-write-result-2`。helper 写出 21 bytes 到本次测试目录，Agent 先发送 ResultCommit，再发送 Succeeded 事件；Controller 最终显示：

```text
sprint01-write-result-2 succeeded GPU-524bcc1c-f383-b658-a36d-983fa7efc56c /root/gpu-scavenger-mvp-run-20261112/write_result
```

scope 已回收，GPU2 最终为 2 MiB。重复提交和冲突提交的精确行为由 Controller 的 SQLite 单元测试覆盖；结果文件现在使用受大小上限保护的流式 SHA-256 摘要，不再使用空 digest。

最终二进制 smoke（`final-smoke2-cuda`）再次完成完整闭环：Claim 前 GPU2 为 683 MiB，Claim 到 scope 消失 347ms，Claim 到 GPU2 回到 2 MiB 为 470ms，Controller 状态为 `queued`。该次使用了独立端口 `50060`、独立 DB 和 Claim 文件，结束后自有进程、scope 和 Claim 均清理。

## 多 Agent 调度验收

本地 Controller 测试注册两个 Agent、两个空闲设备和两个任务，验证第一轮分配到 Agent A、第二轮分配到 Agent B，且不会生成重复 lease。远端只使用 GPU2，未为了“多 Agent”占用其他共享 GPU，因此没有宣称多节点故障恢复。

## 清理与限制

测试结束后只停止了本次创建的 Controller、Agent 和 systemd scope；活动自有 scope、Agent 进程、Claim 文件和 GPU2 外部进程均为空。远端保留 `/root/gpu-scavenger-mvp-run-20261112/` 作为可审计日志、DB、helper 和二进制证据，临时源码构建目录和私有 rustup 目录在记录完成后删除。smoke 期间 GPU3 出现了外部 PID `2597197`、约 21774 MiB 的占用；本项目没有对 GPU3 执行任务、Claim、PID 或驱动操作，后续记录不把它归因于本项目。

Sprint 2 的 TLS/mTLS、断线重连、旧会话隔离、租约回收和 Quarantined 调度门禁已在独立记录中完成；本记录保留为 Sprint 0/1 的历史边界证据。仍未交付：enrollment token/凭证轮换、完整 command sequence、Degraded 指标链路、容器 runner 矩阵、MIG 资源调度、多节点恢复、Stateful checkpoint 和 artifact 存储协议。

Sprint 2 远端验收见 [`docs/sprint2-acceptance-20261112.md`](sprint2-acceptance-20261112.md)。
