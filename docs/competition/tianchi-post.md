参赛赛道：StudyHack 学习科研
## 作品链接

**https://gpu-scavenger-iaocj0wm9oa.qoder.zone**

用 Qoder Sites 部署并已设为公开访问，评委点开就能用，不需要登录、不需要本地环境。
页面里是可以直接操作的——它跑的状态机和释放判据与开源实现 `scavenger-core` 同源。

开源仓库（Apache-2.0 / MIT 双许可）：https://github.com/Deep-Octopus/gpu-scavenger
赛道：**StudyHack 学习科研**

---

## 一、自我介绍

 LLM-Master / 张洁，西安电子科技大学计算机技术研二，队员1人。

我平时在实验室的公共 GPU 服务器上跑小模型微调和批量推理实验。
这个作品源于我自己踩了两年多的一个日常麻烦，所以它对"学习科研场景里算力怎么分"这个问题是有具体答案的。

---

## 二、作品是什么

**一句话：GPU Scavenger 让实验室里那些大部分时间空着的显卡敢全速接活，而机器主人随时要用、472 毫秒内一定还得回来。**

具体场景是这样的：

一台 8 卡 A800，通常只有两三张在跑别人的长训练，剩下五张空着。你想塞一个微调任务进去，
但你不敢——因为机器是共享的，卡主人回来时你如果没清干净，就是事故。于是大家宁愿排队等"整台空闲的机器"，
五张卡就这么空转到天亮。

GPU Scavenger 是插在中间的那层控制平面：机器主人装一个 Agent 说"这几张卡可以借"，
你提交任务，Agent 把任务放进自己的内核级隔离边界里跑；主人回来（显式点一下 Claim，或者他的进程开始占卡被观测到），
Agent 只驱逐**自己启动的那些进程**，验证显存真的回到基线了，才把卡交还，没跑完的分片无损回队重排。

**宿主优先**是它唯一不可协商的产品契约：Agent 永远只清理自己的作用域，绝不碰别人的 PID。

---

## 三、为什么做（问题或想法的来源）

三个真实痛点，按被刺痛的顺序：

**1. 现有方案都要求实验室"变成数据中心"。**
K8s + device plugin、Slurm 这些方案本身没问题，但它们要求把机器纳管、要求改提交方式、要求有人运维。
高校实验室的现实是十几台各自为政的工作站，主人不同意装集群 Agent。
所以我们要做的是**零侵入**：不改训练代码、不上容器编排、单包 5.95 MB 装完就能跑，节点只需要能主动往外建一条 TLS 连接。

**2. "任务结束"和"显存释放"在很多系统里是同一个事件，但物理上不是。**
进程退出了，CUDA context 还在；cgroup 空了，NVML 还报着几百 MiB。
如果控制平面在这里就宣布"卡还回来了"，下一个任务撞上的是脏显存，主人看到的是"你的工具把我的卡搞坏了"。
所以我们把 **ReleaseVerified 做成一个独立状态**：cgroup 为空 + Agent 自有 GPU 进程数为零 + 显存回到任务启动基线 ±64 MiB，
并且**连续两次采样都满足**才算通过。这层判据是纯函数，写在 `scavenger-core` 里，可以单测，也可以被浏览器演练台复用。

**3. 进程名会撞车，靠名字杀进程等于全机雪崩。**
工作站上 `python` / `torchrun` / `vllm` 这些名字到处都是。误杀一个宿主 PID 的代价，
比少借出一张卡大得多。所以我们用**七元组身份**（task_id、lease_epoch、pid、process_start_time、uid、cgroup_id、device_uuid）
来判定"这个进程是不是我启动的"，任何一项对不上就只读观测、绝不下发终止动作。
真机验收里连 `fork` + `setsid()` 逃管子进程都被 cgroup v2 边界一并回收，328ms。

---

## 四、怎么用（5 步以内）

### A. 30 秒体验（不用装任何东西）

1. 打开 **https://gpu-scavenger-iaocj0wm9oa.qoder.zone**
2. 滚到第 **06** 节「8 × A800 弹性抢占演练台」，点右上角黄绿色的 **「4 卡并发 + 宿主 472ms 抢占」**
3. 看左下算力机架：5 张空闲卡被并发填上分片，3 张带 🔒 的宿主卡水位纹丝不动
4. 点 **「激活宿主 Claim」**，跟着右侧事件日志读 seq 递增：`scope.empty` → `release.verified` → `release.total` → `task.requeue`
5. 想看硬件细节就滚到第 **05** 节，把 SXM 模组**拖开爆炸视图**，冷板、硅中介层、GPU die、六颗 HBM2e 叠层都在；
   想看协议就按 **⌘K** 呼出命令面板直接跳任意一节

