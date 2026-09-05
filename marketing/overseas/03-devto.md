---
title: "Stop Flying Blind: A Zero-Dependency Live X-Ray for Claude Code Agent Workflows"
description: "I built Lucid, a local-only Claude Code plugin that turns the state files Claude writes to disk into a 2-second-refresh web dashboard of every agent's vital signs."
tags: claudecode, ai, opensource, webdev
cover_image: https://github.com/haixcoder/LUCID/raw/main/assets/screenshot.png
---

# Stop Flying Blind: A Zero-Dependency Live X-Ray for Claude Code Agent Workflows

If you run Claude Code workflows with parallel subagents, you know the feeling: the terminal shows spinner dots, four sessions are open, and you have no idea which agent is stuck, what tool it's running, how many tokens the chain has burned — or whether one of those sessions has been quietly waiting 20 minutes for a permission prompt you never saw.

The root cause is boring but real: **Claude Code's workflow state only becomes a complete, readable artifact when the run finishes.** The run JSON is written on normal completion. In progress, the truth is scattered across a journal of `started`/`result` events and per-agent JSONL transcripts.

I built [Lucid](https://github.com/haixcoder/LUCID) to render that scatter as a live dashboard. This post is mostly about *how* — because the interesting problem wasn't the UI, it was rebuilding state from files nobody promised to keep stable.

## What you see

Type `/lucid` in any Claude Code session and a local web page opens (default port 8787):

![Lucid dashboard](https://github.com/haixcoder/LUCID/raw/main/assets/screenshot.png)

- **Run cards** — every workflow from the last N days: phase progress bar, one row per agent with status, latest tool call, tokens, elapsed time, plus run artifacts and a system-log tail. In-progress runs are pinned first and refresh every 2 seconds.
- **Full-text drawers** — click any agent or step row: the complete prompt/result is fetched, reconstructed by deep-scanning transcripts and the journal in reverse (1 MB blocks, up to 16 MB back) to replace the truncated preview.
- **Session monitor** — every session (even ones without subagents) classified: running / waiting / ended, and crucially **`input_required`** — with the wait reason split into *waiting for your answer* (a pending `AskUserQuestion`/`ExitPlanMode`), *suspected stuck on a permission prompt* (tool pending and silent ≥2 min), or *turn finished* (model handed control back normally — not an alert, and deliberately styled like it). Genuinely-stuck sessions float to the top, inverted ⏸ badge, counted in the dashboard's ALERT tile.
- **Webhook push** — a background thread sends Feishu/Lark or generic JSON webhooks when a workflow reaches a terminal state or a session starts waiting on you. No browser has to be open. The real pain is "it's stuck waiting for me", not "it finished, come look."

## How it works

Claude Code persists workflow execution under `~/.claude/projects/<project>/<session>/` as it runs. Observed in practice:

| File | When written | Contents |
|------|--------------|----------|
| `workflows/wf_*.json` | **only on completion** | full `workflowProgress`: agents, tokens, durations, phases, logs, result |
| `subagents/workflows/wf_*/journal.jsonl` | appended live | each agent's `started` / `result` events |
| `subagents/workflows/wf_*/agent-*.jsonl` | growing live | full agent transcripts (tail → latest tool call) |
| `workflows/scripts/<name>-wf_*.js` | at start | `meta.name` and phase definitions |

Lucid merges the two worlds: **completed runs read the rich run JSON; in-progress runs are rebuilt live** from journal + transcripts, with liveness anchored on a hard signal — `~/.claude/sessions/<pid>.json`, the registry of live Claude Code processes. Parent process alive + file activity within 30 min → `running`; process alive but silent → `stale`; process dead with unfinished agents → `aborted` (orphan detection was my favorite bug-killer: it distinguishes "I Ctrl-C'd a terminal" from "the run actually failed").

A few implementation notes that earned their keep:

**Cost-bounded reads.** Session transcripts get a 256 KB tail window by default; per-step full text uses a reverse deep scan (1 MB blocks, hard-capped at 16 MB) so you never pay O(transcript) per refresh — and if even the deep scan misses, the UI says "this step is beyond transcript retention" instead of silently showing a blank.

**Output is always fully viewable.** A rule I hold myself to: no truncated preview without an expand-to-full path. If the backend returns 30 log lines, the page shows 30 — data-source caps are *written into the UI* ("30 lines · 500 chars/line") so you know what "all" means.

**Rendering that survives polling.** Cards re-render by per-card diff: a finished run's data freezes → its HTML string is stable → its DOM is never touched, so expanded drawers and scroll position survive refreshes. Browsers also throttle hidden-tab timers to ~1 tick/minute, so on `visibilitychange`/`focus` the page catches up immediately — otherwise you'd type in the terminal, switch back, and still see stale state.

**Self-starting, then invisible.** A `SessionStart` hook (plus the official background monitors API where available) runs a tiny watchdog: TCP-probe the port, if down → start the server detached so it outlives the session; keep a resident loop that restarts it on crash. Day to day you never think about it.

## The constraints I'm weirdly proud of

- **Zero dependencies.** Python 3 stdlib only (`http.server` + `json` + friends). No pip installs, no npm, no build step at runtime. The frontend is written in TypeScript but ships pre-compiled into a single `index.html` — the plugin distribution contains nothing to build.
- **Local-only and read-only.** Binds `127.0.0.1`, never `0.0.0.0`. Reads `~/.claude/projects/`; the one directory it ever writes is its own config dir (`~/.claude/cc-viewer/`: config, PID, notification dedupe). All POSTs carry a same-origin guard, because a localhost server a random webpage can talk to is an exfiltration channel waiting to happen (DNS rebinding).
- **It intercepts nothing.** No hooks into the model loop, no MCP server, no proxy. Worst case, a future Claude Code file-format change means the viewer lags — your sessions are untouched.

There's a regression suite that keeps all this honest: backend tests drive real functions with fixtures, one test boots a real server subprocess and hits the full HTTP surface, and headless node tests load the *actual compiled frontend* against a DOM stub with golden HTML snapshots — every frontend refactor since has been verified byte-for-byte against them.

## Try it

Prerequisites: macOS/Linux, Claude Code 2.0+, Python 3.9+. Two commands — the repo is a standard Claude Code plugin marketplace:

```bash
claude plugin marketplace add haixcoder/LUCID
claude plugin install lucid@kw-dev-plugins
```

Then `/lucid` in any session. Source: [github.com/haixcoder/LUCID](https://github.com/haixcoder/LUCID) — issues welcome, especially "my status inference is wrong because…", since the tail-window heuristics are exactly where real-world usage beats my imagination.
