# Reddit — r/ClaudeAI(主)/ r/ClaudeCode(次)

**先做**:读 subreddit 置顶规则里关于 self-promotion 的条款;账号先有正常互动历史(karma 太低的链接帖会被自动过滤)。两个子版错开 1 天以上,换语气,别复读。

---

## 帖子 1 — r/ClaudeAI(故事型,主帖)

**标题**:

```
I built a free, zero-dependency local web viewer that shows what every Claude Code agent is doing in real time
```

**正文**:

```
Context: I run several Claude Code sessions at once and lean hard on workflows
with parallel subagents. The problem was I kept flying blind — workflow state
only lands in a readable form when the run finishes, and until then I had no
idea which agent was stuck, which tool was hanging, how many tokens a chain
had burned, or (most expensive of all) which session had been waiting 20
minutes for a permission prompt I couldn't see.

So I built Lucid, a Claude Code plugin. Type /lucid and you get a local web
page that shows, updating every 2 seconds:

• every workflow run: phase progress, per-agent status, latest tool call,
  tokens, elapsed time
• click any agent or step → a drawer with the FULL prompt/result (it deep-
  scans the transcripts in reverse, so you get complete text, not the
  truncated preview)
• a session monitor that figures out which sessions are actually waiting on
  YOU (pending question vs suspected stuck-on-approval) and pins them at the
  top with an alert
• optional webhook push (Feishu/Lark or any JSON endpoint) — so "it's stuck
  waiting for approval" reaches your phone even with the browser closed

Design things I care about:

– zero dependencies: pure Python 3 stdlib, no npm, no pip, no build step at
  runtime
– it intercepts nothing — only reads the state files Claude Code already
  writes to disk; binds 127.0.0.1 only; read-only everywhere except its own
  config dir
– UI in 5 languages (EN/中文/ES/FR/DE), 5 themes, project filter, full-text
  search

Install is two commands (it's a GitHub-hosted marketplace):

  claude plugin marketplace add haixcoder/LUCID
  claude plugin install lucid@kw-dev-plugins

Repo: https://github.com/haixcoder/LUCID

Open to criticism — especially on the status inference, which is heuristic
(journal + transcript tail windows) because there's no authoritative "what
is it doing right now" journal. Curious what signals the rest of you watch
for when babysitting long workflows.
```

**要点**:结尾用提问引讨论,Reddit 帖的热度活在评论区。

---

## 帖子 2 — r/ClaudeCode(短版,换角度)

**标题**:

```
/lucid — see which Claude Code session is stuck waiting on you (free plugin, local-only, no deps)
```

**正文**:

```
The multi-session pain: three Claude Code tabs open, one workflow running in
the background, and you have no idea if anything needs your input until you
alt-tab through all of them.

I wrote a plugin for exactly this. It reads the state files Claude Code
already writes (~/.claude/projects/...), serves a local page (127.0.0.1,
Python stdlib, zero installs) that shows every run + agent live, and flags
sessions that are input_required — waiting for an answer or (suspected) stuck
on a permission prompt. Optional webhook (Feishu/Lark or generic JSON) so you
get pinged without a browser open. Click any row for the full prompt/result,
deep-scanned from the transcripts.

claude plugin marketplace add haixcoder/LUCID
claude plugin install lucid@kw-dev-plugins
then /lucid

https://github.com/haixcoder/LUCID — feedback welcome.
```

---

## 评论区常用弹药

- 被问"和官方 /workflows UI 区别":官方面板是会话内的;这个是跨会话、跨 run 的总览 + 历史回看 + 推送,并且会话层的等待检测不依赖 workflow。
- 被问"数据会不会上传":不会,唯一网络行为是你自己配置的 webhook;服务只绑本机。
- 被报 bug:回复 + 引导开 GitHub issue,当天修当天回 —— 小工具最好的广告是修 bug 速度。