### B. 真实集群部署（Linux x86_64 + NVIDIA）

```bash
# 1. 取运行时包并校验
sha256sum -c SHA256SUMS && tar xzf gpu-scavenger-linux-x86_64-0.1.0.tar.gz

# 2. 起 Controller（SQLite WAL 持久队列，无需外部数据库）
./controller --listen 0.0.0.0:50051 --db queue.sqlite3 --enrollment-token-file token

# 3. 卡主人这边起 Agent，声明允许贡献哪几张卡
./agent --controller https://<master>:50051 --device-uuid GPU-xxxx --policy cooperative

# 4. 提交任务（无 checkpoint 的 stateless 分片）
./client submit --task finetune-01 --device GPU-xxxx -- cmd: python train.py --epochs 3

# 5. 主人要用卡了：Claim
touch /var/run/gpu-scavenger/claim   # 或托盘按钮 / 配置的 Guard 自动触发
```

之后卡主人看到的就是：自己的卡回到基线，任务在别人的空闲卡上继续跑。
macOS / Windows 装 Tauri 桌面控制台，连远端 Controller 走 SSH 隧道，控制台本身不跑任务。

---

## 五、用 Qoder 做出来的过程

**这个作品是我用 Qoder 从头实现的整个项目**：仓库从一次 `chore: establish project baseline` 开始，一共 26 个提交，
`crates/` 下 **4,992 行 Rust**（五个 workspace 成员、0 个 unsafe 块）、`site/src` 下 **9,318 行 TypeScript / 38 个源文件**、
一份 `control.proto`、21 个单元测试、三份真机验收记录、Linux/Windows 打包与 CI，以及开头那个公开访问的 Qoder Sites 站点。
原创口径说清楚：**控制平面、状态机、协议、演练台仿真内核、3D 建模、取证脚本、发布流程全部是新写的**；
站点脚手架里唯一复用的是 Qoder Sites 官方 starter 的 UI 组件目录、hooks 和 Tailwind 层，
来源和改动清单在 `site/PROVENANCE.md` 里逐条标明，第三方库按正常依赖引用而不是复制代码。
分工是这样的：**Qoder 负责写代码、跑命令、开浏览器验证、连远端做验收、最后自己发布；
我负责定产品契约、划安全边界、决定什么能说什么不能说**。
我给它的规矩只有一条：它写下的每一句结论都要能指回仓库里的一个文件、一条命令输出或一行数据库事件，
指不回的不许进页面、不许进文档。

### 1. 从空仓库到五个 crate

我先用自然语言把承诺写成 `gpu_scavenger.md`（宿主优先、七元组身份、状态机、三条 p95 目标），
Qoder 读完这份文档自己出实现计划，然后从零把整个 workspace 建出来：
`core`（纯状态机 + ReleaseVerifier，零 I/O）、`protocol`（gRPC 双向流，唯一契约面）、
`agent`（NVML 探针 / cgroup v2 / systemd scope runner）、`controller`（SQLite WAL 队列 + 调度）、
`desktop`（Tauri 控制台）。CLI 入口、`packaging/linux`、`.github/workflows/ci.yml` 和 Windows 发布流水线也是它写的。
`cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings`、
`cargo test --workspace`（21 个测试）这三条门禁是 Qoder 在自己的终端里循环跑到全绿的，
红了它自己定位、自己改、改完把输出贴回来，我不用在旁边复制报错。

它自己发现并修掉的坑，举两个真实的：一个是**短命令竞态**——任务在 systemd scope 还没在 cgroup 路径上可见时就已经退出，
初版把它误判成启动失败，它改成以空 scope 继续读退出码和结果；另一个是 clippy 的 `result_large_err` 报在 tonic
生成的代码上，因为生成码不该手改，它的处理是在 `protocol/src/lib.rs` 加一行 `#[allow(...)]`，而不是去写转换胶水层。

我手动改的地方：Qoder 一开始把释放验证写在 Agent 的执行路径里，我要求抽回 `core` 做成纯函数——
只有纯函数才能同时被真机、单测和浏览器演练台复用，否则页面上的数字就是假的。这条后来变成了整个项目的分层规矩。

### 2. 真机验收：脚本它写，边界我划

在实验室那台 8×A800 上跑验收时，我给 Qoder 的硬约束是**只允许操作本次自己创建的 scope、进程、端口和临时目录**，
不许 reset GPU、不许重载驱动、不许动外部 PID。它照着写出了 CUDA hold helper、fork/setsid 派生树 helper、
假 NVML 库（用来造 Quarantined 状态而不触碰宿主驱动）这几套取证工具，并把每轮的
二进制 SHA-256、独立端口、独立 DB、事件顺序都落到 `docs/` 的三份验收记录里。

