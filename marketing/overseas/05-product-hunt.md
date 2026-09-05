# Product Hunt — 发布页物料

**时机**:周二~周四,PT 00:01 上架(抢占全天);上架前 3~5 天建 teaser 攒 followers。PH 现在允许开发者自助发布,但预热过的号流量明显更好。**先完成 dev.to/HN 首轮**,PH 吃的是二次扩散。

## 基本信息

**产品名**:Lucid

**Tagline(≤60 字符,三选一)**:

```
See what every Claude Code agent is doing, live
Local x-ray for Claude Code agent workflows
Real-time agent dashboard for Claude Code, zero setup
```

**短描述(≤260 字符)**:

```
Lucid is a free, zero-dependency Claude Code plugin: a local web dashboard showing every workflow phase, agent, tool call, and token count live — and flagging which session is stuck waiting on you, with webhook push.
```

**长描述(商品页正文)**:

```
Claude Code workflows are a black box until they finish. Lucid opens them up.

Type /lucid and a local web page shows, refreshed every 2 seconds: every run's phase progress, each agent's status / latest tool / tokens / elapsed time, and full prompt/result drawers (deep-scanned from transcripts, not truncated previews).

The session monitor tells you which sessions actually need you — waiting for an answer vs (suspected) stuck on a permission prompt — pinning them at the top, and optionally pushing Feishu/Lark or generic JSON webhooks so you don't even need the browser open.

100% local and read-only: Python 3 stdlib only, binds 127.0.0.1, intercepts nothing. 5 languages, 5 themes, self-starting watchdog.

Install:
claude plugin marketplace add haixcoder/LUCID
claude plugin install lucid@kw-dev-plugins
```

**Topics**: Developer Tools · Artificial Intelligence · Open Source · Productivity

## 图集(4–6 张,1270×760 优先)

1. 首图:截图 + 大字 tagline(设计感,黑底 + logo);
2. 运行卡全景(phase 条 + agent 表 + tokens);
3. 全文抽屉展开态(完整 prompt/result);
4. ⏸「在等你」高亮卡(等待回答/等待授权分型);
5. 五主题九宫格拼图;
6. 架构图简化版(读 Claude Code 落盘文件 → 本地服务 → 网页)。

## Maker 首评(上架后立刻自己发)

```
Hey Product Hunt! 👋

I built Lucid because I run several Claude Code sessions in parallel and kept
losing hours to one question: "what is it doing right now — and is it stuck
waiting on me?"

Claude Code's workflow state only becomes a complete artifact when the run
finishes. So Lucid rebuilds it live from the journal + transcripts Claude
already writes to disk — intercepting nothing, pip-installing nothing
(Python stdlib only), and never binding to anything but 127.0.0.1.

The feature I use most: session cards that distinguish "waiting for your
answer" from "suspected stuck on a permission prompt" — and push me a webhook
so I find out in seconds instead of discovering it an hour later.

Happy to answer anything — especially about the heuristic status inference
(there's no authoritative "what's happening now" journal, which made
distinguishing 'stuck on approval' from 'one long command' a fun problem).
```

## 注意

- 评论区别刷"upvote me",只引导"try it & tell me what breaks";
- 上架当天盯盘回复(前 4 小时权重最高);
- maker 首评里 "pip-installing nothing" 是记忆点,保留。
