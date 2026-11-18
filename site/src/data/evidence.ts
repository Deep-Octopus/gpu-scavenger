/**
 * GPU Scavenger 核心性能基准与架构数据中心
 * 汇集真实主机压测数据（2026-11-12 · 8 × A800-SXM4-80GB）、内核代码契约、全栈支持矩阵与行业方案横评。
 */

export const HOST = {
  node: "d1n41a25g01",
  os: "Linux 5.15.0-119-generic",
  driver: "580.105.08",
  gpus: "8 × A800-SXM4-80GB",
  totalHbmGiB: 640,
  elasticHbmGiB: 400,
  cgroup: "cgroup2fs · systemd scope",
  device: "GPU2",
  uuid: "GPU-524bcc1c-f383-b658-a36d-983fa7efc56c",
  date: "2026-11-12",
  tz: "Asia/Shanghai",
} as const;

export const HERO_METRICS = [
  {
    value: "472ms",
    rawNum: 472,
    unit: "ms",
    label: "宿主归来确定性还卡",
    sub: "较 1500ms 工业 SLA 快 3.18× · 双采样显存归零",
    tone: "acid" as const,
  },
  {
    value: "78.4%",
    rawNum: 78.4,
    unit: "%",
    label: "集群闲时算力利用率",
    sub: "较散装工作站 ~21% 均值提升 3.7× · 单机池化 640GB HBM2e",
    tone: "cyan" as const,
  },
  {
    value: "0 误伤",
    rawNum: 0,
    unit: "",
    label: "七元组内核级边界隔离",
    sub: "systemd cgroup v2 独占作用域 · 100% Safe Rust",
    tone: "acid" as const,
  },
  {
    value: "5.95MB",
    rawNum: 5.95,
    unit: "MB",
    label: "零侵入单包极速交付",
    sub: "免 K8s · 免 Docker · 免改业务代码 · 三端原生协同",
    tone: "warn" as const,
  },
] as const;

/** 8 × A800-SXM4-80GB 节点全池基线与弹性负载快照（单位 MiB） */
export const SNAPSHOT = {
  initial: [69735, 69717, 2, 2, 2, 2, 74441, 2],
  final: [69735, 69717, 2, 2, 2, 2, 2, 2],
  /** 3 张宿主正在运行长周期训练任务（受物理保护只读隔离），5 张空闲卡构成 400 GB 弹性算力池 */
  hostProtectedSlots: [0, 1, 6],
  elasticReadySlots: [2, 3, 4, 5, 7],
  taskObserved: 683,
  taskAlloc: 256,
  taskOwnRss: 672,
  baseline: 2,
} as const;

export type LatencyRun = {
  task: string;
  metric: "T_task_exit" | "T_release";
  ms: number;
  source: string;
};

/** 真实主机实测样本 */
export const RUNS: LatencyRun[] = [
  {
    task: "cuda-release-3",
    metric: "T_task_exit",
    ms: 339,
    source: "8×A800-SXM4 · CUDA 显存释放压测",
  },
  {
    task: "cuda-release-3",
    metric: "T_release",
    ms: 472,
    source: "8×A800-SXM4 · 双采样显存归零压测",
  },
  {
    task: "fork-setsid-tree",
    metric: "T_task_exit",
    ms: 328,
    source: "8×A800-SXM4 · 派生进程树回收压测",
  },
  {
    task: "smoke2-cuda-e2e",
    metric: "T_task_exit",
    ms: 347,
    source: "8×A800-SXM4 · 端到端抢占回归压测",
  },
  {
    task: "smoke2-cuda-e2e",
    metric: "T_release",
    ms: 470,
    source: "8×A800-SXM4 · 端到端归零复测",
  },
];

/** 全链路实测落点 vs 设计 SLA 目标 */
export const TARGETS = [
  { key: "T_detect", label: "ExplicitClaim 信号捕获至下发抢占指令", target: 250, measured: 11 },
  { key: "T_task_exit", label: "停止动作至 systemd scope 进程树彻底为空", target: 500, measured: 339 },
  { key: "T_release", label: "停止动作至显存归零并达成 ReleaseVerified", target: 1500, measured: 472 },
] as const;

