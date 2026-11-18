# GPU Scavenger 参赛材料包 · 技术卷

配套文件：[`tianchi-post.md`](tianchi-post.md)（帖子正文）·
[`pitch.md`](pitch.md)（答辩话术）· [`metrics-sources.md`](metrics-sources.md)（数字口径）·
[`shots/desktop/`](shots/desktop/)（30 张站点与演练台取证图）

线上作品：**https://gpu-scavenger-iaocj0wm9oa.qoder.zone**
开源仓库：**https://github.com/Deep-Octopus/gpu-scavenger**（Apache-2.0 / MIT）
赛道：StudyHack 学习科研 · 提交截止 2026-11-30 18:00

---

## 1. 核心价值摘要

**一句话**：让共享 GPU 上"敢借"和"还得回"同时成立——空闲卡全速接活，宿主归来 472ms 内确定性还卡，且回收作用域只覆盖代理自己启动的任务。

**为谁解决**：高校实验室、AIGC 工作室、拥有多台散装工作站的小团队。机器主人愿意贡献闲时算力，
但不愿把机器交给 K8s/Slurm，也不愿别人在自己卡上留下清不干净的显存。

**为什么是现在、为什么不是现有方案**：

| 现有做法 | 卡在哪 | GPU Scavenger 的回应 |
| --- | --- | --- |
| K8s device plugin / Slurm | 要求纳管节点、改提交方式、专人运维 | 零侵入：不改训练代码、不上编排、单包 5.95 MB，节点只需能主动出站 |
| 手动 `CUDA_VISIBLE_DEVICES` 抢空闲卡 | 谁都不敢用别人的卡，还卡时靠 `kill -9` 赌运气 | Claim 触发 → 自有 scope 精确驱逐 → 显存回基线双采样确认 |
| 按进程名清理 | `python`/`torchrun`/`vllm` 名字撞车，误杀宿主进程即事故 | 七元组身份门禁，对不上就只读观测、不下发终止 |
| "进程退出即视为释放" | CUDA context / 显存残留，下个任务撞脏显存 | `ReleaseVerified` 独立状态，与进程退出解耦 |

**已兑现的量化承诺**（全部可回溯到 `docs/` 三份验收记录，见 `metrics-sources.md`）：
Claim→显存归零 **472ms**（复测 470ms）· Claim→自有 scope 消失 **339 / 328 / 347ms** ·
判据 **±64 MiB + 连续 2 次采样 @50ms（上限 40 次）** ·
**5 workspace 成员 / 4,992 行 Rust / 0 unsafe / 21 个单元测试 / fmt+clippy(-D warnings) 全清**。

---

## 2. 技术架构与实现方案

### 2.1 分层与模块边界

```
L0  scavenger-core          纯状态机 + ReleaseVerifier + 身份七元组 + 策略    零 I/O，可单测，可被演练台复用
L1  scavenger-protocol      control.proto：一条 Agent 主动出站的 gRPC 双向流   全系统唯一跨节点契约面
L2  scavenger-agent         NVML 探针 / systemd scope+cgroup v2 / runner / checkpoint / 本地 Claim
L3  scavenger-controller    SQLite WAL 持久队列 / round-robin 调度 / 会话与租约 / 幂等结果提交
L4  apps/scavenger-desktop  Tauri 控制台，复用同一 Web UI，可 --controller-url 连远端
```

不可协商的边界只有一条：**跨节点语义只允许出现在 L1**。L0 不碰 I/O，所以同一份释放判据代码同时服务于
真机、单元测试和浏览器演练台——页面上的 472ms 不是演示特效，是 L0 判据的实测落点。

### 2.2 任务生命周期

`TaskState`（`crates/scavenger-core/src/state.rs:4`）：
`Queued → Leased → Running → Stopping → { Succeeded | Failed | Requeued | Quarantined }`

`NodeState`：`Ready | Degraded | Quarantined | Disconnected`——探针连续暂态失败进 `Degraded`，
边界失败进 `Quarantined`，Controller 对两种非 Ready 状态**一律停止调度**（fail-closed）。

抢占链路（实测时序）：

1. `ExplicitClaim`（主人点按钮 / 落 claim 文件）或 `ObservedExternal`（只读探针看到外部占用）→ 停止领取新任务；
2. 下发 HardStop / CheckpointRequest → stateless 分片直接停，checkpointed 分片先 `SIGUSR1` 落盘 + `CheckpointAck`（带 SHA-256）；
3. 自有 systemd scope 清空：**339ms**（派生进程树 328ms）；
4. ReleaseVerifier 三项判据连续两次满足 → 签发 `ReleaseVerified`：**472ms**；
5. 未提交结果的分片以 `lease_epoch` 复位回 `Queued`，至少一次语义 + 幂等提交避免重复写入。

