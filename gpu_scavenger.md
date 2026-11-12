# GPU-Scavenger：宿主优先的闲时 GPU 执行代理

> Engineering Specification, Architecture Design & Development Handbook  
> 文档版本：v0.2  
> 状态：MVP 实现基线；目标架构与已验证能力分开记录

> 本轮已落地 Linux/NVIDIA stateless 闭环、Sprint 2 网络与运维能力、Sprint 3 checkpoint 协议和 Sprint 4 本地 Web/Tauri 控制台与能力边界上报。真实验证在 `d1n41a25g01` 的 GPU2 上完成，测试只使用本次创建的任务 cgroup、临时目录、证书和进程；平台扩展对未验证的 Windows/ROCm/MIG 调度保持明确的不可用状态。

---

## 1. 目标与产品契约

### 1.1 要解决的问题

GPU-Scavenger 面向高校实验室、AIGC 工作室和拥有多台散装工作站的小团队。机器主人愿意贡献闲时 GPU，但不愿把机器加入 K8s、Slurm 或其他重型集群，也不愿修改现有训练与推理程序。

系统的核心用户旅程是：

1. 主人在节点上安装 Agent，选择允许贡献的 GPU 和运行策略。
2. Agent 通过出站 TLS 连接注册到 Master，不要求节点开放入站端口。
3. Master 只向符合资源、兼容性和本地策略的节点分配任务。
4. Agent 把任务放入自己的隔离边界中运行，并持续上报资源和任务状态。
5. 主人通过本地 Claim、托盘按钮或配置的 Guard 表达 GPU 使用需求。
6. Agent 停止领取新任务，按任务类型优雅保存或强制停止自己的任务。
7. Agent 验证任务进程和显存已经释放，再允许宿主继续使用 GPU。
8. 未提交结果的分片以至少一次语义重新入队，任务结果通过幂等提交避免重复写入。

### 1.2 必须兑现的产品承诺

1. **宿主优先**  
   宿主通过显式 Claim 或配置的 Guard 获得优先权。Agent 只驱逐自己启动和登记的任务。

2. **出站控制连接**  
   节点主动建立到 Master 的出站 TLS 连接。网络能否通过 NAT 取决于网络是否允许出站 TLS；受限网络需要中继或可访问的 Master。

3. **任务可回收**  
   每个任务都必须有明确的隔离边界、租约、结果提交状态和回收路径。

4. **可验证的释放**  
   “任务结束”与“显存释放”分开记录。只有任务隔离边界为空、探针不再报告任务进程、显存恢复到策略阈值后，才进入 ReleaseVerified。

5. **小规模优先**  
   第一版针对单 Master、小规模节点集群和 NVIDIA Linux 节点优化，不提前承诺高可用控制面或所有操作系统。

### 1.3 当前版本的产品边界

设计目标支持：

- Linux x86_64；
- NVIDIA GPU 与 NVML；
- cgroup v2 或支持 GPU 隔离的容器运行时；
- 单个 Master + SQLite WAL；
- 无状态分片任务；
- 出站 TLS/mTLS、节点注册、任务租约和有界断线重连。

设计中定义了实现 checkpoint 协议的有状态任务，但 MVP 在 Sprint 1 只交付无状态分片；Stateful 能力要等 Sprint 3 的真实框架验证通过后再开放。

本轮代码实际支持：

- Linux x86_64 + NVIDIA NVML，通过 GPU UUID 发现和采样；
- 单 Controller + SQLite WAL，Agent 通过当前版本的 gRPC stream 注册、心跳和接收任务；
- systemd scope/cgroup v2 运行 stateless TaskShard，任务命令使用 executable、args、环境和工作目录；
- 本地 Claim 文件和 CLI；Claim 激活后停止领取新任务，并只停止 Agent 自己的 scope；
- HardStop 后同时检查 scope、cgroup 归属、NVML 进程和显存基线，连续两次满足条件后再回报 ReleaseVerified；
- bounded channel（容量 32）、PID start time/UID/cgroup identity 读取和 SQLite lease requeue；
- TaskEvent 和 ResultCommit 使用稳定 event_id；同一 task_id + lease_epoch 的相同结果重复提交是幂等的，冲突元数据会被拒绝；成功事件必须先看到结果提交；结果文件使用受大小上限保护的流式 SHA-256；
- Controller 可选 TLS/mTLS，Agent 使用自定义 CA 建立出站 stream；Unix Controller 支持通过 `SIGHUP` 重新读取证书和私钥，新连接使用新证书，已有长连接自然收敛；连接断开时停止自有 scope、等待 active task 收敛并按有界退避重连；
- AgentHello/Heartbeat 上报健康态，NVML/Claim 边界失败进入 Quarantined；Controller 为会话分配 session_id，重连时回收该 Agent 的租约并忽略旧会话消息；
- enrollment token 文件校验支持按连接读取，替换 token 文件后新连接使用新 token；TaskAssignment 和 TaskEvent 使用单调 command_seq，旧命令被 Agent 幂等丢弃；
- 瞬态探针错误先进入 Degraded，连续失败进入 Quarantined；Controller 快照和 Web 控制台展示健康、能力、任务和指标；
- Checkpointed 任务通过 SIGUSR1、原子文件提交、SHA-256 ACK 和 checkpoint 表记录完成一次宿主 Claim 退让闭环；
- Agent 握手上报 OS、架构、GPU 后端、隔离边界、checkpoint/MIG 能力和 schedulable 标志；Controller 对未通过能力边界的 Agent 停止调度；
- NVML 错误会映射为权限、驱动不可用、不支持或暂态失败；快照保留 GPU/MIG instance identity，当前只观测 MIG，不做 MIG 资源调度。
- macOS Tauri 原生壳嵌入同一 Controller Web 控制台，使用应用数据目录和动态 loopback 端口；桌面端自身不宣称 GPU Agent 可调度。
- macOS Tauri 原生壳支持 `--controller-url` 指向远端 Controller Web 地址；通过 SSH tunnel 或受保护的 HTTPS 暴露访问时，Mac 只承担操作界面，Controller 和 Agent 继续运行在 GPU 节点。

