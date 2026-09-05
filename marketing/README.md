# Lucid 宣传物料总览

目标:为 Claude Code 插件 **Lucid**(实时透视 Workflow / Agent 执行的本地网页查看器)在海外 + 国内平台做发布宣传。本目录每个文件都是**可直接粘贴发布的成稿**,按平台语气定制过。

- 仓库:`https://github.com/haixcoder/LUCID`
- 安装:`claude plugin marketplace add haixcoder/LUCID` → `claude plugin install lucid@kw-dev-plugins`
- 版本以发布时最新 tag 为准(本批物料基于 1.2.27+;正文中不写死版本号)

## P0 发布前必办(不做会翻车)

1. **补 LICENSE 文件**。仓库当前无许可证 = 法律上"保留所有权利",GitHub 页显示 "No license",宣传"开源"会被懂行的社区成员当场指出(HN/Reddit 尤其敏感)。建议 MIT(与零依赖的轻量气质一致),但**许可类型是作者的法律决定,须本人确认后再加**。
2. **GitHub 仓库设置**:About 填一句简介(下方"一句话定位"直接用)、加 topics(`claude-code`, `claude-plugin`, `workflow`, `dashboard`, `devtools`, `ai-agent`, `monitoring`, `python`, `zero-dependency`)、确认 README 首屏(logo + 截图 + 双语文链)展示正常。
3. **备一张 15~30s 屏幕录制 GIF**(跑一个真实 workflow,演示 2s 刷新 + 点开全文抽屉)。X / 小红书 / Product Hunt 没动图基本没有曝光;截 `assets/screenshot.png` 可作静态 fallback。
4. **英文截图/文案里避免暴露个人信息**:GIF 和截图会带项目路径、会话标题,发布前打码或换演示项目。

## 一句话定位(可复用)

- **EN**: Lucid — a zero-dependency, local-only web viewer that shows what every Claude Code agent is doing live: phases, tool calls, tokens, durations, and exactly which session is waiting on you.
- **CN**: Lucid —— 零依赖、纯本机的 Claude Code 实时透视面板:每个 phase / agent / 工具调用 / tokens 尽收眼底,「谁在等你回复」一目了然。

## 三句话电梯稿(长文开头通用)

1. **痛点**:Claude Code 的 Workflow 跑起来是黑盒 —— 运行状态要到跑完才落盘,终端里看不到卡在哪一步、哪个 agent 在烧 token、谁在等你授权。
2. **方案**:Lucid 读的是 Claude Code 自己落盘的状态文件(不拦截、不注入、不修改),用零依赖 Python 标准库渲染成 2 秒一帧的网页:phase 条、agent 生命体征、完整 prompt/result 全文抽屉。
3. **杀手锏**:会话层能分辨"真卡住等你"与"回合正常结束",页面 ⏸ 置顶高亮 + 飞书/通用 webhook 推送(不开浏览器也收得到)—— 真痛点是"它卡住了在等我",不是"它跑完了快来看"。

## 平台总表