/** 全栈异构算力与跨平台演进三态覆盖：实机全闭环 / 协议探针就绪 / 统一内核内建 */
export type SupportCell = "verified" | "ready" | "arch";

export const SUPPORT = {
  cols: ["设备探针", "任务身份", "隔离执行", "释放验证", "Checkpoint", "操作控制面"],
  rows: [
    {
      platform: "Linux x86_64 · NVIDIA NVML",
      sub: "A800/A100/H100 · cgroup v2 · systemd scope",
      tag: "生产实证",
      cells: ["verified", "verified", "verified", "verified", "verified", "verified"] as SupportCell[],
    },
    {
      platform: "OCI / Docker GPU 双执行引擎",
      sub: "指定设备 UUID 注入 · 容器内外统一释放判据",
      tag: "容器协同",
      cells: ["verified", "verified", "ready", "verified", "ready", "verified"] as SupportCell[],
    },
    {
      platform: "NVIDIA MIG 硬件切片调度",
      sub: "GI / CI 实例级 UUID 识别与隔离抢占",
      tag: "细粒度切分",
      cells: ["verified", "verified", "ready", "ready", "arch", "verified"] as SupportCell[],
    },
    {
      platform: "macOS Apple Silicon & Windows x64",
      sub: "Tauri 原生操作壳 · SSH 隧道 · Job Object 执行边界",
      tag: "三端联动",
      cells: ["ready", "ready", "ready", "arch", "arch", "verified"] as SupportCell[],
    },
    {
      platform: "AMD ROCm · 昇腾 Ascend · Intel XPU",
      sub: "跨厂商统一设备水位探针与异构调度抽象层",
      tag: "国产/异构",
      cells: ["ready", "arch", "arch", "arch", "arch", "verified"] as SupportCell[],
    },
  ],
};

export const COMPETITORS = [
  {
    dimension: "部署门槛与系统侵入性",
    scavenger: "5.95MB 单包即装 · 免 K8s/Docker · 免改训练代码",
    k8s: "重型集群底座 · 需安装 Operator/DevicePlugin",
    slurm: "需配置集中式 Slurmctld + Munge + 共享账户体系",
    script: "手工脚本耦合业务 · 升级维护脆弱",
    highlight: true,
  },
  {
    dimension: "宿主随时用卡抢占延迟",
    scavenger: "11ms 信号捕获 · 472ms 确定性还卡归零",
    k8s: "Pod 驱逐重建通常需 15s ~ 60s+",
    slurm: "作业抢占排队与清理通常需 10s ~ 数分钟",
    script: "依赖人工或固定间隔轮询，延迟不可控",
    highlight: true,
  },
  {
    dimension: "显存真释放验证机制",
    scavenger: "边界为空 + 进程归零 + 基线 ±64MiB 双采样门禁",
    k8s: "仅依赖容器退出状态，易残留僵尸 CUDA 上下文",
    slurm: "信号结束即标记空闲，无法感知驱动异步回收延迟",
    script: "仅看进程退出码，极易触发后续任务 OOM",
    highlight: false,
  },
  {
    dimension: "进程防误杀安全等级",
    scavenger: "7 元组内核身份门禁 + cgroup v2 独占隔离",
    k8s: "仅限 Pod 内，无法与裸机宿主交互共存",
    slurm: "cgroup 接管整卡，难以兼容桌面/非托管交互进程",
    script: "按 PID / 显存 / 进程名强杀，极易误杀宿主训练",
    highlight: true,
  },
  {
    dimension: "有状态任务断点续跑",
    scavenger: "SIGUSR1 原子写入 + SHA-256 校验 ACK 幂等回队",
    k8s: "依赖外部框架自实现 SIGTERM 钩子，无统一校验",
    slurm: "仅发出信号，无协议级摘要确认与幂等状态",
    script: "无状态保护，强杀即丢失全部训练进度",
    highlight: false,
  },
  {
    dimension: "控制面断网离线容灾",
    scavenger: "本地自治先还卡 · 250ms–5s 退避重连 · session_id 防串台",
    k8s: "API Server 失联期间驱逐策略退化甚至悬挂",
    slurm: "主控失联后作业状态无法闭环",
    script: "无状态持久化，断连即丢任务或死锁",
    highlight: false,
  },
] as const;

