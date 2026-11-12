# Sprint 3/4 验收记录：Checkpoint、能力边界与 Web 控制台

日期：2026-11-12（Asia/Shanghai）  
远端节点：`d1n41a25g01`，Xterminal server id `6acf46e5c094fd2d65a23d28`  
实验 GPU：GPU2，UUID `GPU-524bcc1c-f383-b658-a36d-983fa7efc56c`

## 本轮实现

- `CheckpointRequest` / `CheckpointAck` 使用 task、lease、command sequence、路径、大小和 SHA-256 digest 关联；Controller 以 `(task_id, lease_epoch)` 幂等记录 checkpoint。
- Linux systemd scope runner 将 checkpoint 请求限定在 Agent 自己的 scope，任务 helper 通过 `GPU_SCAVENGER_CHECKPOINT_PATH` 写临时文件并原子 rename。
- Claim 触发后，Checkpointed 任务先等待非空 checkpoint 文件并提交 ACK，再 HardStop 自有 scope；释放验证通过后任务回到 queued。
- Agent 握手报告 OS、架构、GPU 后端、隔离边界、checkpoint/MIG 能力和 schedulable 标志；Controller 对 `schedulable=false` 的 Agent 停止调度。
- 本地 Web 控制台提供 `/api/status` 和 `/api/tasks`，展示任务指标、Agent 健康、能力边界和 task ledger，并处理加载、空态、错误态和 reduced-motion。

## 本地门禁

以下命令均通过，0 warning、0 error：

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

workspace 共 21 个单元测试通过：Agent 4、Controller 7、Core 10；没有新增只为覆盖胶水代码的测试。

## 远端能力报告与 Web API

远端启动使用独立 mTLS 证书、独立 SQLite DB、gRPC 端口 `50073` 和 Web 端口 `18081`。Agent 连接后 `/api/status` 报告：

```json
{
  "operating_system": "linux",
  "architecture": "x86_64",
  "gpu_backend": "nvidia-nvml",
  "isolation": "systemd-cgroup-v2",
  "checkpoint": "sigusr1-file-ack",
  "mig": "observed-only",
  "schedulable": true
}
```

页面 POST `/api/tasks` 成功创建 `sprint24-checkpoint`，随后 ledger 观察到 `queued -> running`；表单只接受有界 task id、参数数量和显式 stateless/checkpointed 策略。

## enrollment 与 token 轮换

- 使用错误 token 的临时 Agent 被 Controller 以 `PermissionDenied: enrollment token is invalid` 拒绝，未进入 agents 列表。
- 替换同一 token 文件后重启本次 Controller；使用新 token 的 `sprint24-rotated` Agent 成功建立 session，且由于本地 Claim 保持 active 没有领取任务。
- token、私钥和证书只存在于本次独立 smoke 目录，未写入仓库或日志正文。

## Checkpoint 远端闭环

1. GPU2 只读基线为 2 MiB，且无计算进程。
2. `sprint24-checkpoint` 使用本项目 `tools/checkpoint_hold.cu`，在自有 scope 中分配 256 MiB；运行态 NVML 观察为 683 MiB、helper PID 仅属于该 scope。
3. 激活本地 Claim 后，helper 收到 SIGUSR1，生成 37-byte checkpoint；Controller `task_checkpoints` 记录 digest：

   ```text
   955c8546a667208174c57777850f01633acb3a055dc01af53d2d94cdfd2d7055
   ```

4. 事件顺序为 `Started -> Checkpointed -> ReleaseVerified`，任务最终为 `queued`、`lease_epoch=1`；没有提交成功结果。
5. scope 消失后 GPU2 回到 2 MiB，NVML 不再报告本次 helper PID。

## 远端构建与清理

源码和 vendored 依赖先在本机打包，再上传到 `/root/gpu-scavenger-sprint24-20261112/` 专用目录；Rust 1.97.1 仅安装在该目录，release build 使用 `--offline` 完成。最终 Controller 二进制 SHA-256：

```text
70c3c9ab1f2739ee80d6c5fd0205fc9eddcd950f83b4e345c9fadce53d2484ef
```

Agent 二进制 SHA-256：

```text
00c49e2e40625d096010aa9fbc806711ac21eff99c9e2e82cf02ba51b2d4783b
```

验收结束后只停止和删除本次创建的 Agent、Controller、scope、Claim、临时证书、token、checkpoint、源码包和临时 Rust 目录；没有终止外部 PID、重置 GPU、改动系统服务或 Docker 配置。最终 GPU2 只读复核仍为 2 MiB。

## TLS 证书轮换

在同一节点的独立目录和端口 `50074` / `18082` 上完成第二次 smoke：

- 轮换前 Controller 证书指纹为 `53:58:E4:50:99:CF:AD:6A:DD:5A:48:21:1B:8B:54:9F:F7:95:9F:9A:61:96:8F:81:74:C4:32:2E:D7:E8:14:BE`；原子替换证书和私钥后发送 `SIGHUP`。
- 轮换后新连接读到指纹 `00:90:BE:D0:6F:DD:65:B2:6A:04:DD:23:2C:CE:F3:30:BF:3C:73:B2:5A:A9:1E:EA:11:1C:45:10:E2:B0:16:43`；`sprint24-reload-agent3` 以新证书建立 session 2，能力报告为 Linux/NVIDIA、`schedulable=true`。
- 该实现只替换监听任务并重新读取证书文件，不强制结束已有 gRPC 长连接；旧 session 保持到正常断线或 Agent 自行重连，避免证书轮换误杀正在运行的任务。
- 本次轮换使用的 Controller 二进制 SHA-256 为 `741d1b824cb5b20107a6687f13bf0aa6558d04f55af095b67606489854974b3c`，Agent 二进制 SHA-256 为 `667b0e0c759b0194aae5c7630ca26c8e376bfb384b9038707607e6f2807a292a`。
- 轮换 smoke 结束后已停止并删除本次创建的进程、证书、源码包和临时目录；GPU2 复核为 2 MiB、MIG Disabled、无计算进程，端口已关闭。

## 支持边界

已验证：Linux x86_64、NVIDIA NVML、systemd scope、cgroup v2、MIG Disabled 下的 identity 观测、checkpoint helper 和 Web API。  
未验证且当前 fail-closed：Windows Job Object、AMD/ROCm、MIG 资源切分调度、Tauri 原生壳、多 Master、生产 artifact 存储和任意第三方训练框架恢复兼容性。
