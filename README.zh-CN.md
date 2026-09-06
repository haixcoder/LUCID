# Lucid

<p align="center"><img src="assets/lucid-logo.svg" alt="Lucid" width="180"></p>

<p align="center"><b>让 Claude Code 的每一次 Agent 运行，一目了然</b><br>
实时透视 Workflow：每个 phase、agent、工具调用、tokens、耗时，2 秒一帧，尽数可见。<br>
零依赖 · 纯本机 · 只读</p>

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

<p align="center"><img src="assets/screenshot.png" alt="Lucid 界面截图"></p>

## Lucid 是什么

Lucid 是一个 **Claude Code 本地插件**：在工作流运行时打开一个网页，实时看到内部每个 agent 正在做什么——
从**全局仪表盘**（运行数 / 存活数 / 完成数 / 告警数）到**单个 agent 的生命体征**
（阶段、最近工具、token 消耗、耗时、pending 工具、完整 prompt / result），再到**会话层的操作步骤回溯**。

它不拦截、不注入、不修改任何东西——只读 Claude Code 自己落盘的状态文件，用零依赖的 Python 标准库服务呈现。

**为什么需要**：Workflow 运行时内部是黑盒。你想知道「它卡在哪一步」「这个 agent 在跑什么工具」「上那条链子烧了多少 token」——Lucid 就是为这个时刻准备的。

## 特性

- **实时透视**：进行中的运行由 journal + agent 转录实时重建，前端每 2 秒轮询刷新，且页面恢复可见/窗口回焦时立即补扫一轮（浏览器会把后台标签页的定时器降到约 1 次/分钟，不补扫就会出现「在终端输入完切回页面，看到的还是旧状态」）；已完成的读完整 run JSON（全量富数据）
- **Workflow 全景**：phase 条、agent 表格（状态 / 最近工具 / tokens / 用时）、运行产物、系统日志尾
- **会话监控**：主 agent（running / **input_required 等待用户** / waiting / ended）+ 全部非 workflow 子代理（task / teammate），pending 工具、权限模式、尾窗步骤表（**按 turn 回合分组：一次用户输入 + 它引发的全部步骤 = 一个独立展示单元**，输入行作组头、左色条成簇，不再把整段会话的步骤平铺一锅端）。等待原因再细分三档：**等待回答**（挂起 AskUserQuestion / ExitPlanMode）、**等待授权**（工具挂起且已静默 ≥2min，疑似卡在授权确认）——这两类是"真卡住、该你动手"，用反白 ⏸ 高亮徽标 + 左侧色条 +「在等 …」一行显示它在等什么；而**回合已完**（模型说完、正常交回话轮 = 执行完成，无挂起工具）只是"空闲等你下一句",不占用告警视觉：青色静态徽标、无色条、区标题 ⏸ 计数也不计（`notifyInput` 通知档位管的是推送，与页面显示各管各的）
- **提示词回显（回合组头）**：会话卡的每个任务单元以「❯ 你输入」行开头——把"用户真正打进来的话"从转录里提出来（自动剔除工具回执 / 系统注入 / 无参命令，`/goal …` 取 `<command-args>`），组头带时间戳与该回合步数徽章，展开即懒拉整条输入全文（记录 uuid 锚定，与步骤行同契约）；掉出尾窗的首条以「最初」标出；某步骤的开场输入超出尾窗时组头显式标注并仍可展开回取全文，绝不静默吞掉归属
- **纯交互会话也在列**：会话候选 = 转录 `<sess>.jsonl` ∪ 会话目录，没有子代理的会话同样出现在监控里（此前只遍历目录，恰恰漏掉最该提醒"在等你"的那个会话）
- **全文抽屉**：点击任意 agent / 步骤行展开详情——自动拉取完整 prompt / result（转录 + journal 深扫全文，替换截断预览），滚动位置跨轮询保持。全文在途约 1 秒，抽屉会先做一段渐变转场：拉取中 pane 有扫描光预告，到达时新内容淡入 + 一次性高光扫过，不再是"突然一闪换内容"。会话步骤的右侧输出面板按「回合」累计：一次回答常拆成多条消息（过渡文本+工具+收尾文本），抽屉会按时间序拼出该步所在回合（自上一条真人输入起）的全部输出，而不是只给最新一条。工具活动同样计入全文——`▸ 工具: 入参` 与 `◂ 工具: 回执` 逐条内联（单条回执超长会标注「截断」，命令发出但尚无回执标「未回执」）；此前只拼文本块时，模型"过渡句：→ 调工具"的回合在抽屉里只剩一串以冒号收尾的句子、冒号后永远没内容，1.2.18 修复
- **分型通知**：后台线程推两类**飞书**或**通用 JSON** webhook（不依赖浏览器开着）——① workflow 进入终态（completed / failed / killed）；② 会话进入 `input_required`「在等你」，独立一档可关可放宽（关闭 / 仅卡住时 / 全部含回合结束，默认**仅卡住时**），通用 JSON 里带 `kind` 字段供消费方分流。真痛点是「卡住了在等我」，不是「跑完了让我看」
- **自启动看护**：任意会话开始即检测服务、未运行自动拉起，崩溃自动重启——双触发口：官方后台 monitor（`monitors/monitors.json`，需 Claude Code ≥2.1.105 且宿主支持）＋ `SessionStart` 钩子兜底（`hooks/hooks.json`，任意版本可用）。两者都收敛到 `scripts/guard.py --detach`：按 guard.pid 幂等确保常驻看护循环在跑，服务与看护进程均独立于会话存活
- **多语言界面**：⚙ 设置 → 语言，五种常用语种（简体中文 / English / Español / Français / Deutsch），即点即生效、localStorage 记忆，首次访问跟随浏览器语言；界面文案（含卡片标签、pane 标题、空态、设置面板、通知回执）全部走同一文案层，缺译自动回落中文，不会出现空白
- **仪式感细节**：项目筛选、全文搜索（名称 / runId / 任务 / 状态）、自动刷新开关、五主题切换：☀ 日光台 / ☾ 磷光夜 / ❄ 冰原 / ⚡ 磁暴 / ◈ 墨铁（localStorage 记忆）、网页改端口保存即自动重启迁移
- **隐私友好**：只监听 `127.0.0.1`，只读 `~/.claude/projects/`，唯一可写目录是 `~/.claude/cc-viewer/`（配置 / PID / 去重记录）