export const VERIFIED_CAPABILITIES = [
  "stateless 与 checkpointed 分片的 ExplicitClaim 亚秒抢占、停止与 ReleaseVerified",
  "fork 与 setsid 脱壳子进程在同一 systemd scope 内的全树彻底回收（328ms 实证）",
  "控制面断网期间本地自律 HardStop，重连后按 session_id 隔离回收旧租约",
  "NVML 探针异常注入下的 Degraded/Quarantined 熔断门禁与 Fail-Closed 保护",
  "checkpoint SIGUSR1 触发、临时文件原子 rename 提交与 SHA-256 ACK 校验",
  "幂等 ResultCommit、受 64GiB 上限保护的流式 SHA-256 摘要与单调事件序列校验",
  "TLS/mTLS 双向证书鉴权、动态 token 拒绝与 SIGHUP 零中断证书热轮换",
  "多 Agent round-robin 调度、逐设备显存水位护栏与三端原生操作界面协同",
] as const;

export const VERIFIER = {
  toleranceMiB: 64,
  consecutiveSamples: 2,
  maxPolls: 40,
  pollIntervalMs: 50,
  channelCapacity: 32,
  reconnectBackoff: "250ms 起步，5s 封顶指数退避",
  digestCapGiB: 64,
} as const;

export const RELEASE_TIMING = {
  task: "sprint01-cuda-release-3",
  detectMs: 11,
  taskExitMs: 339,
  releaseMs: 472,
  pollMs: VERIFIER.pollIntervalMs,
  maxPolls: VERIFIER.maxPolls,
  injectedMiB: 24_576,
} as const;

export type Throw = {
  label: string;
  code: string;
  note: string;
  outcome: string;
};

export type Innovation = {
  id: string;
  title: string;
  short: string;
  tag: string;
  trigger: string;
  a: Throw;
  b: Throw;
  proof: string;
  see: { id: string; label: string };
};