本轮没有实现或没有完成验收的能力：容器 runner 矩阵、MIG 资源调度、多节点恢复、生产 artifact 存储、真实训练框架恢复兼容性，以及跨平台 Job Object/ROCm 适配。checkpoint 已用协议兼容 helper 完成真实信号、原子提交和回收验证，但不宣称任意第三方训练框架都兼容。多 Agent 只验收了同一 Controller 内的 round-robin 调度，未宣称多节点故障恢复。

以下能力延后：

- Windows Job Object；
- AMD/ROCm、Intel GPU；
- 多 Master 自动故障转移；
- 任意第三方程序的通用 checkpoint；
- 对未托管宿主进程的强制终止；
- 仅依靠键鼠、锁屏或“看起来空闲”自动判断 GPU 所有权。

---

## 2. 领域术语

| 术语 | 定义 |
| :--- | :--- |
| Host | 节点主人使用的宿主程序、桌面渲染或本地服务。它不属于 Agent 任务。 |
| Scavenger Task | 由 Agent 接收、启动、登记和回收的任务。 |
| Task Ownership | 任务与其隔离边界、进程身份、租约和 GPU 设备之间的关联。 |
| HostDemand | 宿主需要 GPU 的信号，来源可以是显式 Claim、Guard 或探针观察。 |
| ExplicitClaim | 主人通过本地命令、托盘按钮或本地 API 发出的 GPU 使用请求。 |
| Guard | 主人配置的宿主服务、systemd scope 或进程组，用来表达 GPU 使用状态。 |
| ObservedExternal | 探针观察到的、没有匹配到 Agent 任务身份的 GPU 使用者。它是降级信号，不等于绝对的宿主需求。 |
| Eviction | Agent 停止自己管理的任务，使 GPU 回到宿主可用状态的过程。 |
| ReleaseVerified | 已确认任务隔离边界为空、任务进程不再占用 GPU，且显存达到释放阈值。 |
| Quarantined | 节点或 GPU 信息不足以安全调度时的状态。该状态停止领取新任务。 |
| TaskLease | Master 给 Agent 的带版本和过期时间的任务租约。租约过期后，任务可以被重新分配。 |

---

## 3. 任务模型与运行策略

### 3.1 任务类型

| 特性 | 无状态分片 | 有状态 checkpoint |
| :--- | :--- | :--- |
| 典型任务 | 生图、生视频、TTS、向量化、批量推理 | LoRA/QLoRA 微调、小模型继续预训练 |
| 最小单位 | 一个可重试、可幂等提交的 TaskShard | 一个带恢复信息的连续 Task |
| 结果提交 | 输出写入对象存储或共享盘后再 ACK | Checkpoint manifest 写入持久存储后再 ACK |
| 宿主抢卡 | 停止领取新分片，当前分片可按策略强制停止 | 发送 checkpoint 请求，等待 ACK，超时后强制停止 |
| 失败恢复 | 未提交结果的分片重新入队 | 从最近一次有效 checkpoint 恢复 |
| 默认策略 | HardStop | GracefulThenHard |
| 适用前提 | 任务本身必须幂等 | 任务必须实现 checkpoint 协议 |

任务粒度可以从 10～60 秒开始，但实际值取决于任务启动开销、模型缓存和结果提交时间。分片过短会把调度开销放大，分片过长会增加抢占浪费。

### 3.2 节点策略

每个节点必须选择一种本地策略：

- **ObserveOnly**：只采集和告警，不自动停止任务。
- **Cooperative**：ExplicitClaim 触发抢占；ObservedExternal 默认只停止领取新任务。
- **Strict**：ExplicitClaim 立即抢占；ObservedExternal 连续确认且满足本地配置后，可以驱逐 Agent 自己的任务。

无论策略如何，Agent 都不能根据观察到的 PID 去终止外部宿主进程。

