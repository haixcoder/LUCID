# ROADMAP · lucid 插件扩展方向调研 (2026-09)

> 结论先行：**本插件的差异化价值是「零依赖、只读本地文件源、历史全量回看 + 网页工作台」**。
> 调研对标了 Claude Code 官方能力（hooks / statusline / 插件捆绑 MCP）与 3 个社区同类
> （claude-hud、claude-golden-eye、claude-code-hub），并结合本项目铁律排出优先级：
> **S0 共享数据源做透（成本 + 等待输入标记 + hooks 即时事件），S1 提供「查询入口」（MCP + 多渠道通知）**。
> 详见文末参考链接。

## 1. 现状能力清单（锚点）

| 能力 | 说明 |
|---|---|
| 实时运行监控 | 2s 轮询；run/phase/agent 状态、最近工具、tokens、耗时 |
| 历史回看 | run JSON 全量进程内缓存；「回看窗口」1-3650 天可配置 |
| 会话状态 | 主 agent + 子代理（尾窗启发式状态机 running/waiting/ended…） |
| 全文抽屉 | `/api/agent` `/api/subagent` 深扫（截图 base64 挤窗兜底） |
| 通知 | 终态 webhook：飞书 + 通用 JSON（workflow_status / input_required 两型）；测试按钮；去重键 2000 条 |
| 工作台 | 项目筛选 / 全文搜索（已 localStorage 持久化）/ 5 主题 / 5 语种 / 自动刷新 |
| 工程质量 | 回归测试入库（1.2.18）：`tests/run_all.py`＝后端 fixture + 真起服务的 HTTP 全链路 + 前端无头 DOM 桩/黄金快照 |

数据源（只读）：`~/.claude/projects/**` 的 run JSON、journal.jsonl、agent-*.jsonl、sessions 注册表。
**已具备、尚未利用的指标**：会话级 usage 四字段（input/output/cacheRead/cacheWrite，`sessions._analyze`）、
run 级 `durationMs`/`toolCalls`/`startTime` —— 成本面板与甘特视图**零新数据成本**。

## 2. 调研发现（关键事实与出处）

### 2.1 官方能力矩阵（哪些源能拿到什么）

