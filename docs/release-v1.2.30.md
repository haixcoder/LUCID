# Lucid v1.2.30 — 正式版 / General Availability

**Lucid** 是 Claude Code 的 Workflow / Agent 执行实时透视查看器:零依赖(Python3 stdlib,无需 pip)、无构建步骤、只绑定 127.0.0.1、对数据源永远只读。

**Lucid** is a real-time web viewer for Claude Code workflows & agents: zero dependencies (Python3 stdlib), no build step, binds to 127.0.0.1 only, and treats `~/.claude/projects/` as strictly read-only.

## 安装 Install

**方式一 GitHub 市场 Option 1 — GitHub marketplace**

```bash
claude plugin marketplace add haixcoder/LUCID
claude plugin install lucid@kw-dev-plugins
```

**方式二 npm(本版新增)Option 2 — npm (new in this release)**

```bash
npx -y kw-lucid          # 一行安装 / one-liner install & upgrade
```

或 / or:

```bash
npm install -g kw-lucid
claude plugin marketplace add "$(npm root -g)/kw-lucid"
claude plugin install lucid@kw-dev-plugins
```

安装后在任意会话输入 `/lucid` —— 服务自启、浏览器自动打开(默认 http://127.0.0.1:8787)。
After install, run **`/lucid`** in any session — the service starts and your browser opens.

## 此版本能做什么 What it does

- 实时重建进行中执行:phase / agent 状态、最近工具、tokens、耗时(无权威 journal 时的尾窗启发式)
  Live reconstruction of in-flight runs: phases, agent status, recent tools, tokens, durations
- 每个日志 / 转录 / 回执都有"看到全文"的路径(展开即全文,拒绝只裁不展)
  Every log/transcript/receipt is fully viewable — summaries always expand to full text
- 会话卡区分"在等你"(⏸ 提问/授权)与"回合已完"(安静青色),飞书/通用 webhook 终态与等待推送
  Session cards tell "waiting on you" (⏸ ask/permission) apart from "turn finished" (quiet), with Feishu/generic webhook notifications
- 项目筛选、全文搜索、自动刷新、五主题五语种(中/英/西/法/德)
  Project filter, full-text search, auto-refresh, 5 themes × 5 languages
- 自启动 + 崩溃自动重启(SessionStart 钩子主入口;官方 monitors 为第二触发口)
  Auto-start & crash-restart (SessionStart hook + optional official monitors)

## 版本区间 Since v1.2.8(要点 highlights)

- 品牌 xray → **Lucid**;仓库对齐 haixcoder/LUCID
- 回合分组展示(一次输入=一个任务)、工具活动并入回合全文、按步全文深扫至 16MB
- 后台标签页节流补偿(切回即补扫)、告警分档、提示词回显、五语种 i18n
- 回归体系:后端 fixture 单测 + 真起服务 HTTP 全链路 + 前端无头桩 + 渲染黄金快照(`python3 tests/run_all.py`)
- **npm 发行通道**(kw-lucid 包自带市场,`npx -y kw-lucid`)+ **Apache-2.0** 许可证

---

前提 Prerequisites: macOS / Linux · Claude Code 2.0+ · Python 3.9+(npm 通道安装器另需 Node.js ≥16.7,插件本体仍是零依赖)