### 3.3 任务的最小资源声明

每个任务至少声明：

- GPU 数量和每卡显存下限；
- GPU UUID 或 MIG 设备约束；
- CUDA/驱动/计算能力要求；
- 容器镜像摘要或结构化命令参数；
- 输入和输出 artifact；
- 是否支持 checkpoint；
- 最大重试次数和租约时长；
- 是否允许被 HardStop。

调度器不能只按显存大小打分，还要考虑驱动兼容性、计算能力、模型缓存、磁盘空间、网络和历史稳定性。

---

## 4. 支持矩阵与安全边界

| 维度 | MVP 约束 | 后续扩展 |
| :--- | :--- | :--- |
| 操作系统 | Linux x86_64 | Windows、其他 Linux 架构 |
| GPU | NVIDIA + NVML | AMD/ROCm、Intel |
| 设备身份 | GPU UUID；MIG 先观测、后调度 | 完整 MIG 资源调度 |
| 任务隔离 | cgroup v2 或 GPU 容器运行时 | Windows Job Object |
| Master | 单实例、SQLite WAL | 高可用和多 Master |
| 控制连接 | 出站 TLS gRPC | 中继、代理和多区域 |
| 数据语义 | 至少一次执行，结果幂等提交 | 更复杂的 DAG 和工作流 |
| 主人信号 | ExplicitClaim、Guard、探针降级信号 | 更多桌面和系统集成 |

Agent 安装时必须检测：

- NVML 是否可用；
- GPU 设备是否稳定可识别；
- cgroup v2 是否可委托给 Agent；
- Agent 是否具备查询自身任务状态所需的权限；
- 若使用容器，容器运行时是否能正确注入指定 GPU。

检测失败时，节点进入 Quarantined，而不是使用不完整信息继续调度。

---

## 5. 总体架构

~~~text
+--------------------------------------------------------------------------------+
|                          Master Control Plane                                 |
|                                                                                |
|  Durable Task Store (SQLite WAL)                                               |
|  Task Lease / Retry / Idempotent Result Commit                                |
|  Capability-aware Scheduler                                                   |
|  Artifact Manifest and Cache Metadata                                          |
|  gRPC Control Service + Web/Tauri Adapter                                      |
+------------------------------------+-------------------------------------------+
                                     ^
                                     | Outbound TLS gRPC stream
                                     | Handshake / command sequence / heartbeat
                                     v
+--------------------------------------------------------------------------------+
|                              Worker Agent                                     |
|                                                                                |
|  Local Safety Guard                                                            |
|   - ExplicitClaim / local pause                                               |
|   - Policy: ObserveOnly / Cooperative / Strict                                |
|   - Probe failure -> Quarantined                                              |
|                                                                                |
|  Probe Layer                                                                   |
|   - GPU inventory by UUID/MIG identity                                        |
|   - Compute / Graphics / MPS / Other process observations                     |
|   - Free memory, utilization, health, permissions                             |
|                                                                                |
|  Task Ownership Registry                                                       |
|   - task_id / lease_epoch / process start time / cgroup or container identity|
|                                                                                |
|  Task Runner                                                                   |
|   - cgroup v2 scope or Docker/OCI runner                                      |
|   - structured command and environment                                        |
|   - bounded stdout/stderr and artifact staging                                |
|                                                                                |
|  Preemption Controller                                                         |
|   - stop accepting work                                                       |
|   - checkpoint request and deadline                                            |
|   - cgroup/container stop                                                      |
|   - ReleaseVerifier                                                            |
|                                                                                |
|  gRPC Client                                                                   |
|   - enrollment / heartbeat / task commands / telemetry                         |
|   - reconnect with exponential backoff                                         |
+--------------------------------------------------------------------------------+
~~~

控制面只负责分配、租约、状态和结果；宿主优先和任务回收必须在 Agent 本地完成，不能依赖 Master 在线。

---

## 6. 宿主需求检测与抢占决策

### 6.1 HostDemand 信号优先级

| 信号 | 可靠性 | 默认动作 |
| :--- | :--- | :--- |
| ExplicitClaim | 最高 | 立即停止领取新任务并进入抢占流程 |
| 配置的 Guard | 高 | Guard 有效期间不领取任务；失效后按策略恢复 |
| ObservedExternal | 中低 | 连续采样确认；默认停止领取新任务并告警 |
| 键鼠、锁屏、系统空闲 | 低 | 只作为 UI 提示或调度加权 |

探针观察只回答“有未登记的 GPU 使用者”，不能回答“这个使用者一定代表主人现在需要完整 GPU”。宿主可能在已有进程中动态加载模型，也可能只使用图形或视频编解码资源。

### 6.2 抢占判定流程

~~~text
每个探针周期：
1. 读取 GPU inventory 和 GpuSnapshot
2. 如果探针不可用、权限不足或设备身份变化：
       节点进入 Quarantined
       停止领取新任务
       不根据旧快照执行新的 HardStop