## 原理

Claude Code 把 workflow 运行状态落盘在 `~/.claude/projects/<项目>/<session>/` 下（实测）：

| 文件 | 时机 | 内容 |
|------|------|------|
| `workflows/wf_*.json` | 仅完成时写入 | 完整 `workflowProgress`（agent 状态/tokens/耗时/phase）、logs、result |
| `subagents/workflows/wf_*/journal.jsonl` | 实时追加 | 每个 agent 的 `started` / `result` 事件 |
| `subagents/workflows/wf_*/agent-*.jsonl` | 实时增长 | agent 完整转录（tail 可得最近工具） |
| `workflows/scripts/<name>-wf_*.js` | 启动即写 | `meta.name` / phases |

服务合并两个数据源：**已完结的读 run JSON（全量），进行中的由 journal + 转录实时重建**。
状态判定（实例化实现）：

| 状态 | 判定规则 |
|------|----------|
| `running` | 父会话进程存活（`~/.claude/sessions/<pid>.json` 注册表）且 30 分钟内（`STALE_SEC`）有文件活动 |
| `stale` | 进程存活但 >30 min 无活动（疑似挂起） |
| `completed` | run JSON 正常收尾；或父进程已退出且无未完成 agent |
| `failed` / `killed` | run JSON 记录（agent 失败 / 用户终止） |
| `aborted` | 孤儿运行：父会话进程已死且仍有未完成 agent |

