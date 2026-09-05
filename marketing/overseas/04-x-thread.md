# X / Twitter — 推文串 + 单发版

**配图**:Tweet 1 必须带动图(15~30s 屏幕录制:workflow 跑动中 → 点开某 agent 全文抽屉)。仓库链接放最后一推(HN/Reddit/dev.to 可交叉引)。发布后 24h 内回所有引用。

## 主推文串(8 推)

```
1/ Claude Code just launched 11 subagents in parallel.

Which one is stuck? What tool is it running? How many tokens has the chain
burned? Which of my 4 sessions is waiting on an approval I haven't seen?

The terminal tells you: nothing. So I fixed it. 🧵
```

```
2/ Meet Lucid — a Claude Code plugin that x-rays your agent workflows in
real time.

/lucid opens a local web page. Every phase, every agent's status, latest
tool call, tokens, elapsed — a fresh frame every 2 seconds.

[ GIF ]
```

```
3/ It intercepts nothing and injects nothing.

Claude Code already writes workflow state to disk (journal + per-agent
transcripts) as it runs. Lucid just reads those files and rebuilds what's
happening right now.

Zero dependencies: Python 3 stdlib. No npm. No pip. No build.
```

```
4/ My favorite feature: session monitoring that knows WHICH session needs
you.

⏸ waiting for your answer
⏸ suspected stuck on a permission prompt
○ turn finished (normal — no fake alert)

Stuck sessions float to the top, inverted.
```

```
5/ And you don't have to watch the page.

A background thread pushes webhooks (Feishu/Lark or any JSON endpoint):
— a workflow hit a terminal state
— a session started waiting on you

The real pain is "it's stuck waiting for me", not "it's done, come look".
```

```
6/ Details I'm proud of:

· click any agent → FULL prompt/result via reverse deep-scan of transcripts
  (not a truncated preview)
· finished cards never re-render, so scroll + expanded drawers survive every
  2s refresh
· binds 127.0.0.1. read-only. your data never leaves the machine.
```

```
7/ Install (it's a GitHub marketplace, 2 commands):

claude plugin marketplace add haixcoder/LUCID
claude plugin install lucid@kw-dev-plugins

then /lucid in any session.

github.com/haixcoder/LUCID
```

```
8/ Free, open source, 5 languages, 5 themes, self-starting watchdog.

If you've ever alt-tabbed between 4 Claude Code tabs playing "where's the
blocker?" — this is for you. RT appreciated 🙏
```

## 单发版(引用/转发时用,~270 字符)

```
Lucid — a zero-dep, local-only Claude Code plugin that shows what every agent
is doing live: phases, tool calls, tokens, and which session is stuck waiting
on you (webhook push included).

Reads the state files Claude Code already writes. Intercepts nothing.

→ github.com/haixcoder/LUCID
```

## 注意

- 别用 `#hashtag` 堆砌(X 算法已不吃这套),最多 1 个或不用;
- 同一内容 3 天内别重发;有增长就 pin 到主页;
- 动图控制在 <5MB、循环播放、无声音;路径/会话标题先打码。