3. 根据本地 Claim、Guard 和进程观察生成 HostDemand
4. 如果没有 HostDemand：
       继续运行
5. 如果是 ObservedExternal：
       连续确认至少 N 个样本
       根据节点策略决定只告警、停止领取新任务或抢占
6. 如果是 ExplicitClaim 或有效 Guard：
       停止领取新任务
       Stateless -> HardStop 或等待当前分片的可配置短窗口
       Checkpointed -> 请求 checkpoint
7. 到达 checkpoint deadline：
       任务未 ACK -> HardStop
8. HardStop 后执行 ReleaseVerifier
9. 验证通过 -> 任务完成、重排或节点恢复
10. 超时或状态不一致 -> GPU/节点进入 Quarantined
~~~

显式 Claim 可以绕过连续样本确认；ObservedExternal 不能直接获得同等优先级。

### 6.3 抢占状态机

~~~text
Ready
  -> Leased
  -> Starting
  -> Running
  -> StopAcceptingWork
  -> Draining
  -> Checkpointing
  -> Stopping
  -> VerifyingRelease
  -> Requeued / Succeeded / Failed / Quarantined
~~~

状态跃迁必须是幂等的。Master 重复发送命令、Agent 重连、进程已经退出，都不能导致状态机回退或重复提交结果。

### 6.4 释放验证

ReleaseVerifier 至少检查：

1. 任务 cgroup 或容器没有存活进程；
2. 任务登记的进程身份不再出现在 GPU 进程列表；
3. 显存恢复到设备策略的高水位；
4. 连续若干次采样没有新的任务进程出现；
5. 没有待处理的 checkpoint 或 artifact 写入。

“进程退出”不等于“显存立即可用”。释放验证失败时，不应通过重置 GPU 的方式影响宿主；应记录原因并隔离该 GPU。

当前 Linux/NVIDIA stateless 实现以任务启动时的 NVML `free_memory_bytes` 作为基线，允许最多 64 MiB 的回收误差；cgroup 为空、登记进程数为零且显存满足阈值后，必须连续采样两次才返回 ReleaseVerified，最多轮询 40 次、每次间隔 50ms。短命令若在 cgroup 路径可见前已经退出，会按“scope 已为空”继续读取退出码，不会误报启动失败。

---

## 7. 显存余量与时延指标

### 7.1 Headroom 计算

固定预留 1.5～2.0GB 无法适配不同显存容量和宿主工作负载。节点启动后应通过配置或观测得到宿主启动峰值，使用：

~~~text
reserve = max(
    configured_min_reserve,
    total_vram * configured_ratio,
    observed_host_startup_p99 + safety_margin
)
~~~

同时维护低水位和高水位：

- 低水位触发停止领取任务或抢占；
- 高水位持续一段时间后才允许恢复；
- 每个设备的阈值独立保存，不把一个 GPU 的经验复制到所有节点。

### 7.2 时延定义

记录以下单调时钟指标：

- T_detect：收到 ExplicitClaim 或确认 ObservedExternal 到发出抢占动作；
- T_task_exit：发出停止动作到任务隔离边界为空；
- T_release：发出停止动作到 ReleaseVerified；
- T_requeue：任务被判定未完成到重新进入队列。

初始目标只对经过验证的支持矩阵成立：

- ExplicitClaim 的 T_detect p95 ≤ 250ms；
- HardStop 的 T_task_exit p95 ≤ 500ms；
- T_release p95 ≤ 1500ms；
- 任何误杀宿主进程都是发布阻断问题；
- 探针失败、权限不足和设备身份变化必须进入 Quarantined。

CPU < 1%、RSS < 30MB 可以作为 Agent 空闲预算，但必须在明确的 GPU 数量、驱动和轮询周期上实测，不能直接当作跨平台承诺。

---

## 8. 任务隔离与进程控制

### 8.1 cgroup/容器优先

严格模式下，任务必须在创建时进入可回收的隔离边界：

- Linux 使用 cgroup v2 scope 或具备 GPU 支持的 OCI 容器；
- HardStop 写入对应 cgroup 的 kill 接口或调用容器运行时的 kill；
- 通过 cgroup.events、容器状态和 NVML 共同验证释放；
- 任务启动、日志、输出和清理都绑定 task_id 与 lease_epoch。

仅在无法使用 cgroup 的兼容模式下使用 PGID。PGID 只能提供尽力清理，不得作为严格模式的安全保证。

### 8.2 设备身份

- 调度和持久化使用 GPU UUID 或 MIG UUID；
- GPU index 只作为当前进程的临时显示值；
- 原生进程可以使用 CUDA_VISIBLE_DEVICES 指定可见设备；
- 容器必须通过 NVIDIA Container Toolkit 的设备注入参数限制实际可访问设备；
- 任务启动后记录进程看到的设备身份，防止容器内外 index 重排造成错卡。

### 8.3 进程身份

PID 只是临时句柄，任务身份至少包括：

~~~text
task_id
lease_epoch
pid
process_start_time
uid
cgroup_id 或 container_id
assigned_device_uuid
~~~