扫描范围：最近 N 天内有活动的 session 目录（N = 设置「回看窗口」，默认 14，可在 ⚙ 设置中调整）；已完结 run 的元数据进程内永久缓存。

## 安装

前提：macOS / Linux，Claude Code 2.0+，Python 3.9+（**无需 pip 任何东西**）。自启动主入口是插件 SessionStart 钩子（任意版本可用）；官方后台 monitor（`monitors/monitors.json`）作为同类触发口需 Claude Code ≥2.1.105 且宿主支持。

**方式一（推荐，GitHub 市场）**——本仓库即标准市场，任何机器均可安装：

```bash
claude plugin marketplace add haixcoder/LUCID                 # 即本仓库(marketplace.json, source="./")
claude plugin install lucid@kw-dev-plugins                    # 安装插件
# 版本锁定装法（可选，装 tag 快照）：
# claude plugin marketplace add haixcoder/LUCID#v1.2.5   后同 install
```

**方式二（npm）**——同一个插件经 npm registry 分发，包内自带市场。安装器需 Node.js ≥16.7（仅安装时用；插件本体仍是零依赖 Python）：

```bash
npx -y kw-lucid                      # 一行装:注册包内市场 + 安装(幂等,重跑即升级)
# 或显式全局安装:
npm install -g kw-lucid
claude plugin marketplace add "$(npm root -g)/kw-lucid"
claude plugin install lucid@kw-dev-plugins
```

**方式三（本地开发）**：

```bash
claude plugin marketplace add ~/projectDir/cc-viewer     # 注册本地市场(本目录兼作市场 kw-dev-plugins)
claude plugin install lucid@kw-dev-plugins                # 安装插件
```

> GitHub 与 npm 两个渠道共用市场名 `kw-dev-plugins`,二选一即可(`npx` 脚本检测到同名市场会保留已注册渠道)。

验证：

```bash
claude plugin list                       # 应见 lucid@kw-dev-plugins ✔ enabled
claude plugin details lucid@kw-dev-plugins  # 组件清单(lucid 命令、token 成本)
```

## 使用

在任意 Claude Code 会话中输入 **`/lucid`** —— 自动启动服务（默认端口 8787，网页设置优先）并打开浏览器。

或手动：

```bash
python3 scripts/server.py --port 8787   # 打开 http://127.0.0.1:8787
python3 scripts/server.py --stop        # 按 PID 文件优雅停止(免 lsof|kill)
```

`/lucid` 命令做的事：

1. 读 `~/.claude/cc-viewer/config.json` 取端口；
2. `curl /api/runs` 探测 —— 服务已在运行则直接复用；
3. 未运行则后台拉起 `server.py`，等 1 秒确认 200；
4. `open http://127.0.0.1:<PORT>` 并汇报进行/完成数量。

> 端口被占用时服务直接退出并提示改 config 或换 `--port`；**网页改端口保存后服务 `execv` 自重启到新端口（PID 不变），页面自动跳转**。

日常其实不需要手动启动：插件的 `hooks/hooks.json`（SessionStart，任意版本生效）与
`monitors/monitors.json`（后台 monitor，需 Claude Code ≥2.1.105 且宿主支持）都会在每次会话开始时
通过 `guard.py --detach` 确保服务在跑、崩溃自动重启 —— `/lucid` 只是顺便打开浏览器。
看护循环只写 `~/.claude/cc-viewer/server.log` 与 `guard.pid`，不影响任何既有配置。

## 页面功能

