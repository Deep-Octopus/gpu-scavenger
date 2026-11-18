# 参赛提交包 · 索引与执行清单

赛事：**2026 Qoder 高校创造力大赛**（主办方 Qoder，赞助方 NVIDIA）
赛题页：https://tianchi.aliyun.com/competition/entrance/532536
赛道：**StudyHack 学习科研**
**提交截止：2026-11-30 18:00**（今天 2026-11-18，剩 12 天）
赛程：初筛 12/1–12/7（每赛道 14 队）→ 决赛 12/1–12/15 线上直播路演

---

## 材料清单

| 文件 | 用途 |
| --- | --- |
| [`tianchi-post.md`](tianchi-post.md) | **天池论坛作品帖正文**，五段必含齐全，可直接复制粘贴 |
| [`tech-brief.md`](tech-brief.md) | 核心价值 / 技术架构与实现 / 创新点 / 功能演示 / 部署与运维 |
| [`pitch.md`](pitch.md) | 3 分钟开场话术 / 5 条亮点 / 12 个预判提问 / 收尾 / 现场动作清单 |
| [`metrics-sources.md`](metrics-sources.md) | 每个对外数字的口径与推导，分 实测 / 推导 / 模型 / 待补 四档 |
| [`shots/desktop/`](shots/desktop/) | 30 张站点与演练台取证图（1440×900，从线上版抓取） |

## 作品链接（已上线，公开访问）

**https://gpu-scavenger-iaocj0wm9oa.qoder.zone**

- 由 Qoder Sites 打包发布，`webDirectory: dist`、`spa: false`，无 Function、无数据库；
- 访问策略已改为 `public`，免登录可打开；
- 站点描述符：`site/.GPU Scavenger.qoder.site`；
- 线上 bundle 哈希与本地源码构建结果一致（`assets/index-C4-rAc9u.js`），即页面所见即仓库所建。

---

## 已完成

- [x] 站点 13 个板块实现并通过 `tsc --noEmit` + 生产构建
- [x] Qoder Sites 注册、打包、发布、设为公开访问
- [x] 线上版逐板块截图取证（`docs/competition/shots/desktop/`，30 张）
- [x] 线上版演练台完整链路验证：入队 → 分配 → Claim → `scope.empty` → `release.verified` → `release.total` → `task.requeue`
- [x] 帖子正文（五段必含 + 怎么用 ≤5 步 ×2 条路径）
- [x] 技术卷、答辩卷、数字口径卷
- [x] 发布产物审计：无 sourcemap、无密钥、无本地 fixture 服务器，`dist` 35 个文件 4.8 MB

## 需要你本人操作（我无法代做）

1. **报名与组队**（11-30 18:00 截止）
   在天池赛题页选 **StudyHack 学习科研** 完成报名组队。
   所有成员须在**初筛截止前**完成天池实名认证 + 阿里云大学生认证，否则取消获奖资格。

2. **领取学生权益**（可选但建议）
   https://university.aliyun.com/action/qoder 完成学生认证，领 Qoder CN 一个月免费权益。

3. **发布作品帖**（正文已就绪，只差发布动作）
   [`tianchi-post.md`](tianchi-post.md) 的自我介绍已填、6 张配图已传到论坛图床（`static.tianchi.aliyun.com/userimg/…`），
   第五段按赛题要求改写成「怎么用 Qoder 写出来的」过程叙述，不再出现任何"包装/宣传"式表述。
   发布时只需要：
   - 入口是**天池技术圈** https://tianchi.aliyun.com/forum（赛题页本身没有论坛 tab）；
   - **关联比赛选「2026 Qoder 高校创造力大赛」** ← 漏了等于没提交；
   - 标题建议 `【StudyHack】GPU Scavenger｜……`，正文首行已写 `参赛赛道：StudyHack 学习科研`；
   - 确认开头作品链接就是那个 `.qoder.zone` 地址，且**在未登录浏览器里能打开**。

4. **社交传播奖**（可选，限量 1000 份，先到先得）
   发小红书/抖音/X，标题带【2026 Qoder 高校创造力大赛】并 @ 对应平台 Qoder 官方账号，
   然后把链接填进帖子最后那段。

## 提交前自查

- [ ] 作品链接免登录可打开（用手机流量测一次，别只在办公网测）
- [ ] 帖子五段齐全：自我介绍 / 作品是什么 / 为什么做 / 怎么用（≤5 步）/ Qoder 过程
- [ ] Qoder 过程段有**多张**截图（赛题明确"尽量多包含截图凭证"）
- [ ] 占位符 `【】` 全部替换干净
- [ ] 截图里不含 token、私钥、证书内容、内部账号（现有 30 张已检查，均为站点界面图）
- [ ] 帖子说的数字和 `metrics-sources.md` 档位一致：实测说实测，推演说推演
- [ ] GitHub 仓库公开可访问（已核对 API 200）

## 已知风险，别在答辩里硬撑

| 项 | 现状 | 建议说法 |
| --- | --- | --- |
| `78.4%` / `~21%` | 页面 KPI，仓库内推不出来 | 标为场景推演，不写进帖子正文，见 `metrics-sources.md` 第四节 |
| `T_detect 11ms` | 页面有，验收记录无对应观测 | 补一次带时间戳的实测，或说明是演练台参数 |
| 472ms 统计口径 | 2 轮样本，非 p95 | 主动说"实测落点"，p95 是设计目标 ≤1500ms |
| Windows / ROCm / MIG / 多 Master | 未验证，代码 fail-closed | 说"能力上报为不可用、调度器跳过"，不说"支持" |
| 第三方框架 checkpoint 兼容性 | 只验证了自研 helper | 说"需要任务配合 SIGUSR1"，不宣称通用 |
| 生产 PKI / enrollment | 验收证书只在独立 smoke 目录 | 说"生产部署需正式 PKI"，写在限制里 |

## 复现命令

```bash
# 站点构建（在 site/ 下）
npm ci && npm run build

# 线上版逐板块截图 + 演练台序列
node site/dev/shoot.mjs --url=https://gpu-scavenger-iaocj0wm9oa.qoder.zone/ \
  --out=/Users/max/Desktop/workspace/projects/gpu-scavenger/docs/competition/shots/desktop --play

# 移动端复核
node site/dev/shoot.mjs --width=390 --url=https://gpu-scavenger-iaocj0wm9oa.qoder.zone/

# 整页长图（给同学审校用）
node site/dev/longshot.mjs

# 演练台链路 CDP 探针
node site/dev/link-probe.mjs
```

## 未提交到 Git

`site/`、`vibe_images/`、`docs/competition/` 目前都是**未跟踪**状态（`git status` 可见）。
本轮没有创建任何 commit——需要提交时明确告诉我，我会先让你确认要纳入哪些文件
（`site/node_modules`、`site/dist`、`.qoder-sites/` 已被 `site/.gitignore` 排除）。