Agent 只允许停止任务登记的隔离边界，不允许根据进程名、PID 差集或显存占用直接杀宿主程序。

---

## 9. Stateful Checkpoint 协议

SIGUSR1 不是通用的 checkpoint 协议。只有任务明确实现协议时，Agent 才能把任务标记为 Checkpointed。

### 9.1 请求与响应

~~~text
CheckpointRequest
  task_id
  lease_epoch
  deadline_ms
  reason: HostClaim | OperatorRequest | LeaseExpiry

CheckpointAck
  task_id
  checkpoint_uri
  manifest_uri
  checksum
  resume_spec
  completed_at
~~~

任务必须：

1. 停止接收新输入；
2. 将模型、优化器、随机状态和必要的输入位置写入临时位置；
3. 原子提交 manifest；
4. 返回 checksum 和可执行的 resume_spec；
5. 收到 ACK 后退出或进入等待状态。

任务未返回有效 ACK 时，Agent 按 HardStop 处理，并把该次运行标记为未完成。

### 9.2 Checkpoint 一致性

- manifest 必须最后提交；
- 文件使用临时名称和原子 rename；
- Master 只接受校验通过的 manifest；
- 恢复前检查驱动、CUDA、模型和容器镜像兼容性；
- checkpoint 存储不可用时，不得报告成功。

---

## 10. Master、租约与数据流

### 10.1 SQLite 语义

MVP 使用 SQLite WAL 作为单 Master 的权威状态源：

- 任务、租约、事件和结果提交在同一个数据库中；
- 每个租约包含 task_id、lease_epoch、agent_id、expires_at；
- Agent 只接受当前 lease_epoch 的命令；
- Master 重启后从数据库恢复未完成租约；
- 结果提交使用唯一键，重复 ACK 不产生重复结果；
- 数据库不可写时停止分配新任务。

### 10.2 TaskShard 语义

TaskShard 采用至少一次执行：

~~~text
Queued
  -> Leased
  -> Running
  -> OutputStaged
  -> ResultCommitted
  -> Succeeded
~~~

发生以下情况时回到 Queued 或 Failed：

- Agent 断线且租约过期；
- 任务被 HardStop 且结果未提交；
- 输出校验失败；
- checkpoint manifest 无法验证。

任务实现者必须保证输出提交幂等。系统不承诺任意第三方程序的 exactly-once 执行。

### 10.3 gRPC 控制协议

长连接至少包含：

- AgentHello：版本、节点能力、设备 UUID、策略和协议版本；
- MasterWelcome：agent_id、配置、心跳周期和命令序列起点；
- TaskAssign：任务和 lease_epoch；
- TaskEvent：启动、运行、checkpoint、停止、释放验证；
- ResultCommit：输出 manifest、checksum 和 lease_epoch；
- Heartbeat：资源、任务状态和本地安全状态；
- ClaimEvent：本地宿主 Claim 的开始、续期和结束。

所有命令带单调递增 command_seq。断线重连时，Agent 上报最后处理的序列号和本地任务状态，Master 再发送缺失命令。

控制流和大文件传输分开。artifact 使用对象存储、共享盘或受限的 HTTP 上传，不通过无限增长的 gRPC 消息承载。

---

## 11. 安全与权限

### 11.1 节点注册

- 初次安装使用一次性 enrollment token；
- Master 为 Agent 签发可轮换的身份凭证；
- 所有控制连接使用 TLS；
- 节点只接受绑定到自身 agent_id 和 lease_epoch 的任务；
- 任务命令使用结构化 executable + args，不拼接 shell 字符串。

### 11.2 最小权限

- Agent 不默认拥有杀任意宿主进程的权限；
- 能力检查失败时进入 Quarantined；
- 任务隔离、GPU 设备注入、日志和 artifact 路径分别设置权限；
- 事件日志记录谁发起 Claim、哪一个策略触发抢占、哪个 task_id 被停止以及释放是否验证成功；
- 凭证、对象存储密钥和宿主环境变量不能直接写入任务日志。

---

## 12. Rust Workspace 结构

~~~text
gpu-scavenger/
├── Cargo.toml
├── README.md
├── docs/
│   ├── CONTEXT.md
│   └── adr/
├── crates/
│   ├── scavenger-core/
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── types.rs
│   │   │   ├── state.rs
│   │   │   ├── policy.rs
│   │   │   └── identity.rs
│   │   └── Cargo.toml
│   │
│   ├── scavenger-protocol/
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   └── messages.rs
│   │   └── Cargo.toml
│   │
│   ├── scavenger-agent/
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── watchdog.rs
│   │   │   ├── probe/
│   │   │   │   ├── nvml.rs
│   │   │   │   └── mock.rs
│   │   │   ├── ownership.rs
│   │   │   ├── preemption.rs
│   │   │   ├── release_verifier.rs
│   │   │   ├── containment/
│   │   │   │   ├── cgroup_v2.rs
│   │   │   │   ├── docker.rs
│   │   │   │   └── pgid_best_effort.rs
│   │   │   ├── checkpoint.rs
│   │   │   └── client.rs
│   │   └── Cargo.toml
│   │
│   └── scavenger-controller/
│       ├── src/
│       │   ├── main.rs
│       │   ├── store/
│       │   ├── scheduler/
│       │   ├── leases.rs
│       │   ├── artifacts.rs
│       │   └── api.rs
│       └── Cargo.toml
└── ui/
    └── tauri-app/       # Sprint 3 再接入
