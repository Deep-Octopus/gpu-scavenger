# GPU Scavenger

GPU Scavenger 是面向共享 Linux/NVIDIA 服务器的主机优先 GPU 控制平面。
它提供持久任务队列、能力感知调度、显式任务所有权、Web 控制台和 macOS/Windows
原生桌面壳，同时避免接管并非由 Agent 创建的进程或 GPU。

[English README](README.md) · [设计文档](gpu_scavenger.md) · [Release](https://github.com/Deep-Octopus/gpu-scavenger/releases)

> **当前状态：MVP。** 已验证的调度边界是 Linux x86_64、NVIDIA NVML、cgroup
> v2 和 systemd scope。适合受控评估和内部 GPU 池，1.0 之前 API 和默认配置
> 可能变化。

## 运行位置

Controller 和 Agent 运行在 GPU 服务器；Mac 只运行操作界面：

```text
MacBook                 GPU 服务器
Tauri .app ──SSH 隧道──> Controller Web :18081
                           Controller gRPC :50051
                           Agent + NVIDIA GPU
```

## 直接安装 Linux 预编译包

从 [Releases](https://github.com/Deep-Octopus/gpu-scavenger/releases) 下载
`gpu-scavenger-linux-x86_64-0.1.0.tar.gz`，在 Linux x86_64 NVIDIA 主机执行：

```bash
tar -xzf gpu-scavenger-linux-x86_64-0.1.0.tar.gz
cd gpu-scavenger-linux-x86_64-0.1.0
./install.sh --prefix /share/gpu-scavenger
cd /share/gpu-scavenger
./scripts/start.sh
./scripts/status.sh
```

安装包已经包含 Controller、Agent、配置模板、SHA256 校验和以及
`start/status/stop/uninstall` 脚本，不需要在目标服务器安装 Rust、Cargo 或
Docker，也不会写入 systemd 全局服务。根分区空间紧张时，把前缀放到
`/share`。

修改配置：

```bash
vi /share/gpu-scavenger/etc/scavenger.env.local
```

默认 Web 和 gRPC 监听都绑定回环地址。远程访问优先使用 SSH 隧道：

```bash
ssh -N -L 18082:127.0.0.1:18081 <user>@<gpu-server>
```

## Mac 桌面端

桌面端只是操作界面，GPU 任务仍由服务器 Agent 执行。v0.1.0 Release 同时提供
macOS Apple Silicon `.app` 和 Windows x64 的 `.msi`/NSIS 安装包。通过转发端口
连接远端 Controller：

```bash
open -n "GPU Scavenger.app" --args \
  --controller-url http://127.0.0.1:18082
```

Windows 安装后，在 PowerShell 中启动同一个远端控制台：

```powershell
ssh -N -L 18082:127.0.0.1:18081 <user>@<gpu-server>
```

然后给 GPU Scavenger 添加参数 `--controller-url
http://127.0.0.1:18082`。Windows 端不会在本机探测或运行 GPU 任务。

## 从源码运行

```bash
cargo run -p scavenger-controller -- serve \
  --db /tmp/gpu-scavenger/controller.sqlite3 \
  --listen 127.0.0.1:50051 \
  --web-listen 127.0.0.1:18080

cargo run -p scavenger-agent -- probe
cargo run -p scavenger-agent -- run \
  --controller http://127.0.0.1:50051 \
  --claim-path /tmp/gpu-scavenger/claim
```

不满足 Linux/NVIDIA/systemd 边界的主机会报告 `schedulable=false` 并拒绝
接收任务。默认任务策略是 `stateless`；checkpointed 协议见
[`gpu_scavenger.md`](gpu_scavenger.md)。

## 安全边界

- Agent 只管理自己创建的 scope 和进程；
- Host Claim 会停止新任务，并在释放验证后才报告 GPU 可用；
- 进程身份、隔离边界或健康状态不确定时 fail closed；
- 默认监听为 loopback，跨主机访问使用 SSH 隧道或 TLS/mTLS；
- 停止和卸载脚本会校验 PID 文件和二进制路径，不按模糊 PID 清理。

## 文档与验证

- [完整设计与支持矩阵](gpu_scavenger.md)
- [Sprint 0/1 真实边界验收](docs/sprint0-sprint1-acceptance-20261112.md)
- [Sprint 2 TLS/重连验收](docs/sprint2-acceptance-20261112.md)
- [Sprint 3/4 checkpoint/UI 验收](docs/sprint3-sprint4-acceptance-20261112.md)
- [Linux 包说明](packaging/linux/README.md)

## 许可证

GPU Scavenger 采用 Apache-2.0 或 MIT 双许可证，按你的选择使用。详见
[`LICENSE-APACHE`](LICENSE-APACHE) 和 [`LICENSE-MIT`](LICENSE-MIT)。