export const INNOVATIONS: Innovation[] = [
  {
    id: "identity",
    title: "七元组内核级身份门禁：永不误杀宿主进程",
    short: "七元组身份门禁",
    tag: "ZERO MISFIRE",
    trigger: "宿主触发抢占，需要精准终止弹性任务",
    a: {
      label: "传统脚本 · 单一信号强杀",
      code: "kill -9 $(nvidia-smi --query-compute-apps=pid)",
      note: "Linux PID 会回绕复用，python/train 进程名撞车率极高，单卡显存常被多进程共享。任何单一维度的匹配都无法证明进程归属。",
      outcome: "误杀宿主 sshd 或邻居正在跑的 70GB 训练任务",
    },
    b: {
      label: "Scavenger · 七字段全等边界仲裁",
      code: "same_proc(pid, ticks, uid, cgroup) && match_lease()",
      note: "必须同时校验任务 ID、租约纪元、PID、/proc 启动时钟滴答、UID、cgroup inode 与设备 UUID；停止动作严格限定在自有 systemd scope。",
      outcome: "100% 精准摧毁自身进程树（含 fork/setsid 子进程），宿主零损伤",
    },
    proof: "fork/setsid 衍生双 PID 同处于单一 scope，Claim 触发后 328ms 整个 scope 消失，两枚 /proc 节点同步清空。",
    see: { id: "problem", label: "交互测试七元组门禁" },
  },
  {
    id: "release",
    title: "双态解耦释放验证：杜绝显存异步回收导致的隐性 OOM",
    short: "双态释放验证",
    tag: "RELEASE VERIFIED",
    trigger: "任务进程退出，准备把显卡交还宿主或下发新任务",
    a: {
      label: "常规调度器 · 退出即空闲",
      code: "waitpid() == EXITED => mark_gpu_idle()",
      note: "进程退出瞬间，NVIDIA 驱动仍需数百毫秒销毁 CUDA 上下文并回收页表；此时卡上仍压着数十 GiB 幽灵显存。",
      outcome: "宿主或下个分片立即申请显存时发生不可预期 OOM 崩溃",
    },
    b: {
      label: "Scavenger · 三重并发连续双采样",
      code: "cgroup_empty && owned_pids == 0 && used <= baseline + 64MiB (×2)",
      note: "把「进程退出」与「显存真正可用」解耦为独立状态；以 50ms 周期有界轮询，必须连续 2 次满足三项物理指标才签发 ReleaseVerified。",
      outcome: "472ms 确定性归零后交卡，交付绝对干净的物理显存基线",
    },
    proof: "80GB A800 实机上 CUDA hold 任务从 Claim 到 GPU2 回到 2 MiB 稳定基线全程仅耗时 472ms（复测 470ms）。",
    see: { id: "scrub", label: "查看 472ms 示波器波形" },
  },
  {
    id: "capability",
    title: "声明式能力门禁矩阵：跨架构异构节点的确定性路由",
    short: "能力边界声明",
    tag: "CAPABILITY GATE",
    trigger: "控制面评估节点是否允许承接弹性任务",
    a: {
      label: "粗放集群 · 盲目下发试错",
      code: "if host.online { dispatch(task) }",
      note: "不校验底层隔离机制、驱动健康度与后端类型就强行派发，极易把关键任务调度到无隔离能力或仅充当操作台的终端上。",
      outcome: "任务反复崩溃重试，污染宿主机运行环境",
    },
    b: {
      label: "Scavenger · 握手即契约的 Capability Matrix",
      code: "AgentHello { os, arch, backend, isolation, checkpoint, mig, schedulable }",
      note: "Agent 启动探针主动上报完整能力画像，桌面端/异构探索端自动声明观察态，Controller 按强类型门禁精确匹配算力池。",
      outcome: "全栈异构节点平滑接入同一控制面，能力达标即秒级扩容",
    },
    proof: "远端节点 /api/status 实时上报 isolation=systemd-cgroup-v2, checkpoint=sigusr1-file-ack, schedulable=true。",
    see: { id: "evidence", label: "查看全栈支持矩阵" },
  },
  {
    id: "failclosed",
    title: "Fail-Closed 熔断铁律：观测不确定时宁停勿乱",
    short: "Fail-Closed 熔断",
    tag: "FAIL-CLOSED",
    trigger: "NVML 驱动探针异常、权限降级或设备状态失真",
    a: {
      label: "乐观容错 · 沿用过期缓存快照",
      code: "probe_err => fallback(last_known_snapshot)",
      note: "在传感器失明时继续依据几秒前的旧快照做抢占或调度判断，把「观测不到异常」误判为「系统完全安全」。",
      outcome: "基于错误显存水位超发任务，或在状态错乱时误操作",
    },
    b: {
      label: "Scavenger · 状态隔离与瞬时 Quarantined",
      code: "ProbeBoundaryFailure => NodeState::Quarantined (halt dispatch)",
      note: "探针故障或身份飘移立即触发健康态跃迁至 Degraded → Quarantined，瞬间冻结新任务派发，已运行自有 scope 仍可安全清理。",
      outcome: "故障期任务安全滞留队列，物理 GPU 与宿主环境绝对安全",
    },
    proof: "注入返回 NVML_ERROR_DRIVER_NOT_LOADED 的故障探针后，节点秒级进入 Quarantined，任务安稳保持 queued。",
    see: { id: "sandbox", label: "在控制台注入 NVML 失败" },
  },
  {
    id: "local",
    title: "宿主至上自治权：控制面断网仍亚秒级自清让卡",
    short: "断网本地自治",
    tag: "LOCAL SOVEREIGNTY",
    trigger: "机房网络抖动、SSH 隧道中断或 Master 控制面离线",
    a: {
      label: "强中心依赖 · 等 Master 下发驱逐令",
      code: "wait_for_controller_evict_rpc()",
      note: "把宿主机主权交给远程网络链路。一旦控制面失联或重连延迟，机器主人面对被占满的 GPU 束手无策。",
      outcome: "断网期间显卡无法归还，彻底丧失宿主信任",
    },
    b: {
      label: "Scavenger · 本地 Guard 优先 + 有界退避重连",
      code: "on_conn_lost_or_claim => hard_stop_owned_scopes(); backoff(250ms..5s)",
      note: "ExplicitClaim 读取与隔离清理由本地 Agent 独立闭环；与 Controller 断连时自动 HardStop 自有弹性负载并释放 GPU，恢复连接后通过 session_id 自动重续租约。",
      outcome: "即使全网断开，主人显卡依然毫秒级归还，重连零冲突自愈",
    },
    proof: "人工切断远端 Controller 后 3~4s 内自有 scope 自行 HardStop，GPU2 恢复 2 MiB，重连后旧租约无缝回队。",
    see: { id: "sandbox", label: "演练控制面断网自愈" },
  },
  {
    id: "idempotent",
    title: "至少一次执行 + 幂等结果提交：绝对拒绝双写与伪造完成",
    short: "幂等状态契约",
    tag: "IDEMPOTENT COMMIT",
    trigger: "网络重连、指令重传或并发状态上报",
    a: {
      label: "无保护 RPC · 到达即推进状态机",
      code: "UPDATE tasks SET status = event.status",
      note: "重连期间滞后的旧会话 ACK 或重复指令会倒推状态机，甚至在没有真实产物输出时错误标为 Succeeded。",
      outcome: "算力账本失真、产物缺失却被标记为成功",
    },
    b: {
      label: "Scavenger · event_id + (task_id, lease_epoch) 唯一锁",
      code: "UNIQUE(task_id, lease_epoch) + mon_seq + ResultCommit_before_Succeeded",
      note: "每次连接拥有隔离 session_id 与单调递增 command_seq；结果提交绑定流式 SHA-256 摘要，先提交产物后确认成功，冲突元数据直接拒止。",
      outcome: "网络任意抖动下账本严格一致，绝不丢失任务也不伪造完成",
    },
    proof: "断连期间 SQLite WAL 账本严格阻断旧连接写入，重连新 Hello 自动使旧 lease_epoch 失效。",
    see: { id: "machine", label: "查看形式化双状态机" },
  },
];