| 优先级 | 平台 | 圈子/入口 | 物料文件 | 形式 | 语言 |
|--------|------|-----------|----------|------|------|
| ★★★ | Hacker News | Show HN | `overseas/01-hacker-news-show-hn.md` | 标题+正文帖 | EN |
| ★★★ | Reddit | r/ClaudeAI(主)、r/ClaudeCode | `overseas/02-reddit-claudeai.md` | 故事帖 | EN |
| ★★★ | dev.to | 长文(作海外内容锚点/被转发源) | `overseas/03-devto.md` | 技术长文 | EN |
| ★★★ | X / Twitter | 自建号 + 引述转发链 | `overseas/04-x-thread.md` | 推文串 | EN |
| ★★ | Product Hunt | 择期(周二~周四 PT 凌晨) | `overseas/05-product-hunt.md` | 发布页+首评 | EN |
| ★★ | GitHub awesome 清单 | awesome-claude-code 类仓库、builtwithclaude.com | `overseas/06-awesome-lists.md` | 提交条目 | EN |
| ★★★ | 掘金 | 标签 Claude Code / AI 工具 | `cn/01-juejin.md` | 技术长文 | CN |
| ★★★ | Linux.do | 「分享发现」 | `cn/02-linuxdo.md` | 分享帖 | CN |
| ★★★ | V2EX | /go/share | `cn/03-v2ex.md` | 短帖 | CN |
| ★★ | 即刻 | 「AI 编程」「读立雕」等圈子 | `cn/04-jike.md` | 短帖×2 | CN |
| ★★ | 知乎 | 文章 + 既有问题下答题 | `cn/05-zhihu.md` | 长文+答题模板 | CN |
| ★★ | 微信公众号 | 自建号/友人号转发 | `cn/06-wechat-mp.md` | 推文 | CN |
| ★ | 小红书 | 图文笔记 | `cn/07-xiaohongshu.md` | 短笔记+图计划 | CN |

## 建议节奏(总跨度 ~2 周,别一天全发)

| 日 | 动作 |
|----|------|
| D0 | P0 事项(LICENSE / topics / GIF / 打码)+ 物料终稿通读 |
| D1 | dev.to 长文上线(成为所有平台的链接落点);GitHub 仓库收尾 |
| D2 周二~周四 | **美东上午(~8–10 AM ET)**:Show HN 发帖 → 发出后 3 小时内秒回所有评论 |
| D2 同日 | Reddit r/ClaudeAI 发故事帖(与 HN 错开 1–2 小时);X 推文串发布 |
| D3 | r/ClaudeCode 等第二 subreddit 换语气再发(勿原文复读);awesome 清单提 PR |
| D4 | 掘金 + Linux.do 同发(CN 技术圈锚点);即刻短帖 |
| D5 | V2EX share;知乎发文章 + 挑 2–3 个既有问题答题 |
| D6–7 | 公众号推文(如需排版/配图缓冲可顺延) |
| D8+ | Product Hunt(需要_PH_预热:先攒 followers、找 hunter 或自评 teaser);小红书铺量 |
| 持续 | HN/Reddit/V2EX 评论区是二次流量源 —— 每条评论都回;有人提 issue 当天响应 |

## 各平台红线(违反 = 删帖/封号,比不发更糟)

- **HN**:一年只发一次同作品;绝不求赞/让朋友投票(vote fuzzing 会折叠帖子);URL 填仓库;正文别放跳转追踪参数。新号先在日常评论里养几天。
- **Reddit**:先看 subreddit 置顶规则(self-promo 政策);一个 subreddit 一篇、语气人味、放低广告浓度;评论区比帖子本身更重要。
- **V2EX**:广告味敏感,用"做完了分享"口吻,不堆感叹号;链接正常贴。
- **知乎**:外链可能被折叠 → 仓库地址同时用纯文本写一遍;优先在既有高热问题下答题(冷启动问题自问自答没流量)。
- **公众号**:正文不能直跳 GitHub → 仓库地址用**纯文本 + 后台"阅读原文"**挂 README;文中留"回复关键词"钩子。
- **即刻/小红书**:短、真、多图;小红书别堆外链,引导"评论区/主页"。
- **通用**:同一篇物料跨平台**必须本地化语气**,复读机式搬运在海外会被当成 spam;所有平台首发后 24h 盯评论。

## 物料里刻意不写的东西(防止翻车)

- 不写 star 数 / 用户数 / "最"字辈绝对化用语(无法举证,社区反感);
- 不贬低 Claude Code 官方(它是插件,不是对抗者;官方未来内建同类能力时话术要跟进);
- 竞品对比点到为止:海外同类(如通用 agent 观测平台 LangSmith/Langfuse 类)是"重型 SaaS、要接 SDK、数据出境",Lucid 差异是"零接入、纯本机、只读"——一句带过即可,不展开攻击。