**顶部**：仪表盘（RUNS / TASKS / LIVE / DONE / ALERT 计数——统计的是当前筛选视图；TASKS = 主 agent 被调用的任务总次数，对回看窗口按完整转录精确计数、以每条输入自身时间戳落窗（不再有 256KB 尾窗漏计；跨窗口的长会话只计窗口内的任务；卡顶「任务 N」显示该会话的完整精确值）；有项目/搜索过滤时 RUNS 与 TASKS 显示「命中/总数」并悬停说明，避免误读为总数——项目过滤的命中即窗口内精确小计，搜索只能命中视图内会话）、项目筛选（列表 = 回看窗口内有会话活动的全部项目，不只列有 workflow 运行的）、全文搜索、自动刷新开关、版本角标；右上「⚙ 设置」：01 通知钩子（含「等待输入通知」档位与 ⏸ 分型测试按钮）/ 02 端口 / 03 主题 / 04 语言 / 05 自动扫描 / 06 回看窗口，其中主题·语言·自动扫描即点即生效，其余由底栏统一保存。

**运行列表**（进行中置顶）：状态徽章（running / completed / failed / killed / stale / aborted）、phase 条、agent 表格（状态 / 最近工具 / tokens / 用时）、任务详情、系统日志尾、运行产物。

**AGENT 状态区**（会话层）：主 agent 状态 / pending 工具 / 尾窗 tokens / 权限模式 / 最近输入输出 + 子代理表（类型 / 模型 / 状态 / 最近工具 / tokens / 最后活动）+ **回合分组区**（1.2.20）：尾窗最近 ≤30 条真人输入与各 ≤30 条步骤按回合聚成独立任务单元——「❯ 输入行」作组头（展开懒拉全文 + 步数徽章），该回合的步骤行挂在其下（工具 / 输出预览 / tokens / 时间），左色条成簇；只输入还未执行的新回合也自成单元。会话**真卡住**（等回答 / 等授权）时置顶高亮：反白 ⏸ 徽标 + 左侧色条 + 一行「在等 · 你的回复 / Bash」并带最后输出，区标题右侧计数 `⏸ 等待输入 N`；回合结束型（`waitReason=turn`）显示安静的青色「回合已完」、最后输出单行可展开，不计入 ⏸、不闪烁——**执行完成 ≠ 等待输入**。

**详情抽屉**：点击任意 agent / 步骤行全宽展开——自动从 `/api/agent` / `/api/subagent` 拉取**完整** prompt / result（转录 + journal 深扫，替换截断预览），pane 内可滚动且滚动位置跨轮询保持；由实体转义还原（`unent`）后经迷你 markdown 渲染器呈现（分段 / 列表 / 标题 / 围栏 / 表格）。

**输出一律可看全**：任何日志 / 转录 / 错误回执都不会"看一眼就到头"——长文走定高展示框 + 上下滚动（agent 全文、系统日志尾、运行产物、JS 渲染异常整条堆栈、设置面板的通知回执），摘要行（会话卡 ⏸ 等待行）可点开并自动拉取该步所在回合的累计全文成滚动框；后端只给 30 行日志就显示 30 行（不再前端砍半），单行 500 字、转录字段等**数据源上限会写在标题上**，取不到全文时显式提示「⚠ 该步已超出转录留存范围」，不会静默留白。

## 通知钩子

服务器后台线程（5s 一轮，不要求浏览器开着）推**两类**消息到飞书 / 通用 JSON：

| 类型 `kind` | 触发 | 正文 |
|------|------|------|
| `workflow_status` | workflow 进入终态（completed / failed / killed …） | 任务名 + 状态、描述摘要、项目与 runId、消费 token、用时、agent 完成数、产物概要 |
| `input_required` | 会话卡在「等你」 | `⏸ 会话 等待回答/等待授权(疑似)/等待输入: 标题`、项目 · 会话、**在等**哪个工具、已静默时长 + 权限模式、最后输出预览 |

`input_required` 单独一档（「⚙ 设置 → 通知钩子 → 等待输入通知」）：**关闭** / **仅卡住时**（默认，只发等回答·等授权）/ **全部**（含每轮回合结束——噪音大，适合你盯着多个会话时开）。
去重键含「本轮静默起点」，所以**一次等待只发一条**：你回话后活动戳前移，下次再等才算新事件；服务重启首轮静默播种，不补发历史。
状态本身是尾窗启发式推断（无权威 journal）：「等待授权」读作"疑似"——它与"某条长命令仍在跑"在转录里同形。配置入口在「⚙ 设置 → 通知钩子」，两个测试按钮分别验证两类通路。详见 [scripts/README.md](scripts/README.md)。