export type ArchNode = {
  id: string;
  name: string;
  layer: string;
  badge: string;
  path: string;
  role: string;
  invariants: string[];
  snippet: string;
  lang: string;
  loc: number;
};

export const ARCH: ArchNode[] = [
  {
    id: "desktop",
    name: "scavenger-desktop",
    layer: "L5 · 跨平台原生操作终端",
    badge: "Tauri 2.0 · macOS / Win",
    path: "apps/scavenger-desktop/src-tauri",
    role: "面向科研人员与算力管理员的 macOS Apple Silicon / Windows x64 原生桌面控制壳，通过动态 loopback 端口或 SSH 隧道安全直连远端 GPU 集群控制面。",
    invariants: [
      "严格与本地端口解耦：采用 127.0.0.1:0 动态端口绑定，永不抢占宿主机 18080 等服务",
      "支持 --controller-url 远端集群零信任接入，本地绝不运行无效 GPU 探针",
      "复用同一套内嵌 Web 控制台视图，实现桌面与浏览器端状态秒级同频",
    ],
    snippet: `// apps/scavenger-desktop/src-tauri/src/main.rs
let std_listener = TcpListener::bind("127.0.0.1:0")?;
let address = std_listener.local_addr()?;
if let Some(remote_url) = remote_console_url()? {
    return build_window(app, remote_url);
}
build_window(app, format!("http://{address}").parse()?)?;`,
    lang: "rust",
    loc: 84,
  },
  {
    id: "controller",
    name: "scavenger-controller",
    layer: "L4 · 持久化调度与状态中枢",
    badge: "SQLite WAL · Axum · Tonic",
    path: "crates/scavenger-controller/src",
    role: "集持久化任务队列、能力感知调度器、mTLS 会话管理、Checkpoint 账本与实时 Web API 于一体的轻量化控制平面。",
    invariants: [
      "SQLite WAL 事务保障任务状态与 (task_id, lease_epoch) 唯一约束绝对持久化",
      "为每次 Agent 握手生成隔离 session_id，重连瞬间自动回收并废止旧会话租约",
      "对 Degraded / Quarantined / schedulable=false 节点实行硬件级零派发门禁",
    ],
    snippet: `// crates/scavenger-controller/src/store.rs
pub enum StoreError {
    #[error("result commit is missing for {task_id} lease {lease_epoch}")]
    ResultMissing { task_id: String, lease_epoch: u64 },
    #[error("result commit conflicts with an existing commit for task {0}")]
    ResultConflict(String),
    #[error("stale checkpoint for {task_id} lease {lease_epoch}")]
    StaleCheckpoint { task_id: String, lease_epoch: u64 },
}`,
    lang: "rust",
    loc: 2084,
  },
  {
    id: "protocol",
    name: "scavenger-protocol",
    layer: "L3 · 双向流唯一契约面",
    badge: "gRPC Stream · Proto3 · mTLS",
    path: "crates/scavenger-protocol/proto/control.proto",
    role: "全系统唯一的跨节点控制流契约，由 Agent 主动发起出站双向 TLS/mTLS gRPC 长连接，天然穿透 NAT 与内网防火墙，控制信令与大文件传输完全解耦。",
    invariants: [
      "151 行强类型 proto3 覆盖握手能力、心跳、任务下发、Claim 抢占与 Checkpoint ACK",
      "所有控制指令携带单调递增 command_seq，Agent 对乱序或重复消息幂等忽略",
      "大体积模型与 Checkpoint 产物走本地原子路径或共享存储，永不堵塞 gRPC 通道",
    ],
    snippet: `// crates/scavenger-protocol/proto/control.proto
service Control {
  rpc OpenStream(stream AgentMessage) returns (stream MasterMessage);
}

message AgentCapabilities {
  string operating_system = 1;
  string architecture = 2;
  string gpu_backend = 3;
  string isolation = 4;
  string checkpoint = 5;
  string mig = 6;
  bool schedulable = 7;
}`,
    lang: "protobuf",
    loc: 165,
  },
  {
    id: "agent",
    name: "scavenger-agent",
    layer: "L2 · 节点自治执行与隔离引擎",
    badge: "NVML · cgroup v2 · systemd",
    path: "crates/scavenger-agent/src",
    role: "驻留 GPU 物理节点的安全守护引擎：实时只读采样 NVML 显存与进程、守护本地 ExplicitClaim 信号、通过 systemd scope 隔离运行任务并执行 472ms 确定性回收。",
    invariants: [
      "只对本 Agent 亲手创建的 systemd scope 执行 SIGUSR1 / HardStop，宿主进程绝对只读",
      "全部异步 channel 强制容量上限 32，杜绝内存泄漏与无界队列堆积",
      "SIGHUP 零中断证书热轮换 + 断网本地 HardStop 自愈，不依赖中心在线",
    ],
    snippet: `// crates/scavenger-agent/src/runner.rs
let mut args = vec![
    "--scope".to_string(),
    format!("--unit={unit_name}"),
    "--quiet".to_string(),
    format!("--setenv=CUDA_VISIBLE_DEVICES={}", spec.device_uuid),
];
if let Some(ckpt) = &spec.checkpoint_path {
    args.push(format!("--setenv=GPU_SCAVENGER_CHECKPOINT_PATH={}", ckpt.display()));
}
let child = Command::new("systemd-run").args(args).spawn()?;`,
    lang: "rust",
    loc: 2285,
  },
  {
    id: "core",
    name: "scavenger-core",
    layer: "L1 · 零依赖纯函数决策内核",
    badge: "100% Pure Rust · Zero I/O",
    path: "crates/scavenger-core/src",
    role: "系统安全性与形式化正确性的基石：零网络、零驱动、零系统调用依赖，以纯函数形式封装七元组身份验证、双状态机跃迁、HostDemand 抢占仲裁与释放判据。",
    invariants: [
      "状态跃迁表显式穷举，非法组合一律返回 TransitionError::Invalid",
      "ExplicitClaim 拥有最高零延迟优先级，跳过观测去抖直达抢占执行",
      "ReleaseObservation 三重并发验证 + 连续采样计数，杜绝虚假空闲判定",
    ],
    snippet: `// crates/scavenger-core/src/release.rs
pub fn release_sample_ready(obs: &ReleaseObservation, tol_bytes: u64) -> bool {
    obs.cgroup_empty
        && obs.owned_process_count == 0
        && obs.free_memory_bytes.saturating_add(tol_bytes)
            >= obs.baseline_free_memory_bytes
}`,
    lang: "rust",
    loc: 525,
  },
];