~~~

scavenger-core 不依赖网络、GPU 驱动或操作系统 API。scavenger-protocol 只放可版本化的消息和序列化定义。系统调用和网络连接位于 Agent 与 Controller 边界。

---

## 13. 核心数据结构与接口骨架

### 13.1 GPU 与进程身份

~~~rust
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GpuDeviceId {
    pub uuid: String,
    pub mig_uuid: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuProcessKind {
    Compute,
    Graphics,
    Mps,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub start_time_ticks: u64,
    pub uid: u32,
    pub cgroup_id: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GpuProcessInfo {
    pub identity: ProcessIdentity,
    pub kind: GpuProcessKind,
    pub used_memory_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeHealth {
    Healthy,
    PermissionDenied,
    DriverUnavailable,
    NotSupported,
    TransientFailure,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GpuSnapshot {
    pub device: GpuDeviceId,
    pub total_memory_bytes: u64,
    pub free_memory_bytes: u64,
    pub utilization_gpu_percent: u32,
    pub processes: Vec<GpuProcessInfo>,
    pub observed_at_monotonic_ms: u64,
    pub health: ProbeHealth,
}

#[derive(Debug, Error)]
pub enum ProbeError {
    #[error("GPU driver unavailable: {0}")]
    DriverUnavailable(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("device is not supported: {0}")]
    NotSupported(String),
    #[error("transient query failure: {0}")]
    Transient(String),
}
~~~

### 13.2 宿主需求与任务策略

~~~rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostDemand {
    None,
    ExplicitClaim {
        reason: String,
        expires_at_ms: u64,
    },
    GuardActive {
        guard_id: String,
        expires_at_ms: Option<u64>,
    },
    ObservedExternal {
        process_ids: Vec<ProcessIdentity>,
        confirmed_samples: u32,
    },
    Unknown {
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskPolicy {
    Stateless,
    Checkpointed {
        checkpoint_deadline_ms: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvictionDecision {
    KeepRunning,
    StopAcceptingNewWork,
    RequestCheckpoint { deadline_ms: u64 },
    HardStop { reason: String },
    Quarantine { reason: String },
}
~~~

### 13.3 Probe Trait

~~~rust
pub trait GpuProbe: Send + Sync {
    fn inventory(&self) -> Result<Vec<GpuDeviceId>, ProbeError>;
    fn query_snapshot(&self, device: &GpuDeviceId)
        -> Result<GpuSnapshot, ProbeError>;
}
~~~

### 13.4 TaskRunner Trait

下面的 TaskSpec、TaskHandle 和 CheckpointRequest 由 scavenger-core 与 scavenger-protocol 共同定义，此处只展示 Runner 必须提供的生命周期操作。

~~~rust
pub trait TaskRunner: Send {
    type Error;

    fn start(&mut self, spec: &TaskSpec) -> Result<TaskHandle, Self::Error>;
    fn request_checkpoint(
        &mut self,
        handle: &TaskHandle,
        request: &CheckpointRequest,
    ) -> Result<(), Self::Error>;
    fn hard_stop(&mut self, handle: &TaskHandle) -> Result<(), Self::Error>;
    fn is_empty(&self, handle: &TaskHandle) -> Result<bool, Self::Error>;
}
~~~

TaskRunner 的实现必须显式报告“停止命令已发送”和“隔离边界为空”两个不同结果。不要用一次 wait 调用替代释放验证。

---

## 14. 工程质量与错误处理

### 14.1 Agent 安全规则

- Agent 主循环不得因为单次探针失败而 panic；
- 系统调用、网络、文件和驱动错误必须转换为带上下文的类型化错误；
- 所有 channel、队列、日志缓冲区都有容量上限；
- 任务命令必须使用结构化参数；
- 所有停止操作都带 deadline 和可观测结果；
- 不忽略 kill、checkpoint、artifact commit 和 release verification 错误；
- 状态机和事件处理必须幂等。

### 14.2 质量门禁

每次提交至少执行：

~~~text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
~~~

文件大小、函数长度和圈复杂度作为代码审查信号，不应阻止合理的边界模块拆分。Agent 中禁止使用会掩盖运行时错误的 unwrap、expect 和 panic；测试代码可以根据测试目的使用断言辅助。

---

## 15. 可观测性

### 15.1 指标

Agent 至少上报：

- probe_success、probe_error、probe_permission_denied；
- gpu_free_memory_bytes、gpu_utilization_percent；
- task_running_count、task_lease_age；
- preemption_count_by_reason；
- checkpoint_success、checkpoint_timeout；
- T_detect、T_task_exit、T_release、T_requeue；
- release_verification_failure；
- node_state：Ready、Degraded、Quarantined、Disconnected。

### 15.2 事件

每次重要动作生成包含以下字段的事件：

~~~text
event_id
event_time_monotonic
agent_id
device_uuid
task_id
lease_epoch
policy
host_demand
action
reason
result
error_code
~~~

事件日志需要支持按 task_id、device_uuid 和 event_id 查询，以便解释一次误判或未释放。

---

## 16. 测试策略

### 16.1 纯单元测试

必须覆盖：

- HostDemand 优先级和过期；
- ExplicitClaim、Guard、ObservedExternal、Unknown 的状态跃迁；
- 低水位/高水位滞后；
- PID 复用和 process_start_time 匹配；
- lease_epoch 不匹配；
- 重复事件和重复 ACK；
- checkpoint deadline 和 HardStop 升级。

### 16.2 Agent 集成测试

在 Linux 上验证：

- cgroup 创建、任务启动、并发 fork 和 cgroup.kill；
- 子进程尝试 setsid 后的回收行为；
- 任务退出但显存暂未释放时，ReleaseVerifier 不提前成功；
- probe 权限不足时进入 Quarantined；
- Agent 断线时不领取新任务；
- Master 重连后不会重复执行旧命令；
- 输出写入失败时不会报告成功。

### 16.3 真实 GPU 测试

MockGpuProbe 只能验证状态机，不能证明驱动和操作系统行为。真实 GPU 测试至少覆盖：

- 不同显存规模；
- 不同 NVIDIA 驱动和 CUDA 版本；
- Compute、Graphics、MPS 或 Other 进程；
- 宿主已有进程、宿主动态加载模型；
- Docker/OCI 和原生 cgroup 两种 runner；
- HardStop 后的进程退出时间和显存释放时间。

发布门槛是支持矩阵内零宿主误杀、释放验证成功率达到目标，且所有异常进入可解释状态。

---

## 17. 分阶段研发路线

### Sprint 0：真实边界验证

- 确认 Linux/NVIDIA/cgroup v2 支持矩阵；
- 在真实 GPU 上测量 T_detect、T_task_exit、T_release；
- 验证 NVML 进程类型、权限失败、MIG 观察；
- 验证 cgroup runner 对 fork、setsid 和容器的回收；
- 完成 HostDemand 的纯逻辑切片、NVML 错误分类和 GPU/MIG identity 观测；完整 Quarantined 运行态在 Sprint 2 通过隔离 Agent 远端 smoke。

交付物：测试记录、支持矩阵、明确的默认策略，以及真实 cgroup/显存释放证据。

### Sprint 1：最小可用闭环

- scavenger-core；
- SQLite WAL Controller；
- 一个 Linux cgroup runner；
- ExplicitClaim；
- stateless TaskShard；
- lease、幂等结果提交、HardStop 和 ReleaseVerifier；
- 稳定事件 ID、结果提交先行约束和本地多 Agent round-robin 调度；
- MockProbe + 真实 GPU 集成测试。

本轮交付切片：一台 Master + 一台 Linux/NVIDIA Agent 完成分片执行、ExplicitClaim 抢占、只回收自有 cgroup、ReleaseVerifier、结果提交和停止后的安全重排；两 Agent 的本地调度行为有单元验收，多节点恢复和跨节点可靠性留到网络与可靠性 Sprint。

### Sprint 2：网络与运维

- 可选 TLS/mTLS、健康态上报和旧会话隔离；
- 有界断线重连、心跳和 Agent 自有 scope 的断线 HardStop；
- 节点 Quarantined 调度门禁与租约回收；
- 事件日志和指标；
- enrollment token 文件校验和按连接轮换；
- command_seq 去重和 Degraded 指标链路；
- 简单 CLI 和本地 Web 控制面。

本轮交付：远端 mTLS `/bin/true` 闭环、Controller 断线后 Agent scope 回收、Master 重启后的任务重排、假 NVML 注入的 Quarantined 任务不调度、错误 token 拒绝、token 文件轮换、command_seq 去重、Degraded/Quarantined 调度门禁和 Web `/api/status`。

### Sprint 3：Checkpoint 任务

- 定义并实现 CheckpointRequest/CheckpointAck；
- 接入一个协议兼容的真实进程 helper；
- 验证 checkpoint 原子提交、ACK digest、恢复前状态记录和超时升级；
- 只对协议兼容任务开放 Stateful 选项。

交付物：一次宿主 Claim 能保存 checkpoint manifest 并将任务安全回到队列；另一张兼容 GPU 的实际训练恢复仍需框架专项验收。

### Sprint 4：桌面端与平台扩展

- 本地 Web 控制台（暗色 observability UI、任务派发、Agent 能力和空态/错误态）；
- Agent 能力矩阵和调度 fail-closed；
- MIG identity 观测信息展示；
- macOS Tauri 原生壳，复用现有控制台并通过动态 loopback 端口启动本地 Controller；
- macOS Tauri 原生壳可通过 `--controller-url` 复用远端 Controller 控制台；
- Windows Job Object、MIG 资源调度、AMD/ROCm 和多 Master 保持为后续适配项目，不能以当前 Linux/NVIDIA 证据代替。

---

## 18. MVP 验收清单

### 18.1 本轮 Linux/NVIDIA stateless 闭环验收

本轮已完成的验收切片：

- 主机 `d1n41a25g01`：Linux x86_64、NVIDIA driver 580.105.08、8 张 A800-SXM4-80GB、cgroup v2；
- 候选设备：GPU2，UUID `GPU-524bcc1c-f383-b658-a36d-983fa7efc56c`，只读确认为空闲后才启动测试；
- 任务边界：自有 systemd scope `gpu-scavenger-sprint01-cuda-release-3-1.scope`，只运行本次生成的 256 MiB CUDA hold helper；
- 抢占与释放：Claim 到 scope 消失 339ms，Claim 到 GPU2 回到 2 MiB 基线 472ms；GPU2 在 Claim 前观测到 683 MiB，ReleaseVerifier 连续采样通过后 Controller 中任务保持 queued；
- fork/setsid：`sprint01-fork-setsid` 的 parent/child PID 同在 `/system.slice/gpu-scavenger-sprint01-fork-setsid-1.scope`，cgroup 中观测到两个 PID，Claim 后 328ms scope 消失且两个 PID 均不存在；
- 结果提交：`sprint01-write-result-2` 输出 21 bytes，Controller 最终状态为 `succeeded`，scope 已回收；重复提交/冲突拒绝由 `TaskStore` 单元测试覆盖；
- 设备边界：GPU2 MIG 当前为 Disabled；NVML 快照保留 MIG instance 字段但本轮不做 MIG 调度。权限错误映射由单元测试覆盖，本机以 `nobody` 运行探针仍获准读取 NVML，因此没有伪造权限拒绝证据；
- 安全结果：初始快照为 GPU0/1/2/3/4/5/6/7=`69735/69717/2/2/2/2/74441/2 MiB`，最终快照为 `69735/69717/2/2/2/2/2/2 MiB`。GPU6 在测试期间由外部环境从 74441 MiB 变为 2 MiB；本次除只读 inventory 外没有对 GPU6 执行操作、启动任务、终止 PID 或变更驱动，因此不把其他 GPU 的显存稳定性写成已验证不变量；
- 本地门禁：`cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace` 均通过，共 21 个 workspace 单元测试通过；Sprint 2 远端证据见 `docs/sprint2-acceptance-20261112.md`。

### 18.2 完整 MVP 验收目标

完整 MVP 只有在以下条件同时满足时才算完成：

- Agent 能识别并持久化稳定的 GPU UUID；
- 任务始终运行在可回收的 cgroup 或容器边界；
- ExplicitClaim 能停止领取新任务并驱逐 Agent 自己的任务；
- HardStop 不依赖杀宿主 PID；
- ReleaseVerifier 能区分进程退出和显存释放；
- TaskShard 未提交时会安全重排；
- Master 重启和 Agent 断线不会制造错误完成；
- probe 失败会进入 Quarantined；
- 支持矩阵内的真实 GPU 测试没有宿主误杀；
- T_detect、T_task_exit、T_release 都有可查询的实测数据；
- 文档中的每项承诺都能映射到测试或运行时证据。

这个版本的核心原则是：**只管理自己的任务，只在本地确认宿主需求后抢占，只把已经验证的释放结果报告给调度器。**

### 18.3 Sprint 2-4 交付边界

本轮已完成并记录的工程闭环：

- mTLS、错误 enrollment token 拒绝、token 文件替换后的新连接认证、断线重连和旧 session 隔离；
- Unix Controller 的 TLS 证书/私钥 `SIGHUP` 轮换；新 Agent 连接使用新证书，已有长连接不被强制终止；
- TaskAssignment/TaskEvent command sequence 去重、Degraded/Quarantined 调度门禁和多 Agent round-robin；
- CheckpointRequest/CheckpointAck、SIGUSR1 触发、原子 checkpoint 文件、SHA-256 记录、Claim 后回收和 queued 重排；
- 本地 Web 控制台 `/api/status`、`/api/tasks`、任务账本、Agent 能力展示和受限派发表单；
- macOS Tauri `.app` 原生壳：启动后显示同一控制台，刷新可读 Controller live 状态，端口不依赖 `18080`；
- OS/架构/NVML/cgroup/systemd/checkpoint/MIG 能力上报，调度器对 schedulable=false 的 Agent fail-closed。

远端记录见 [`docs/sprint3-sprint4-acceptance-20261112.md`](docs/sprint3-sprint4-acceptance-20261112.md)。Windows Job Object、AMD/ROCm、MIG 资源切分、多 Master 和任意训练框架恢复兼容性没有被当前支持矩阵覆盖。