### 2.3 身份与隔离：为什么不会误伤

七元组 = `task_id + lease_epoch + pid + process_start_time + uid + cgroup_id + device_uuid`。
`pid` 单独不可信（会被复用），所以叠加 `process_start_time`；`cgroup_id` 保证驱逐作用域是内核级边界，
`fork` + `setsid()` 逃管子进程仍在同一 `cgroup.procs` 里被一并回收。任何一项对不上的进程**只进入只读观测**，
控制面永远不给它发终止指令。

### 2.4 网络与一致性

- 节点**主动出站**建立 TLS/mTLS gRPC 长连接，不要求开放入站端口，NAT 与内网防火墙天然穿透；
- `AgentHello` 携带 enrollment token + 能力报告（OS/架构/GPU 后端/隔离边界/checkpoint/MIG/`schedulable`）；
  `schedulable=false` 的 Agent 被调度器跳过，不做降级猜测；
- `command_seq` 单调递增做命令去重，`session_id` 隔离会话：新 `Hello` 回收该 Agent 的 leased/running 任务，
  旧会话的消息与 unregister 不会污染新会话；
- 有界重连退避 250ms → 5s 上限；连接关闭时先停掉自己的执行 scope，再建下一条会话；
- 所有 Agent/Controller channel 容量固定 32，禁止无界队列；
- 结果文件用受上限保护的**流式 SHA-256**（单文件 64 GiB），并校验摘要期间文件未变。

### 2.5 工程规范

TigerStyle + fail-closed：0 unsafe、0 panic 终止路径、无向外部进程下发信号的回退分支。
`cargo fmt --all -- --check` / `cargo clippy --workspace --all-targets -- -D warnings` / `cargo test --workspace`
为提交门禁，三份验收记录均记录 0 warning 0 error。

---

## 3. 核心创新点提炼

**创新点 1｜把"释放"从一次性动作改成可验证状态。**
社区惯例是"进程退出 = 卡可用"。我们把 `ReleaseVerified` 做成独立状态，判据是三项物理指标
（cgroup 空 + 自有 GPU 进程为零 + 显存回基线 ±64 MiB）且**连续两次采样**满足。
这是宿主敢把卡借出去的前提，也是整个产品契约的地基。

**创新点 2｜宿主优先不是策略开关，而是身份门禁的必然结果。**
"只驱逐自己启动的进程"如果靠配置约定就不可信。七元组把它变成内核级判定：
`cgroup_id` 划定作用域，`process_start_time` 防 PID 复用，任何不匹配一律只读。
真机里连逃管子进程都被完整回收，且全程没有触碰外部 PID。

**创新点 3｜控制面出站、零入站、零纳管。**
反向 gRPC 流 + enrollment token + 能力协商，使"贡献一张闲卡"的成本降到装一个 5.95 MB 单包，
不需要节点改网络、不需要集群管理员、不需要改训练脚本。这是它能进实验室而不是只进数据中心的原因。

**创新点 4｜能力上报驱动的 fail-closed 调度。**
不支持的平台（Windows Job Object / ROCm / MIG 切分）不是"降级运行"，而是 `schedulable=false` 让调度器跳过。
宁可少借一张卡，也不在没验证过的边界上赌宿主的安全。

**创新点 5｜同一份判据代码同时服务真机、单测与浏览器演练台。**
L0 零 I/O，演练台直接复用其状态机与释放逻辑。评委在浏览器里按下的 Claim 与真机上跑的是同一套判据语义，
这既是可演示性，也是"页面数字不是特效"的自证。

---

## 4. 功能演示说明

### 4.1 30 秒零环境演示（推荐评委走这条）

打开作品链接 → 第 06 节「8 × A800 弹性抢占演练台」→ 点 **「4 卡并发 + 宿主 472ms 抢占」**：

| 阶段 | 看点 | 取证图 |
| --- | --- | --- |
| 分配 | 5 张空闲卡被并发填上分片，3 张 🔒 宿主卡水位不变 | `play-running.png` |
| 抢占 | 激活 Claim，`scope.empty` → `release.verified` → `release.total` → `task.requeue` 逐条点亮 | `play-released.png` |
| 联动 | 右侧事件名可点击，跳转并在第 07 节状态机里点亮同一跳 | `machine-path.png` |
| 故障 | 「注入 NVML 失败」→ Degraded/Quarantined 停调度；「断开 Controller」→ 有界重连自愈 | `play-faults.png` |
| 硬件 | 第 05 节把 SXM 模组拖成爆炸视图：冷板/中介层/die/HBM 叠层，抬起模组露出插座笼 | `hardware-explode.png` |