| 数据源 | 能拿到 | 拿不到 | 备注 |
|---|---|---|---|
| 文件轮询（现状） | 一切落盘数据（run/agent/journal），权威 | 上下文占用率、官方成本、限流配额 | 轮询 = 2s 延迟；通知只能等终态文件 |
| **hooks**（`hooks/hooks.json`，插件可自带） | 28 种事件：`PostToolUse`(Workflow)、`Stop`、`SubagentStop`、`Notification`(agent_completed/agent_needs_input)、`SessionEnd`(带 `transcript_path`) | `SessionEnd` 输入**不含 usage/cost**（[官方 issue #50863/#50926](https://github.com/anthropics/claude-code/issues/50863)），成本须自行解析 transcript | 插件 hooks 放 `hooks/hooks.json`，**勿**在 plugin.json 声明（重复报错）；`http` 型 hook v2.1.63+ 可直接 POST；与用户 hooks 并行、顺序不定 |
| **statusline**（每条 settings.json 配置） | **官方算好的 `cost.total_cost_usd`**、`context_window.used_percentage`、`rate_limits.five_hour/seven_day`、`model.display_name` | 无（另有 `/cost` 内置命令） | 每次 assistant 消息后触发（300ms debounce）；stdin 喂 JSON，脚本 stdout 即状态行 |
| **插件捆绑 MCP**（plugin.json `mcpServers` 或 `.mcp.json`） | 让 Claude 在会话内直接调工具 | — | 路径用 `${CLAUDE_PLUGIN_ROOT}`；工具自动命名 `mcp__plugin_<plugin>_*`；stdio 即可（stdlib 手写 JSON-RPC，仍零依赖） |
| Agent SDK `streamEvents` | 消息级事件（message_start/delta…）+ `parent_tool_use_id`，**无 workflow_phase 事件** | 订阅的是 SDK 启动的会话——无法观测用户正常会话 | 对 lucid 架构无增量价值，放弃 |

### 2.2 社区对标（3 个同类项目 + 通知代理）

| 项目 | 形态 | 可借鉴的功能 |
|---|---|---|
| [claude-hud](https://github.com/jarrodwatts/claude-hud) | 终端 statusline 实时沉浸 | 上下文占用率进度条（绿→黄→红）、活跃工具/agent 列表；**证明 statusline 是低成本高频事件通道** |
| [claude-golden-eye](https://github.com/amenophis1er/claude-golden-eye) | web 只读仪表盘 + 双插件市场 | Live/Agents/**Timeline** 标签页、**桌面通知**（阻塞/停滞）、**MCP 让 agent 自报告**（report_progress / get_mission） |
| [claude-code-hub](https://github.com/NikiforovAll/claude-code-hub) | PWA 控制台 | **Cost 监控**、Kanban 的 **“等待用户输入”标记**、hooks 一键安装器 |
| [agent-notify](https://github.com/hellolib/agent-notify) / [agents-router](https://github.com/lumpinif/agents-router) | 通知代理（hooks 驱动） | 渠道矩阵：钉钉/企微/Slack/Telegram/ntfy/Pushover/邮件；事件分型（permission_required / input_required / run_completed / run_failed）；agents-router 有 **10s/5 条防风暴抑制** |

### 2.3 模型定价参考（成本估算用，第三方 2026-09 快照，**实现时以官方为准**）

| 模型 | 输入 $/M | 输出 $/M | 缓存读 | 缓存写 |
|---|---|---|---|---|
| Opus 5 / 4.8 | 5 | 25 | 0.1× | 1.25×/2× |
| Sonnet 5（9/1 起） / 4.6 | 3 | 15 | 0.1× | 1.25×/2× |
| Haiku 4.5 | 1 | 5 | 0.1× | 1.25×/2× |

注意：新 tokenizer 产出多 ~30% token；**官方精确值以 statusline `cost.total_cost_usd` 为准**，表格仅作 transcript 估算兜底。

## 3. 扩展方案（优先级排序）

### S0 · 近期（对现有架构零破坏，建议 2-3 个迭代）

**3.1 成本面板（Cost）** ⭐ 首推
- 方案：复用 `sessions.py:91` 的四字段聚合 + 定价表 → 估算 `costUSD`；run 卡展示「≈ $x」；新增仪表「COST 今日/本周」；按项目/日聚合视图。
- 数据：本地全有，零新依赖；**标注「估算」**（缓存写按 1.25×、不精确区分 5min/1h TTL）。
- 收益：社区（claude-code-hub）验证过的刚需；仅此一项即可让 lucid 从「看板」升级为「记账」。

**3.2 等待用户输入/阻塞标记 + 通知分型** ✅ 已实现（v1.2.10）
- 方案：已有 `stopReason`/pending 数据；把 session 卡状态细分「⏸ 等待用户输入」高亮；webhook 通知增加 `input_required` 类消息（区别于终态）。
- 收益：多数真痛点是「卡住了在等我」，而不是「跑完了让我看」。
- 落地：`sessions.main_state()` 三分成因（ask/permission/turn）→ 卡面反白 ⏸ 徽标 + 色条 +「在等 …」行；通知 `kind=input_required` 独立档位 off/blocked/all（默认 blocked＝只发真卡住）；去重键 `sess|<id>|<静默起点>`＝一次等待一条。**顺带修掉一个挡路的既有 bug**：会话候选原来只遍历目录，无子代理的纯交互会话（正是"在等你"的那个）根本不出现在 `/api/sessions`。
- v1.2.13 补丁①：页面显示按成因分档——ask/permission 才亮 ⏸ 告警（`sessStuck` 单点判定），turn（执行完成、正常交回话轮）显示安静青色「回合已完」、不计 ⏸/不闪/无色条；用户报"关了等待通知仍被提示等待输入"根因在此（档位只管推送，页面曾把 turn 一律告警化）。②卡顶「❯ 你输入」提示词回显（`_user_prompt` 剔除注入噪声/命令包装，uuid 锚点懒拉全文，首条「最初」兜尾窗外）。

**3.3 hooks 即时事件源（hooks/hooks.json）** ⭐ 架构升级点
- 方案：插件自带 `hooks/hooks.json`：
  - `PostToolUse`(Workflow) → POST `/api/poke`（触发立即重扫，2s→<100ms）
  - `Notification`(agent_needs_input / agent_completed) / `Stop` → 记录事件入 cc-viewer/ 并推送通知
- 关键约束（必须守住）：命令用 `${CLAUDE_PLUGIN_ROOT}`（铁律 4）；hook 脚本 python 3 stdlib（curl/urllib）且**服务不可达时静默退出**（exit 0）；POST 走 127.0.0.1 + Origin 校验不涉及（hook 非浏览器无 Origin，放行逻辑已兼容）；hooks 与用户 hooks 并行无害。
- 收益：轮询 → 事件驱动；通知从「文件落盘后才发现」变「事件即达」；为 S1 的 MCP/报表铺路。

### S1 · 中期（1-2 个迭代，形成护城河）

**3.4 插件捆绑 MCP server（lucid-mcp）** ⭐ 差异化主打
- 方案：`plugin.json` 声明 `mcpServers`（stdio，`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/mcp_server.py`，纯 stdlib JSON-RPC，复用 `scan.sessions`）；工具：`list_runs` / `run_detail` / `search_runs` / `cost_summary`。
- 核心价值：**让 Claude 本人在会话里查询历史**（「查下上周那两个失败的 workflow 复现了什么」）——viewer 从被动看板变主动记忆，与 golden-eye 的 MCP 自报告互为镜像。
- 风险：MCP 子进程每次启动独立扫描（无进程内缓存）——工具实现里按请求后 6s 缓存即可；只读接口天然安全。

**3.5 多渠道通知 + 过滤规则**
- 方案：webhook 目标支持多实例（数组化了 URL 或 channel 枚举：钉钉/企微/ntfy/Telegram/Pushover，参考 agents-router 渠道参数）；通知条件：按项目/状态/耗时阈值（参考 ai-cli-complete-notify）；10s/5 条抑制（防风暴）。
- 收益：飞书之外覆盖企业/个人多样化场景；过滤规则减少噪音。

**3.6 Timeline / 甘特视图**
- 方案：run 卡 phase 时间轴（`startedAt`+phase `index`/`tokens`/`durationMs` 已有；`workflowProgress` 里可能含时间戳，缺则用 agent-*.jsonl 边界推断）；会话级「事件时间线」参考 golden-eye Timeline 页。
- 收益：一眼看「哪里花了时间/哪个 agent 慢」，运行复盘刚需。

### S2 · 远期（随生态走）

- **statusline 桥接（可选采集器）**：插件提供 `/wf-bridge` 安装命令写 settings.json 的 statusLine → POST 每轮 `cost/context/rate_limits` 到服务：精确成本、上下文占用率展示、配额警示。成本精确化 +「终端侧沉浸感」（claude-hud 已验证）。前置 = 用户显式启用。
- **URL 深链/分享**：筛选/run 选中态进 URL query（`?proj=&run=`），跨设备粘贴直达 + 浏览器历史回退。
- **统计报表**：每日/每周 cost & run 摘要推送（复用 webhook 通道）。
- **DAG 视图**：从 workflow script 解析 `agent()/parallel()` 依赖画图（风险：script 解析脆，作为长期探索项）。

## 4. 明确不做（铁律边界，防御性拒收）

| 方向 | 原因 |
|---|---|
| 0.0.0.0 监听 / 远程访问 / 多机同步 | 铁律 3 仅本机 + Origin 守卫；如真做共享必须签名 token，仍不做 |
| 写 `~/.claude/projects/` | 铁律 2 只读 |
| runtime 第三方依赖（npm/pip 装机） | 铁律 1 零依赖；构建期 node（tsc）不受限 |
| Agent SDK 实时订阅 | 无法观测用户正常会话（见 2.1），轮询+hooks 是正确架构 |
| 托管云端 | 数据是本机私有，违背产品立场 |

## 5. 参考链接

官方能力：
- Hooks 参考：[code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)、[hooks-guide](https://code.claude.com/docs/zh-TW/hooks-guide)
- Statusline：[code.claude.com/docs/en/statusline](https://code.claude.com/docs/en/statusline)
- 插件捆绑 MCP：[code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)、[plugin-dev mcp-integration SKILL](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/plugin-dev/skills/mcp-integration/SKILL.md)
- SDK 流式输出：[agent-sdk/streaming-output](https://code.claude.com/docs/pt/agent-sdk/streaming-output#1)
- hook 无 cost 字段诉求：[issue #50863](https://github.com/anthropics/claude-code/issues/50863)、[#50926](https://github.com/anthropics/claude-code/issues/50926)

社区：
- [claude-hud](https://github.com/jarrodwatts/claude-hud) / [claude-golden-eye](https://github.com/amenophis1er/claude-golden-eye) / [claude-code-hub](https://github.com/NikiforovAll/claude-code-hub)
- [agent-notify](https://github.com/hellolib/agent-notify) / [agents-router](https://github.com/lumpinif/agents-router) / [ai-cli-complete-notify](https://github.com/ZekerTop/ai-cli-complete-notify)

定价：第三方快照（Morph/BenchLM/Ofox 2026），实现时以 [anthropic.com/pricing](https://www.anthropic.com/pricing) 为准。