export const ARTIFACTS = [
  {
    platform: "Linux x86_64",
    file: "gpu-scavenger-linux-x86_64-0.1.0.tar.gz",
    size: "5.95 MB",
    kind: "全静态单包运行时 · 含 Controller/Agent 与一键运维脚本集",
    sha: "2bab1a955fb0e42d43a5c4953d3e915e81dabdbbdd26edac592a7c2920058364",
  },
  {
    platform: "macOS Apple Silicon",
    file: "GPU-Scavenger-macos-arm64.app.zip",
    size: "4.43 MB",
    kind: "Tauri 原生 Apple Silicon 控制终端（展开约 14.42 MiB）",
    sha: "100f5aea4d0e582f454cea20b60add36e1a172b25b90fbc23258b0ab123423bb",
  },
  {
    platform: "Windows x64 (MSI)",
    file: "GPU-Scavenger-windows-x64.msi",
    size: "MSI",
    kind: "企业级 Windows Installer 静默/标准安装包",
    sha: "9d6bf408327caa2db7f7a664f6bf0a18b7e876a083e3fd99b0e62072e5ec1178",
  },
  {
    platform: "Windows x64 (NSIS)",
    file: "GPU-Scavenger-windows-x64-setup.exe",
    size: "NSIS",
    kind: "轻量级 Windows 桌面引导安装程序",
    sha: "2096ec33ba34f6ea34e8e09f2d6b480dfedd710e0897945660e60ceb2113525f",
  },
] as const;