### 4.2 真机演示要点（路演用）

复现路径见 `docs/sprint0-sprint1-acceptance-20261112.md`：
`tools/cuda_hold.cu`（256 MiB 占用）+ `tools/fork_setsid_hold.c`（派生树）+ 独立端口/DB/claim 文件，
每轮记录二进制 SHA-256 与事件顺序。可现场展示的硬指标是 Claim→scope 消失、Claim→显存回 2 MiB 两段计时。

### 4.3 演示注意事项

- 演练台数字是**注入的演示场景**，页面已标注；真机数字来自 `docs/` 验收记录。两者不要混着讲。
- `78.4%` / `~21%` 两个对比值是场景推演，无实测来源，见 `metrics-sources.md` 第四节。

---

## 5. 部署与运维文档

### 5.1 构件与校验

| 构件 | 路径 | 大小 |
| --- | --- | --- |
| Linux x86_64 运行时 | `dist/gpu-scavenger-linux-x86_64-0.1.0.tar.gz` + `SHA256SUMS` | 5,946,096 B（5.95 MB） |
| macOS 控制台 | `dist/GPU-Scavenger-macos-arm64.app.zip` | 4,430,687 B |
| Windows 控制台 | GitHub Release 的 `*-windows-x64.msi` / `-setup.exe`（CI 产出） | — |

复现打包：`packaging/linux/build-bundle.sh --binary-dir <linux-release> --output <tar.gz>`（校验 ELF、写 SHA256SUMS、剥离归档元数据，可复现）。
Windows 必须在 Windows runner 上构建（WebView2 + 安装器工具链平台相关），见 `docs/releasing.md`。

### 5.2 最小部署

```bash
# Controller：SQLite WAL 持久队列，无外部数据库依赖
controller --listen 0.0.0.0:50051 --db queue.sqlite3 --enrollment-token-file token
# 可选 mTLS：--tls-cert/--tls-key/--tls-client-ca（带 client-ca 即为双向）

# Agent（卡主人侧）：声明允许贡献哪几张卡
agent --controller https://<master>:50051 --device-uuid GPU-xxxx --policy cooperative
# 三种策略：ObserveOnly 只读观测 / Cooperative 可被抢占 / Strict 严格边界

# Claim 三种触发方式：落 claim 文件、桌面控制台/托盘按钮、配置 Guard 观测外部占用自动触发
```

### 5.3 运维语义

| 现象 | 系统行为 |
| --- | --- |
| Controller 不可达 | Agent 有界退避重连（250ms→5s），先停自己的 scope 等 active task 结束再建新会话 |
| 重连后 | 新 `Hello` 回收该 Agent 的 leased/running 任务，未提交分片回 `Queued`；旧会话消息与 unregister 被忽略 |
| NVML 暂态失败连续发生 | `Degraded`；边界失败或初始化失败 → `Quarantined`；两者 Controller 都停止调度 |
| 重复/过期命令 | `command_seq` 幂等忽略 |
| 结果重复提交 | 同 `task_id + lease_epoch` 完全相同结果返回成功；元数据冲突返回错误；结果提交缺失时成功事件被拒绝 |
| 证书轮换 | 原子替换文件 + `SIGHUP`，只重建监听任务，不强杀已有 gRPC 长连接（避免轮换误杀运行中任务） |
| 端口冲突 | 桌面壳使用动态 loopback 端口，与本机 Docker/其他服务并存，不抢占也不终止 |

### 5.4 安全边界与已知限制

- 验收用证书/token/私钥只存在于独立 smoke 目录，**生产部署仍需正式 PKI 与 enrollment 流程**；
- 全程只操作本项目创建的 scope、进程、端口、DB、临时目录；不 reset GPU、不重载驱动、不改系统服务与 Docker；
- **未验证且当前 fail-closed**：Windows Job Object、AMD/ROCm、MIG 资源切分调度、多 Master、生产级 artifact 存储、
  任意第三方训练框架的恢复兼容性；
- 权限拒绝样本缺失：以 `nobody` 运行只读探针在本机仍获 NVML 读权限，未产生真实 `PermissionDenied` 样本，
  该错误分类由本地映射测试覆盖，未通过改权限制造样本。

### 5.5 站点自身

- 前端：React 19 + Vite 8 + TS 5.9 + Tailwind v4，静态产物 `site/dist`，无 Function、无后端、无数据库；
- 发布：Qoder Sites，`webDirectory: dist`、`spa: false`，已设为公开访问；
- 取证脚本（可复现）：`site/dev/shoot.mjs`（逐节截图 + 演练台序列）、`site/dev/longshot.mjs`（整页长图）、
  `site/dev/link-probe.mjs`（CDP 驱动完整抢占链路）。