结果：**Claim 到显存归零 472ms（复测 470ms），Claim 到自有 scope 消失 339 / 328 / 347ms**，
checkpoint 走 SIGUSR1 + 37 字节产物 + SHA-256 摘要，断线重连后旧会话不会污染新会话。
中途我发现它把 GPU6 在会话期间被外部环境改变的水位也写进了本项目的成果里，直接要求改成
"不归因于本项目"——这类归因纪律是我盯的，Qoder 不会主动替你保守。

### 3. 站点是怎么写出来的：Qoder 自己读赛题、自己开浏览器验收

赛题要求不是我抄给 Qoder 的，是它自己把赛题页渲染出来读的原文，
确认硬性要求是 **Qoder Sites 公网部署 + 论坛作品帖五段必含、原则上不接受本地文件/压缩包**，
并据此把提交物的形态定成"一个公开可点开的站点 + 一篇五段帖"，而不是打包一份材料上传。

代码层面它用的是真库不是手搓：three.js 建模、@xyflow/react 画状态机、ECharts 画实测分布、GSAP + Lenis 做滚动，
13 个板块一条滚动叙事，⌘K 命令面板和板块之间互相点亮跳转也是它实现的。
它写完不是直接给我看截图，而是**自己调无头浏览器打开页面逐板块截图、再用 CDP 驱动演练台把整条链路跑一遍**
（`scope.empty` → `release.verified` → `release.total` → `task.requeue`），脚本留在仓库 `site/dev/` 下可复现。
我这边提意见的方式很具体：字号太小、文字重叠、不要满屏卡片框——它就改成 11.5px 下限、无边框留白版式。

**3D 这块返工最多。** 第一版 SXM 模组就是一个盒子贴了个 logo，我判断"这个页面的审美还有上升空间"，
让它反复迭代：加硅中介层和 GPU die 的分层台阶、六颗 HBM2e 做成逐层缩小的叠层、
冷板顶面开 21 道机加工槽、鳍片只盖住中段好把两颗冷却液快接头和四颗螺栓露在后缘台阶上、
PCB 底面画 SXM 插座的 LGA 焊盘、基板上加八个插座笼——这样"释放回放把模组抬起来"时露出的是插座而不是空板，
"借出去"这件事才有物证。中间它加过一层 TIM 导热垫，结果把 GPU die 完全挡住了，爆炸视图的看点没了，我让它删掉。

最典型的一次拉扯是数字：Qoder 复核时查出页面上三个数字（`78.4%`、`~21%`、`T_detect 11ms`）在仓库里找不到出处，
就动手改了 5 个文件、重做了 og 图、重新构建。我叫停了这次改动，要求它把 8 处编辑**逐条回滚到原字符串**，
改成出一份口径文档，把"实测 / 推导 / 模型 / 推演"四档分开列，而不是为了让页面好看去改数据。
它回滚之后拿 bundle 文件名哈希和 og.png 的 md5 跟线上产物做了逐字节比对，证明源码和已发布版本完全一致才收手。
这份文档现在也在仓库里，评委要是想核对每个数字的来路，直接翻就行。

### 4. 部署：Qoder 自己走完 Qoder Sites 发布

站点由 Qoder 通过 Qoder Sites 打包、发布并设为公开访问，就是开头那个链接。
`site/.GPU Scavenger.qoder.site` 里能看到它注册的 13 个页面和五类外观能力，发布后它自己 curl 线上产物核对过 JS 哈希。

<img src=https://static.tianchi.aliyun.com/userimg/1095281252410/2026-11-18/SBFd1Iv03ohJigoe.png >

<img src=https://static.tianchi.aliyun.com/userimg/1095281252410/2026-11-18/vKCRz40Iq2JB3TYT.png >


<img src=https://static.tianchi.aliyun.com/userimg/1095281252410/2026-11-18/bD58dHidjfKaRZXO.png >


<img src=https://static.tianchi.aliyun.com/userimg/1095281252410/2026-11-18/6uuMPfMCuLVa9WXP.png >


<img src=https://static.tianchi.aliyun.com/userimg/1095281252410/2026-11-18/LJD1VMwhgzusI7oG.png >


<img src=https://static.tianchi.aliyun.com/userimg/1095281252410/2026-11-18/v8WDKFE1dygMvEM7.png >


（截图依次是：站点首屏与真机水位 / SXM 模组爆炸视图 / 演练台并发分配 / 472ms 完整释放链路事件日志 / 实测样本与对照 / 任务状态机路径。）