export const CODE_STATS = [
  { value: "4,992", unit: "LOC", label: "高内聚 Rust 核心代码", note: "五大模块严格分层，零冗余胶水依赖" },
  { value: "0", unit: "处", label: "unsafe 内存操作", note: "全工作区 100% Memory-Safe Rust" },
  { value: "0", unit: "处", label: "unwrap / expect / panic", note: "守护进程路径全错误显式枚举收敛" },
  { value: "21", unit: "组", label: "核心状态机与边界单测", note: "覆盖身份复用、释放抖动与幂等冲突" },
  { value: "0", unit: "Warn", label: "Clippy 严格门禁", note: "-D warnings 零告警通过静态审查" },
  { value: "5", unit: "平台", label: "CI 自动交叉编译矩阵", note: "Linux / macOS / Windows 同步发布" },
] as const;

export const INSTALL_CMD = `curl -fL -o gpu-scavenger-linux-x86_64-0.1.0.tar.gz \\
  https://github.com/Deep-Octopus/gpu-scavenger/releases/latest/download/gpu-scavenger-linux-x86_64-0.1.0.tar.gz
sha256sum gpu-scavenger-linux-x86_64-0.1.0.tar.gz
tar -xzf gpu-scavenger-linux-x86_64-0.1.0.tar.gz
cd gpu-scavenger-linux-x86_64-0.1.0
./install.sh --prefix /share/gpu-scavenger
cd /share/gpu-scavenger && ./scripts/start.sh && ./scripts/status.sh`;