## HTTP API

| 端点 | 说明 |
|------|------|
| `GET /api/runs` | 全量运行快照（`{now, runs[], projects[], tasks}`；进行中由 journal/转录实时重建；`projects` = 回看窗口内有会话活动的全部项目，含没有 workflow 运行、当前也不活跃的项目；`tasks` = `{total, byCwd}`，以每条输入自身时间戳落在回看窗口内为准的完整转录精确计数，总数与按项目小计） |
| `GET /api/sessions` | 会话状态：主 agent（注册表判活 + 转录尾窗推断，status 含 `input_required` + `waitReason`/`waitTool`）+ `prompts`（卡顶提示词回显：尾窗用户输入摘要 + uuid + 首条 `f:1`）+ 执行步骤 + 全部非 workflow 子代理；候选 = 转录 ∪ 会话目录，含活跃会话与最近 2h 会话，上限 40 |
| `GET /api/agent?proj=&sess=&run=&agent=` | 单 agent 完整转录 + journal 事件（运行卡抽屉数据源） |
| `GET /api/subagent?proj=&sess=&agent=[&msg=]` | 会话层全文抽屉：`agent=main` 返回主会话最近输入/输出；加 `msg=<messageId>` 返回该步全文（IN=该步工具入参，OUT=所在回合累计输出），`msg=<uuid>` 返回该条用户输入全文（提示词回显锚点）；否则返回子代理任务与结果 |
| `GET /api/config` | 当前 webhook 配置 + 最近推送结果 |
| `POST /api/config/save` | 保存配置（URL 须 http(s)、端口 1-65535 且空闲、`recentDays` 1-3650 默认 14、`notifyInput` ∈ off/blocked/all（缺省不改）；改端口触发自重启） |
| `POST /api/config/test` | 发送测试通知验证连通；body `{"kind":"input_required"}` 则按等待型发一条 |

```bash
curl -s http://127.0.0.1:8787/api/runs | python3 -m json.tool
curl -s "http://127.0.0.1:8787/api/subagent?proj=<proj>&sess=<sess>&agent=main&msg=<msgId>"
```

## 安全

- 仅绑定 `127.0.0.1`，不对外网开放；
- 所有 POST 带同源 Origin 守卫（防任意网页 DNS rebinding 后改配置 / 重定向 webhook 做外泄通道），无 Origin 的脚本调用放行；
- webhook 的 HTTPS 在公司 TLS 代理下自动导出 macOS 钥匙串根证书完成校验，「跳过证书校验」仅作兜底。

## 项目结构

