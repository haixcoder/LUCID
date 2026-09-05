# Hacker News — Show HN

**发帖方式**:New → submit,类型选 Show HN,URL 填仓库地址。
**时间**:美东时间 周二~周四 08:00–10:00(流量峰值);发后 3 小时内逐条回复所有评论。

## 标题(≤80 字符)

```
Show HN: Lucid – Live dashboard for Claude Code agents (zero deps, local-only)
```

备选(更强调痛点,二选一):

```
Show HN: I built an X-ray for Claude Code's black-box agent workflows
```

## 正文(text field)

```
Claude Code writes workflow state to disk as it runs (a journal + per-agent
transcripts under ~/.claude/projects/), but it only becomes readable output
when the run finishes. Meanwhile your terminal shows ... spinning dots. I
couldn't tell which step was stuck, what tool an agent was actually running,
how many tokens a chain burned — or which of my four sessions was waiting on
an approval prompt I hadn't seen for 20 minutes.

Lucid is a Claude Code plugin that turns those state files into a live web
page. No interception, no injection, no modification — it only reads what
Claude Code itself writes, and serves it through a dependency-free Python
stdlib server bound to 127.0.0.1.

What you get:

- A dashboard of every run: phase progress, per-agent status (latest tool
  call, tokens, elapsed), pinned live and rebuilt from the journal +
  transcripts every 2 seconds
- A full-text drawer: click any agent or step row and the complete prompt /
  result is reconstructed by reverse deep-scanning the transcripts (1MB
  blocks, up to 16MB back) — replacing truncated previews
- Session monitoring: the main agent's state is classified into running /
  waiting / input_required, and input_required splits further into "waiting
  for your answer" vs "stuck on a permission prompt" (silent ≥2 min). Truly
  stuck sessions float to the top with a ⏸ alert — and can push you a
  Feishu/Lark or generic JSON webhook, no browser open
- Zero dependencies: macOS/Linux, Python 3.9+, nothing to pip install;
  self-starting watchdog via SessionStart hook; 5 languages, 5 themes

Install (two commands, it's a standard GitHub marketplace):

  claude plugin marketplace add haixcoder/LUCID
  claude plugin install lucid@kw-dev-plugins

Then type /lucid in any session. Repo: https://github.com/haixcoder/LUCID

Happy to answer questions about the state-rebuild heuristics — the fun part
was that "waiting for permission" and "one long command still running" look
identical in the transcript, so I had to learn to say "suspected".
```

## 评论区预案(高频问题 → 口径)

| 可能的问题 | 回答口径 |
|------------|----------|
| "为什么不用现成的 observability(LangSmith 等)?" | 那些要接 SDK / 传数据出境 / 有账号体系;Lucid 零接入、纯本机、只读,专为 Claude Code 本地态设计。 |
| "直接 parse JSONL 不脏吗/格式变了怎么办?" | 承认:是的,数据源无官方契约,格式跟随成本存在;这也是只读+本机的好处 —— 坏了解析不影响你的会话。 |
| "安全吗?" | 只绑 127.0.0.1,唯一可写目录是它自己的配置目录;POST 有 Origin 同源守卫防 DNS rebinding。 |
| "支持 Windows?" | 目前 macOS/Linux(stdlib 里 setsid 是 POSIX 的);欢迎 PR。(诚实回答,不画饼) |
| "和 `claude --verbose`/官方 output-style 比?" | 官方输出是会话内文本流;这个是跨会话/跨 workflow 的结构化仪表盘 + 推送,互补。 |

## 注意

- 同一年别对同一作品重复 Show HN。
- 正文末尾的"彩蛋段"(permission vs long command 同形)是引发技术讨论的钩子,别删。
- 不要在任何渠道转发"帮我投票"。