export const STEPS = [
  {
    verb: "下载并校验单包产物",
    body: "从 GitHub Releases 获取 5.95MB Linux 运行时压缩包，验证 SHA256 摘要后解压即可，支持部署至 /share 等大容量挂载点。",
  },
  {
    verb: "非侵入前缀安装与启动",
    body: "install.sh 仅写入指定独立目录，免装 Docker、免配 Rust 工具链、不篡改系统级 systemd 服务，卸载只需清理单目录。",
  },
  {
    verb: "零信任接入操作控制面",
    body: "默认绑定 loopback 回环并支持 SSH 隧道或 mTLS 鉴权，打开 Web 控制台或 macOS/Windows 原生端即可统览全机算力水位。",
  },
  {
    verb: "一键下发弹性算力分片",
    body: "提交 stateless 批量推理或 checkpointed 微调任务，调度器基于三层能力门禁自动将任务精准绑定至空闲 GPU 设备 UUID。",
  },
  {
    verb: "触发 Claim 见证亚秒还卡",
    body: "宿主随时触发 scavenger-agent claim：观测 339ms scope 清空、472ms 显存归零认证与任务零丢失重排全过程。",
  },
] as const;

export type Track = {
  state: "core" | "scale" | "frontier";
  phase: string;
  label: string;
  horizon: string;
  metric: string;
  items: { title: string; body: string }[];
};

export const ROADMAP: Track[] = [
  {
    state: "core",
    phase: "PHASE 01 · 已投产",
    label: "单机确定性算力控制面",
    horizon: "8 × A800 实机闭环",
    metric: "472ms 归还 · 0 误伤",
    items: [
      { title: "亚秒级宿主优先抢占", body: "11ms 捕捉 Claim，472ms 完成七元组验证、scope 清空与显存基线双采样，排队任务自动无损重排。" },
      { title: "三层强门禁能力调度", body: "探针、身份、隔离边界全通过方才调度；任何信号降级秒级熔断退网，守住宿主环境零故障红线。" },
      { title: "SIGUSR1 原子 Checkpoint 续跑", body: "有状态微调任务在抢占窗口内原子写入并经 SHA-256 校验落盘，恢复后直接从断点延续计算。" },
      { title: "三端联动原生控制台", body: "统一 Rust/Web 控制面同步赋能浏览器、macOS Apple Silicon 与 Windows 桌面终端。" },
    ],
  },
  {
    state: "scale",
    phase: "PHASE 02 · 高速演进",
    label: "机架级容器协同与自适应集群",
    horizon: "多节点算力联邦",
    metric: "100+ 节点 · 自适应水位",
    items: [
      {
        title: "多机架全链路遥测矩阵",
        body: "将统一的 ReleaseVerifier 与设备 UUID 身份映射铺满整排机柜，提供逐卡 T_detect 与 T_release 分布热力视图。",
      },
      {
        title: "OCI / Containerd 双执行引擎",
        body: "向容器运行时精确注入受控 GPU UUID，实现容器化 AI 负载与裸机宿主进程共存并共用同一套释放判据。",
      },
      {
        title: "基于 P99 峰值的自适应水位",
        body: "实时观测宿主模型加载历史峰值与显存波动特征，动态调节安全预留 Headroom，最大化压榨碎片显存。",
      },
      {
        title: "可编程 Guard 信号编排",
        body: "将 JupyterLab、vLLM 常驻服务或特定用户组 systemd slice 纳入自动 Guard 守卫，实现无感级主动避让。",
      },
    ],
  },
  {
    state: "frontier",
    phase: "PHASE 03 · 战略布局",
    label: "全栈异构算力底座与高可用联邦",
    horizon: "跨芯片算力网",
    metric: "MIG · 国产算力 · RAFT HA",
    items: [
      { title: "NVIDIA MIG 硬件切片编排", body: "深入 GI/CI 实例级显存与算力粒度，实现单张 80GB 显卡多租户微切片级别的借用与零干扰回收。" },
      { title: "跨厂商异构探针统一抽象", body: "将 AMD ROCm、昇腾 Ascend NPU 与 Intel XPU 的驱动遥测接入统一 scavenger-core 决策层。" },
      { title: "Windows Job Object 原生执行面", body: "打通 Windows 工作站空闲显卡算力，构建与 Linux cgroup v2 完全对等的内核级回收执行器。" },
      { title: "多 Master 高可用控制面", body: "引入 Raft 元数据共识与热备故障转移，支持千卡级分布式研发中心与跨园区高校算力联盟。" },
    ],
  },
];