```
Lucid/
├── .claude-plugin/
│   ├── plugin.json        # 插件清单(名称/描述/版本,plugin manager 展示来源)
│   └── marketplace.json   # 市场清单 —— 本目录同时就是 kw-dev-plugins 市场(插件 source 为 "./")
├── assets/
│   ├── lucid-logo.svg     # 图标(Lucid 眼 + 焦点十字 + 心跳线)
│   └── screenshot.png     # 界面截图
├── frontend/              # 前端源码(TS,仅开发用;运行时零依赖不变)
│   ├── src/*.ts           # 00-types/05-i18n/10-util/20-render/30-app,按名序拼接为全局脚本
│   ├── template.html      # HTML/CSS 壳(手写;含 3 行主题 boot 内联脚本)
│   ├── build.py           # 构建:拼接→tsc --strict→注入产物到 scripts/ccviewer/static/index.html
│   └── dist/              # 中间产物(不进安装副本,git 忽略)
├── commands/
│   └── lucid.md         # /lucid 斜杠命令(commands/ 自动发现,无需在清单中声明)
├── hooks/
│   └── hooks.json         # SessionStart 钩子:会话开始跑 guard.py --detach(自启动主入口,任意版本可用)
├── monitors/
│   └── monitors.json      # 官方后台 monitor 声明(同 hook 效果;需 Claude Code ≥2.1.105 且宿主支持)
└── scripts/
    ├── server.py          # 入口:参数解析、启动/停止(核心逻辑在 ccviewer/ 包)
    ├── guard.py           # 自启动/看护:--detach 幂等确保常驻循环;循环探活未监听→setsid 分离启动 server.py,崩溃自动重启
    ├── README.md          # webhook 通知钩子详解
    └── ccviewer/          # 内核包(仅 stdlib)
        ├── config.py      # 路径/端口/PID 与配置读写
        ├── scan.py        # 扫描 ~/.claude/projects 与运行状态重建
        ├── agent.py       # 单 agent 完整 prompt/result 全文
        ├── sessions.py    # 主 agent + 非 workflow 子代理状态推断
        ├── notify.py      # webhook 终态通知线程(飞书/通用 JSON)
        ├── web.py         # HTTP handler(页面 + JSON API)
        └── static/index.html  # 前端运行时文件(由 frontend/ 构建产生;插件分发/运行时仍无构建)
```

## 架构速览

| 层 | 入口 | 要点 |
|----|------|------|
| 自启动看护 | `guard.py --detach` | 双触发口（SessionStart 钩子 + 官方 monitors，入口幂等）；常驻循环写 `guard.pid` 跨会话去重；TCP 探活未监听→setsid 分离启动 server.py（独立于会话存活）；周期复查崩溃自动重启 |
| 扫描/状态重建 | `scan.scan()` | run JSON 只在正常收尾时写；进行中状态由 journal.jsonl + agent-*.jsonl 实时重建 |
| 存活判定 | `scan.live_session_ids()` + `parse_live()` | 权威信号 = `~/.claude/sessions/<pid>.json` 注册表且进程存活；60s 宽限防竞态 |
| Webhook 通知 | `notify.notify_loop()` | 守护线程 5s 一轮；启动首轮静默播种防刷屏；去重靠 `sent.json`（保留 800 条） |
| HTTP 端点 | `web.class H` | 页面 + 上述 7 个 JSON API |

前端（`frontend/src/*.ts`，全局脚本模式按名序拼接）按**卡 diff** 渲染：完成卡数据冻结 → HTML 串稳定 → DOM 永不重建；仅数据真变的运行卡局部重建，重建时恢复展开态与滚动位置——所以多轮刷新不打断阅读。

## 开发

```bash
python3 frontend/build.py     # 前端:TS→tsc --strict→注入产物(首次自动抽 template.html)
claude plugin validate .      # 校验两份清单(CI 加 --strict)
python3 scripts/server.py     # 前台启动(默认 8787,config 优先)
```

铁律：

1. **零依赖**：`server.py` 与 `ccviewer/` 包只许 import stdlib；**前端只许 TS**，`index.html` 脚本块是 build 产物禁止手改；
2. **双路径陷阱**：插件安装后运行时加载的是缓存副本（`~/.claude/plugins/cache/kw-dev-plugins/lucid/<版本>/`），改完源码要同步 + 重装 + 重启服务进程；
3. **改版本才生效**：`plugin.json` 的 `version` 决定缓存目录，升版本后重装落到新 cache 目录，旧版本残留可清理。

## 已知边界

- 会话转录默认只读**尾窗 256KB** 控制成本；步骤全文走**按 msg 反向深扫（1MB 块，至 16MB）**——截图附件是 MB 级 base64 时会把旧步骤挤出尾窗，深扫也定位不到则前端显式提示「该步已超出转录留存范围」；
- 会话扫描只覆盖「活跃 + 近 2h」会话（上限 40）；run 扫描覆盖最近 N 天（近期「回看窗口」设置，默认 14）；
- 状态推断是尾窗启发式（无权威 journal），极端时序下可能有 ±60s 的判定延迟。
