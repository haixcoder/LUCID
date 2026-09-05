# XRay 功能扩展调研 · 2026-09

> 状态:**定稿 v1.1**。定位:根目录 `ROADMAP.md`(2026-09 初版)的**深化与勘误**。
> 证据等级(全文每条结论都带标签,无标签句为推理/建议):**[L]=本机实测**(2026-09-05 对 `~/.claude` 全量探查);**[A]=本机官方镜像直读**(anthropics 官方市场 `claude-plugins-official` 的 plugin-dev 技能文档,`~/.claude/plugins/marketplaces/…/skills/`,**版本落后于线上文档**);**[W]=本会话 WebSearch 命中摘要**(本环境 WebFetch 被企业网关拦截,只能取摘要,原文未读);**[S]=调研子代理线索**(4 路子代理报告的细节,本会话未能独立复现——只入 §3.5 清单,不作设计依据);**[K]=模型训练知识**;**[R]=ROADMAP 沿用**(初版引用,本轮未重复核实)。
> **过程透明**:曾派 4 路联网调研子代理(hooks/成本/插件系统/生态),四份报告全部交回(其后四路均另报 API 400 闲置错误,不影响已送达报告);子代理同样受 WebFetch 拦截所限,其引文=搜索摘要级——凡与本会话直接检索/实测/镜像一致者按对应等级采信,仅见于子代理报告的细节一律降级为 [S]。

## 0. 结论先行 · 优先级矩阵

> 价值 = 用户痛点强度×受益面;成本=人日(含 TDD 与真机);★=本次调研新增或论断被实测改写。

| 序 | 方案 | 价值 | 成本 | 数据就绪度 | 建议批次 |
|----|------|------|------|------------|----------|
| E1 | 成本面板(官方值+估算三态)★ | 高(**实测发现官方算好的 costUSD 就在转录里**,自建定价表降级为兜底) | 1–2d | ✅ D2/D1 [L] | 第 1 批 |
| E2 | 时间线/甘特 ★ | 高(多 agent 并行复盘刚需) | 2–3d | ✅ D3 [L] **时间戳已在 run JSON 里,扫描层白丢** | 第 1 批 |
| E11 | hooks 即时事件(/api/poke) | 高(轮询→事件驱动;通知即时性同受益) | 1–2d | ✅ hook 通道被 xray 自身 guard 自证可靠 [L];http-hook 型 [W] | 第 1 批(为 E12/13 铺路) |
| E9 | 桌面通知+声音 | 中(零配置补齐 webhook 未配场景) | 1d | ✅ 纯前端 [K] | 第 1 批(便宜) |
| E3 | 文件改动 diff 回看 ★ | 高(「这次任务改了什么」是回看型工具王牌) | 2–3d | ✅ D11 [L](映射结构已 spike) | 第 2 批 |
| E12 | 捆绑 MCP 反向查询 | 高(差异化主打;服务不跑也能查) | 2–3d | ✅ 官方镜像标准能力 [A] | 第 2 批 |
| E4 | 错误/工具失败聚合 ★ | 中高 | 1–2d | ✅ D18/D7 [L] | 第 2 批 |
| E5 | 插话/队列+模式时间线 ★ | 中(回合分组 1.2.20 的解释器) | 1d | ✅ D6/D9 [L] | 第 2 批 |
| E6 | 钩子健康+/goal 面板 ★ | 中(实测当场抓到真实钩子故障) | 1–2d | ✅ D7/D8 [L] | 第 2 批 |
| E13 | statusline 桥(context/rate) | 中(context 占用/配额是**转录里没有**的独家数据) | 1–2d | ⚠️ 字段存在 [W];具体键名有出入,实测后定 | 第 2–3 批 |
| E14 | 多渠道通知矩阵+过滤+抑制 | 中(先确认受众再投入) | 2–3d | ✅ sent.json 去重本就渠道无关 [L] | 第 3 批 |
| E15 | 代理团队花名册 ★ | 中(随 agent-teams 采用率上涨) | 1–2d | ✅ D13 [L] | 第 3 批 |
| E7 | 后台任务输出 tail ★ | 中高(现在完全黑盒) | 1–2d | ⚠️ D15 [L](/tmp 未文档化,防御式) | 第 3 批 |
| E8 | 全局输入历史搜索 ★ | 中 | 1d | ✅ D16 [L] | 第 3 批 |
| E10 | URL 深链 | 中 | 1d | ✅ | 第 3 批 |

**一句话战略**:xray 的护城河不在「又一个 viewer」,而在**把只读转录里已有却没人挖的数据面(cost-state、版本快照、插话流、钩子回执)变成可解释的界面**——E1–E6 全部零新数据源、零依赖、零网络出口,与铁律完全同向 [L 支撑]。

## 1. 现状能力盘点(锚点)

- 后端:`scripts/ccviewer/` 六模块(scan/sessions/notify/web/agent/jsonl/config),2s 轮询 + 尾窗启发式 [L];
- 前端:运行卡 + 会话卡(回合分组 1.2.20)+ 全文抽屉 + 5 主题 5 语种 [L];
- 通知:飞书/通用 JSON 双格式,`workflow_status` + `input_required` 两型,档位 off/blocked/all [L];
- 工程:16 套回归测试(后端 fixture + 真 HTTP 全链路 + 前端无头 DOM 桩/黄金快照)[L]。

## 2. 数据源实证地图(2026-09-05 对 `~/.claude` 全量探查,全部 [L])

本机 24 个项目、286 个转录文件、162.9MB。下表逐项**实测**,不是文档转述:

| # | 数据源 | 实测内容与证据 | xray 现状 | 扩展含义 |
|---|--------|----------------|-----------|----------|
| D1 | 主转录 `message.usage` | 每条 assistant 记录都带 `input_tokens/output_tokens/cache_read_input_tokens/cache_creation_input_tokens`,另有 `server_tool_use/service_tier/iterations/speed/output_tokens_details`(934/934 条命中) | ✅ 已聚合(尾窗四字段) | token 统计地基已牢 |
| D2 | **`cost-state` 记录** | 转录**末尾**一条:`totalCostUSD`/`totalAPIDuration`/`totalAPIDurationWithoutRetries`/`totalToolDuration`/`totalLinesAdded/Removed`/`totalDuration`/`startTime`/`modelUsage{每模型 inputTokens/outputTokens/cacheRead/cacheCreation/webSearchRequests/costUSD}` | ❌ 未读 | **成本面板无需自建定价表**;4 个历史会话实测均在文件 100% 位置、进行中会话无 → 需「官方值(历史)+usage 估算(实时)」双口径 |
| D3 | `run JSON.workflowProgress[]` | 每条 agent 带 `queuedAt/startedAt/lastProgressAt/durationMs/tokens/toolCalls/model/state/attempt/lastToolName/lastToolSummary/promptPreview/resultPreview` | ⚠️ `scan.py:114-121` 只抄 6 字段,**三个时间戳全被丢弃** | **甘特/Timeline 零新数据成本**,只差透传 |
| D4 | 记录级 `timestamp` | 每条转录记录都有 ISO 时间戳(主/子代理通用) | ⚠️ 仅用于步骤行显示 | 进行中 run 的时间线由记录流重建;**journal.jsonl 实测只有 started/result 两型、无时间戳**,不能指望 |
| D5 | `run JSON.script` | workflow 脚本全文内嵌(另有 `workflows/scripts/<name>-wf_*.js`) | ⚠️ 只用于解析 phases 标题 | DAG 依赖图有原料(风险:脚本 AST 解析脆) |
| D6 | `queue-operation` 记录 | 回合进行中插话的入队/出队:`operation:enqueue/remove` + `reason:absorbed_mid_turn` + content | ❌ 未读 | 「插话/打断」可视化;回合边界解释更准 |
| D7 | `attachment` 记录族 | 实测类型:`hook_success`(command/exitCode/**durationMs**/stdout/stderr)、`hook_system_message`、`goal_status`(条件+met/sentinel)、`deferred_tools_delta`、`skill_listing`、`agent_listing_delta`、`total_tokens_reminder` | ❌ 未读 | 钩子性能面板——实测当场抓到真实故障 `Hookify import error: No module named 'hookify'`(PreToolUse 钩子静默失败,没人看得见);/goal 目标态上卡 |
| D8 | `system` 记录 | `subtype:stop_hook_summary`(hookCount/hookInfos{command,durationMs}/hookErrors/**preventedContinuation**/stopReason)、`local_command` | ❌ 未读 | 「回合为什么被拦/钩子报了什么」诊断 |
| D9 | `mode` / `permission-mode` 记录 | 会话模式历史(normal…)与权限模式变更流 | ⚠️ permissionMode 只取当前值 | 模式切换时间线 |
| D10 | `ai-title` / `slug` | 会话 AI 标题(实测「README.md 英文版本」) | ✅ 已用 | — |
| D11 | `file-history-snapshot/delta` + `~/.claude/file-history/<uuid>/<hash>@vN` | 版本文件**原文**可读;映射实测:`snapshot.trackedFileBackups={相对路径:{backupFileName:"<hash>@vN",version,backupTime,realParentDir}}` | ❌ 未读 | 「本次任务改了哪些文件、diff 前后版本」——回看型王牌 |
| D12 | `~/.claude/sessions/<pid>.json` | 除 pid/sessionId 外实测有 `status/name/nameSource/kind/entrypoint/messagingSocketPath/peerFeatures(notify_idle,reply_across_default_dirs,artifact_yield)/pidDomain/version` | ⚠️ 只用 pid 存活性 | ①`status/updatedAt` 可校验启发式;②socket+peerFeatures 证明**存在跨会话消息通道**(「从网页回复会话」理论可达,未公开协议→§6 拒写只读) |
| D13 | `~/.claude/teams/<team>/config.json` + `inboxes/*.json` | 成员表(leadAgentId/members[agentId,agentType,tmuxPaneId,joinedAt])+ 每 agent 收件箱数组(实测本机 session 团队已有) | ❌ 未读 | 代理团队花名册与消息流(只读) |
| D14 | `~/.claude/tasks/`(69 项) | 会话任务清单容器(本机最新样例为空,结构存在) | ❌ 未读 | todo 进度条;路径细节实现时再核 |
| D15 | `/tmp/claude-501/<proj-slug>/<sess>/tasks/*.output` | 后台 Bash 任务**原始输出流**(实测 22 个,最大 743KB;目录名含 uid) | ❌ 未读 | 「正在跑的后台命令输出」tail——黑盒补白;路径未文档化→防御式 |
| D16 | `~/.claude/history.jsonl` | 全局输入历史 `{display,pastedContents,project,sessionId,timestamp}`(144KB) | ❌ 未读 | 全局「搜我说过的话」 |
| D17 | `~/.claude/telemetry/1p_failed_events.*` | 内部遥测 `tengu_*` 事件,**实测含 `tengu_unknown_model_cost`** | ❌ 刻意不读 | 反证:网关/未知模型下 cost 折算不可信(本机 qwen 网关被按牌价算出 $16.4);私有格式禁作数据源 |
| D18 | `error/isApiErrorMessage/apiErrorStatus` + `user.toolUseResult{stdout,stderr,interrupted,isImage,noOutputExpected}` | API 错误与工具回执结构化字段实测存在(Agent 工具回执还含 name/agent_type/status/team_name/tmux_* 字段) | ❌ 未读 | 错误聚合、工具失败率 |
| D19 | 记录 `gitBranch/cwd/entrypoint/version` | 每条记录都带 | ⚠️ 未上卡 | 按分支过滤;CC 版本分布排障 |

## 3. 官方能力通道(核实结论)

### 3.1 Hooks
- **配置与 I/O 契约 [A·镜像原文]**:插件 `hooks/hooks.json`;类型 `command` 与 `prompt`(prompt 型限 Stop/SubagentStop/UserPromptSubmit/PreToolUse,LLM 裁决)均可配 `timeout`;stdin 公共字段 `session_id/transcript_path/cwd/permission_mode/hook_event_name`,专有 PreToolUse/PostToolUse=`tool_name/tool_input/tool_result`、UserPromptSubmit=`user_prompt`、Stop/SubagentStop=`reason`;env 提供 `$CLAUDE_PROJECT_DIR/$CLAUDE_PLUGIN_ROOT/$CLAUDE_ENV_FILE(仅 SessionStart,可持久化环境变量)/$CLAUDE_CODE_REMOTE`;输出 exit 0(成功)/2(阻断,stderr 回喂)/其他(非阻断),JSON `continue/suppressOutput/systemMessage` + PreToolUse `hookSpecificOutput{permissionDecision:allow|deny|ask,updatedInput}` + Stop `decision:approve|block`;镜像明示 hooks 与用户 hooks **并行执行**;
- **镜像收录 9 事件 [A]**:PreToolUse/PostToolUse/Stop/SubagentStop/UserPromptSubmit/SessionStart/SessionEnd/PreCompact/Notification;官方在线参考页**另有 async hooks、HTTP hooks(事件 JSON 直接作为 POST body)、prompt hooks、MCP tool hooks** [W·官方页摘要];社区指南称生命周期事件已远超此数([W·二手,数字不采信]——**精确事件清单是 E11 立项第一步的实测项**);
- **Stop 阻断语义 [W]**:社区指南与镜像一致——Stop hook exit 2 会把 stderr 注回回合强制继续(官方 goal hook 即此机制,xray 会话活体样本);
- **成本字段**:转录文件里**有** USD(D2)[L];hook 输入是否带 usage/cost 本轮未能从可及来源定论([R] ROADMAP 称 SessionEnd 不含;其引用 issue #50863/#50926 本会话未命中,hooks 路子代理查得**编号系借用、真实为 #42965/#37814/#45757** [S,见 §3.5])——**结论不变:USD 权威源在文件,hook 的价值是即时与事件语义**;
- **对本机的可靠性 [L]**:xray guard 自启动就是 SessionStart hook 拉起的——hook 通道在(网关)宿主可用已被生产验证。

### 3.2 Statusline
- **字段 [W·多源摘要一致]**:settings.json 配 `statusLine` command,每次更新 stdin 喂新 JSON、stdout 即状态行;实测样例 payload 含 `cost.total_cost_usd`(**官方自述「estimated cost…may differ from billing」**——与 D2 cost-state 同为客户端估算口径)、`cost.total_duration_ms`、`exceeds_200k_tokens`(bool,token 总量含缓存跨 200K 标记)、`context_window{used_tokens,max_tokens}`(第三方 sample:used_tokens 124528/max 200000)、`rate_limits{five_hour,seven_day}`(v2.1+ 起发送)、`model`、`workspace`;诉求出处 issue **#11535** [W];
- ⚠️ **键名分歧**:[R]/[K] 常见口径写作 `used_percentage`/`remaining_percentage`,本轮唯一可见 sample 是 `used_tokens/max_tokens`——**E13 立项第一步:本机实测 dump 一份真实 payload,按实测定义 schema**;触发频率(debounce 值)未核实,同样实测;
- **独特价值**:上下文占用与配额窗口是**转录文件里不存在**的数据(D2/D1 给不了)[L+推论]——statusline 是这两块的官方通道;`statusLine` 全局仅一条,桥接必须**链式保留**用户既有命令。

### 3.3 插件系统组件与配置
- **manifest [A·镜像示例]**:`.claude-plugin/plugin.json` 的 name/description/version(+author/keywords 等元数据);镜像示例展示 `commands/agents/hooks/mcpServers` **显式路径声明**支持(指向自定义目录/文件;hooks 亦可内联,与 hooks/hooks.json 二选一防重复加载)——镜像可能落后线上,以 `claude plugin validate .` 本机过检为部署门禁 [A+L];
- **组件自动发现 [A]**:commands/agents/skills/hooks 在插件根目录按约定发现;命令 frontmatter `allowed-tools` 支持 Bash 细粒度与 **MCP 工具预授权**(格式 `mcp__plugin_<plugin>_<server>__<tool>`)[A];命令正文可 `!` 预执行、`$ARGUMENTS` [A/R];
- **MCP 捆绑 [A]**:根 `.mcp.json` 或 manifest 声明;stdio 示例即 `"command": "python", "args": ["-m", …]`;路径支持 `${CLAUDE_PLUGIN_ROOT}`(与铁律 4 的花括号要求兼容)→ **xray-mcp 零依赖 stdio 完全合规**;
- **持久数据 [W·多源一致]**:`${CLAUDE_PLUGIN_DATA}`(v2.1.78+)= `~/.claude/plugins/data/<id>/`,**跨插件更新存活;安装目录会被整体替换**——印证铁律 2「状态写在 cc-viewer/」与官方立场一致,无需迁移;
- **用户配置 [A]**:官方插件技能文档给出 `.claude/<plugin-name>.local.md`(YAML frontmatter)做**按项目**的插件设置模式(命令/钩子自行读取)——xray 通知过滤若要做项目层覆盖,这是零依赖正路;
- **marketplace 机制 [L]**:`claude plugin validate/update/install` 与本地市场 source="./" 即 xray 日常;enabledPlugins 写在用户 settings.json(本机实测有此键)。

### 3.4 monitors.json —— 地位存疑(诚实降级)
- 本机官方镜像技能文档**无 monitors 组件** [A-缺席];本轮检索亦**未命中**任何官方 monitor 文档/CHANGELOG 记录 [W-缺席];ROADMAP 称「官方 background monitor,需 CC≥2.1.105」[R] **无出处可考**;
- xray 自身 README 早就写了「实测第三方网关宿主会静默跳过 monitors」[L/R] → 稳妥结论:**把 monitors/ 当作「无害的前瞻声明」,自启动真相是 SessionStart hook 单腿承重**(现状即如此,不改架构);E11/E12 设计不得依赖 monitor 唤醒。

### 3.5 子代理报告线索清单([S],按立项实测价值排序,不作设计依据)

> 以下细节仅见于 4 路子代理的搜索摘要报告、本会话未能独立复现。**每条都是对应方案立项第一步的实测项**——多数与已知事实方向一致,可信度不低,但证据不够硬。

- **Hooks(hooks 路)**:在线参考页事件全集达 **13 个**(较镜像新增 PermissionRequest / PostToolUseFailure / PostCompact / Elicitation / SubagentStart / SessionEnd 扩展 matcher)+ 多代理场景 TeammateIdle / TaskCompleted → E11 实测项①;**各 hook stdin 带 `usage`(token 数,非 USD)与未文档化顶层 `cost`** → E11 实测项②(若属实,poke 可顺带官方 token 口径);`Notification.message` 前缀分型(permission_required / idle_timeout / auth_success…8 种)→ 等待态「去疑似」的前提,E11 实测项③;SessionEnd `reason` 枚举 8 值;Stop/SubagentStop 决策仅 block 语义;http hook 型 v2.1.63+、prompt 型 v2.1.203+、`async:true` 后台不阻塞;ROADMAP 所引 **#50863/#50926 系编号借用(真实存在但与 cost 无关),真实诉求 issue 为 #42965(Open)/#37814/#45757**。
- **Statusline/成本(成本路)**:字段细案与 [W] sample 键名冲突——该路给 `context_window{used_percentage,remaining_percentage,current_usage,total_input_tokens}`、`rate_limits.*.{used_percentage,resets_at,overage_status}`、`is_auto_compact_enabled`、300ms debounce(**E13 实测项:本机 dump 一份真实 payload 定 schema**);官方 /usage 面板口径(订阅=claude.ai 网页、团队/企业=admin 面板、API=Console,**无公开成本 API、按 key 无法计费**)与其 issue #32963 摘句;定价补充(Sonnet 4.5 $3/$15、Opus 4.5 $5/$25——与官方镜像相邻代一致);ccusage 实现细节(cacheWrite 5m 1.25×/1h 2×、新 tokenizer ×1.35)。
- **插件系统(插件路)**:**manifest schema 已收窄至 name/description/version/userConfig + 元数据,`commands/agents/hooks/mcpServers` 显式声明被移除(全组件自动发现,MCP=根 `.mcp.json`)**——四源交叉但与我读的镜像示例([A],含显式声明键)冲突,**E12 第一步:本机写一份声明跑 `claude plugin validate` 看谁过时**;`userConfig`(v2.0.76+,`${user_config.X}` 注入 hooks/MCP 命令,可解 E11 的 poke 端口配置化!);`${CLAUDE_PLUGIN_DATA}` 卸载后保留 7 天;`claude plugin eval`(插件 E2E 评测框架,sandbox 默认断网——**对 xray 的 CI 直接可用,立项前先试**);monitors.json 在 claude-code 仓库 **0 命中、schema 属 opencode**(§3.4 采信其方向,但「反转定论」仍需官方原文);插件 `additionalDirectories/statusline-providers/`(E13 若属实可**免改用户 settings.json** 的正路);命令 `context: fork`/`$ARGUMENTS_N`/`@文件` 引用;MCP 工具命名两处口径(`mcp__<plugin>__<tool>` vs 镜像的 `mcp__plugin_<plugin>_<server>__<tool>`)。
- **社区(生态路)**:该路逐条核实了 14 个竞品(ccusage/ccseva/claude-code-log/agents-gateguard/opentui/agent-view/claude-code-webui-desktop/Claude-Code-Usage-Monitor/omnara/vibe-kanban/claude-squad/tokscope=不存在 等)——**其中仅 claude-hud、claude-code-hub 被本会话搜索独立复现**(已入 §4.1;ccusage 的存在另有 [R]+[K] 高置信支撑),其余仅见于该路报告,标 [S] 作界面语汇与参数设计参考、不作存在性/星数依据;Web Notification **桌面 Safari 不支持、Android Chrome 不支持**(E9 降级文案前提 [S]);cc-dots #1111「ask 规则误触发 ghost waiting」修复——**与 xray「等待授权(疑似)」同根因的社区实证 [S]**;ccusage-notifications「日预算阈值通知」/ agents-gateguard「权限等待→通知+点击回终端」(E1/E11 增量灵感 [S]);**claude-golden-eye 该路判「✅ 存在(view-only dashboard)」,与本会话检索「未达仓库本体」相反 → 维持 §4.1 弱证据判法**。

## 4. 社区对标(本会话 WebSearch 结果为准;星数/描述均为搜索摘要二手口径)

### 4.1 ROADMAP §2.2 三项目核实

| ROADMAP 引用 | 核实结论 [W] | 对 xray 的意义 |
|---|---|---|
| [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) | ✅ 存在,头部 statusline 插件(Medium 转述 ~16.6K★):context usage/active tools/agents/todo 常驻输入行下方;安装=自家 marketplace + setup 命令写 settings.json `statusLine` | ①E13 路线有成熟先例(含「setup 写配置」UX);②已知 bug:会话恢复后 HUD 消失、macOS 装后需重启——E13 验收项该防这两类 |
| amenophis1er/claude-golden-eye | ⚠️ **未核实到仓库本体**(仅聚合站二手「view-only dashboard, live session state…」;作者主页真实但项目列表无此名) | ROADMAP 从它借鉴的三点**降级为方向性参考**,均有替代出处:桌面通知→eyes-on-claude-code(下表);MCP 查询→E12 本就官方机制 |
| [NikiforovAll/claude-code-hub](https://github.com/NikiforovAll/claude-code-hub) | ✅ 存在且活跃(npm v0.18.2 日更节奏):四合一 chromeless PWA(Marketplace/**Kanban**/**Cost**/Memory);子项目 [claude-code-cost](https://github.com/NikiforovAll/claude-code-cost) | 成本面板与「等待输入标记」经 PWA 形态验证为真需求(E1/E14 市场信号) |

### 4.2 本次新发现(搜索直接命中 [W])

- **[anthropics/claude-code-monitoring-guide](https://github.com/anthropics/claude-code-monitoring-guide)** — 官方「Claude Code ROI 度量指南」含现成 Grafana dashboard JSON:官方认证的指标维度可作 E1/E2 **口径设计参照**(xray 做单机版对齐官方语义,天然可信);
- **[anthropics/claude-code#26394](https://github.com/anthropics/claude-code/issues/26394)** — 「Central dashboard to monitor multiple Claude Code」官方需求 issue:**多会话集中查看是官方未满足的公开诉求** = xray 正面市场信号;
- **[joe-re/eyes-on-claude-code](https://github.com/joe-re/eyes-on-claude-code)** — 全局 hooks 驱动的菜单栏多会话看板+桌面通知:佐证 **E11(hook push)+E9(桌面通知)** 组合方向;
- **[hoangsonww/Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor)**、**[tombelieber/claude-view](https://github.com/tombelieber/claude-view)**、**[dlupiak/claude-session-dashboard](https://github.com/dlupiak/claude-session-dashboard)**、**[fien-atone/third-eye](https://github.com/fien-atone/third-eye)**(「钱花哪了」)、**[onikan27/claude-code-monitor](https://github.com/onikan27/claude-code-monitor)**(手机向,§6 拒收)——「多会话并行焦虑」赛道切片密集,xray 的零安装+历史全量位仍空。

### 4.3 承 ROADMAP 未再核实项([R])

ccusage(成本报表维度:daily/monthly/by-project)、agent-notify / agents-router / ai-cli-complete-notify(渠道矩阵与 10s/5 条防风暴)——**方向保留、细节以 ROADMAP 为出处**;E14 实现前逐渠道 payload 再查官方 bot 文档。langfuse/phoenix 类观测产品的界面语汇(瀑布条/hover 定位/回放)作 E2/E3 交互参照 [R/K]。

### 4.4 差异化定位结论

同类三形态:**终端 HUD**(无历史)/ **重装机 app·PWA**(有依赖)/ **xray**(零安装+历史全量回看+回合任务叙事+全文可看全)。扩展应在自己三件武器上做加法(只读数据源深度 D2/D3/D11、全文链路、回合分组),而非补齐别人的形态。E1–E15 全部符合该判据。

## 5. 扩展方案卡

> 格式:**价值 / 数据源 / 改动点(带真实锚)/ 铁律校验 / 风险 / 验收**。工作量=人日(含 TDD 与真机冒烟)。

### E1 成本面板(Cost)⭐ 首推 · 1–2 人日
- **价值**:从「看板」到「记账」;项目/模型/日三轴成本;缓存命中率(cacheRead/(input+cacheWrite+cacheRead))是 prompt 复用工健康指标。
- **数据源**:D2 `cost-state`(官方 USD+逐模型分解+webSearchRequests+增删行,转录尾窗 256KB 内即可读到 [L])+ D1 usage×定价兜底(进行中会话/无 cost-state 旧数据)。
- **改动点**:`sessions._analyze` 增 cost-state 分支(同遍扫描零新增 I/O);`/api/sessions` 与 run 透传 `cost + costSource('official'|'est'|'unknown')`;`config.py` 内置定价表常量;仪表 COST 瓦片(今日/近 7 日;**受筛选口径约束,同 RUNS 的 `命中/总数` 教训**);run/会话卡 `≈$x` 徽标。
- **铁律校验**:零依赖 ✓;只读 ✓;铁律 7——「官方/估算/未知」三态+悬停写明定价快照日期,绝不冒充精确值。
- **风险**:第三方网关按官方牌价折算出「虚假精确」USD(D17 实证 qwen $16.4)[L] → `costSource` + 「客户端估算,非账单」措辞(statusline 官方也是这句 [W]);cost-state 写入时机未文档化(实测仅收尾有 [L])→ UI 措辞「官方值(会话收尾后)」。
- **验收**:`tests/test_cost.py` 三分支 fixture;黄金快照重录注明;真机与 `claude` 自带 `/cost` 对账(注:/cost 命令名 [K],实测确认)。

### E2 时间线/甘特视图 ⭐ 2–3 人日
- **价值**:「哪个 agent 慢、卡在哪个 phase」一眼定位。
- **数据源**:D3 三时间戳 [L];进行中 run 由 D4 记录级 timestamp 流重建(journal 无时间戳 [L])。
- **改动点**:`scan.parse_completed/parse_live` 补透传;前端 agent 表上方横向时间条(纯 CSS 定位,不引库),phase 泳道;点击条→复用 `data-src` 抽屉(FULL 缓存/open·滚动快照天然兼容)。
- **铁律校验**:completed 卡条几何由冻结数据决定(不违「卡内禁逐秒字段」);进行中卡本就每轮重绘 ✓;新滚动容器入 scrollTop 快照选择器(若限高)。
- **风险**:旧 run JSON 缺时间戳字段 → 条缺失显式「无时间数据」,不画错。
- **验收**:`tests/frontend/test_timeline.js` 无头桩(条数=agent 数/宽度∝duration/缺数据占位)+ 后端透传断言。

### E11 hooks 事件驱动:即时刷新(架构升级点)⭐ 1–2 人日
- **价值**:2s 轮询→亚秒;通知从「文件落盘后扫到」→「事件即达」;钩子事件流还是等待态启发式的**交叉验证源**(具体能验证到什么程度,取决于实测到的事件 payload——先收集样本再设计,不预设)。
- **数据源**:§3.1 官方通道。`hooks/hooks.json` 增 `PostToolUse`(matcher 含 Workflow)、`Notification`、`Stop`、`SessionEnd`,command 型 POST `http://127.0.0.1:<port>/api/poke`(单文件 python stdlib urllib,timeout 0.3s,失败静默 exit 0);官方 **http-hook 型**(事件 JSON 直发 URL [W])可零脚本——先用最小 command-hook 跑通,http 型当升级项。
- **改动点**:`web.py` 新 `POST /api/poke`(校验 body 含 `hook_event_name/session_id`;幂等:置位唤醒,不携带可展示内容);`notify_loop` 的 `sleep(5)` 改 `threading.Event.wait(5)`;事件记入 `CONF_DIR/events.jsonl`(小环形文件,E6 时间线可叠加);**新增 hook 会触发宿主的审阅批准**(信任模型 [K]),安装文案预告。
- **铁律校验**:铁律 4 花括号变量(现有 hooks.json 已守);服务不可达秒失败;监听面不变;poke 无数据出口(最坏=多扫几次)。
- **风险**:网关宿主对多事件类型的覆盖度未知(本机转录只见用户配过的事件 [L])→ **功能纯增益、退化安全**:无事件=现状启发式一切照旧。
- **验收**:test_web_api poke 契约(200/400/405+触发重扫时间戳);真机 workflow 实测 poke 时延;立项首步=真机采集一次 Notification/PostToolUse 事件 payload 样本入库为 fixture。

### E9 页面侧桌面通知 + 声音 · 1 人日
- **价值**:webhook 依赖外部可达+配置;桌面通知零配置补「挂着页面但没看」场景。
- **数据源**:既有 `/api/sessions` input_required + run 终态(纯前端)。
- **改动点**:30-app 增 `notifyBrowser(kind,key)`;`Notification.requestPermission()` 挂设置页显式按钮(不自动弹);去重键与 sent.json 同构;声音 WebAudio 合成单音;**能力检测+优雅降级**(浏览器支持度差异 [K] 真机复验,文案不许承诺「必有通知」)。
- **铁律校验**:开关进 localStorage `wfo-bnotify`(同 wfo-lang,不进服务端 config);tick 分离不破。
- **验收**:无头桩断言同事件不重发/状态切换重发/拒绝时安静。

### E3 文件改动回看(diff)⭐ 2–3 人日
- **价值**:「这次任务改了哪些文件、改成什么样」——回看型王牌。
- **数据源**:D11(映射结构已 spike [L])。
- **改动点**:`/api/files?proj=&sess=` 列改动文件+版本数;`/api/filediff?...&from=&to=` 用 **stdlib difflib.unified_diff**;会话卡「✎ 改 N 文件」行→文件列表→统一 diff(定高滚动)。
- **铁律校验**:新增只读路径 `~/.claude/file-history`(仍禁写 ✓);大文件 DETAIL_CAP+显式「截断」;版本被官方回收(本机存在 `.last-cleanup` [L])→「⚠ 版本已被清理」不静默。
- **风险**:二进制只列名。
- **验收**:`tests/test_file_history.py` fixture(合成 snapshot 记录+@v1/@v2)。

### E12 捆绑 MCP:xray 反向查询(差异化主打)⭐ 2–3 人日
- **价值**:查看器变「记忆体」——用户直接问 Claude「上周失败那个 workflow 复盘讲了什么」,Claude 自查本地历史。
- **数据源**:§3.3 官方机制 [A]。stdio:`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/mcp_server.py`(纯 stdlib 手写 JSON-RPC:initialize/tools·list/tools·call);工具 `list_runs/search_runs/run_detail/cost_summary`(复用 scan/sessions 同源函数);`.mcp.json` 或 manifest 声明 [A];命令 frontmatter 按 `mcp__plugin_xray_*` 预授权 [A]。
- **铁律校验**:零依赖 ✓(官方示例就是 python -m);只读 ✓;不新增端口——**服务没起也能查历史**(进程内自建 6s 缓存,等价 scan_cached),反成卖点。
- **风险**:工具命名/加载行为两处文档口径差 [A 镜像 vs 线上]→ 以本机 `/mcp` 实测为准;宿主版本差异→validate 门禁。
- **验收**:pytest 起子进程 `initialize`+`tools/list` 握手;真机 `/mcp` 可见+一次真实查询。

### E4 错误与工具失败聚合 · 1–2 人日
- **价值**:「本周哪个项目/工具翻车最多」;子代理反复撞同一 API 错误现在只能逐个点开。
- **数据源**:D18 [L] + D7 hookErrors/D8 [L]。
- **改动点**:`_analyze` 累计 `errors{n,kinds[]}`;仪表 ALERT 旁加 ERR 瓦片;**ALERT_ST 单点不动,ERR 独立计数(注明两口径)**;设置「诊断」页:项目×错误类型 TOP-N→点击定位会话卡。
- **铁律校验**:错误类宁可不截(2000 字政策沿用 webhook)。
- **验收**:fixture 断言计数/分类/两瓦片互不污染。

### E5 插话/队列与模式时间线 · 1 人日
- **价值**:回合分组(1.2.20)边界的解释器——「我中途说了话为什么步骤挂到上一组」可视化回答。
- **数据源**:D6/D9 [L]。
- **改动点**:`_analyze` 提插话事件流;回合组头挂「⚡插话×N(absorbed)」小标(悬停摘要/点击全文,抽屉键 `<sid>:queue:<uuid>` 风格);卡眉标模式变更链。
- **铁律校验**:分组仍只认 `step.turn`,插话只做注记——**前端不猜边界契约不破**。
- **验收**:test_turn_group.js 扩展(插话注记不改分组数)。

### E6 钩子健康 + /goal 状态面板 · 1–2 人日
- **价值**:实测当场抓到真故障——`hook_success` 里躺着 `Hookify import error`(用户钩子静默失败没人看见)[L];xray 自身是钩子驱动,吃自家狗粮。/goal 条件与达成态只有转录知道(D7 goal_status [L])。
- **数据源**:D7/D8 [L] + E11 events.jsonl(若落地)。
- **改动点**:`_analyze` 收集近 N 条钩子执行(命令/耗时/exitCode/stderr 首行)+ goal_status;会话卡「⚙钩子 N 失败」徽标→明细表(耗时条复用 E2 组件);/goal 条件上卡(长文懒拉)。
- **验收**:fixture 合成失败钩子断言计数与明细。

### E13 statusline 桥:上下文占用与配额面板 · 1–2 人日
- **价值**:补 xray 唯一两块**文件里没有**的数据:上下文占用(「快 compact 了」预警)与 5h/7d 配额窗口 [L(转录字段穷举)+W(仅 statusline 有)]。
- **立项第一步**:本机 dump 真实 payload 定 schema(§3.2 键名分歧);**used/rate 字段对第三方渠道可能缺失或失真**——缺时区块安静缺席并说明原因(铁律 7)。
- **数据源/改动点**:新命令 `/wf-statusline` **起步只做「生成配置片段+让用户自贴」**(xray 首次写非 CONF_DIR 文件是铁律 2 例外,起步绕开;若未来改为直写 settings.json:须显式命令触发+备份+幂等+remove,且**链式转调**用户旧 statusLine);桥脚本 POST `/api/telemetry`(仅本机);页面 HUD 区:占用条(绿→黄→红)+ 配额% +「来自最近一次上报:会话 x · Ns 前」(新鲜度窗口)。
- **风险**:空闲会话不上报=数据过期展示(措辞解决);statusLine 触发时机/debounce 未核实 [K]。
- **验收**:配置片段生成/还原的 tmp-HOME 测试;telemetry 端点校验+过期灰显断言。

### E14 多渠道通知矩阵 + 过滤 + 风暴抑制 · 2–3 人日
- **价值**:飞书之外的钉钉/企微/ntfy/Telegram/Slack/Pushover(渠道矩阵承 [R]);过滤+抑制解决「多会话刷屏」。
- **改动点**:config 升级 `channels:[{type,url,secret,insecure,tiers,filters{projects,status,minDurationSec}}]`(旧单 url 自动迁移 channels[0]);notify.py 每渠道一个纯渲染函数;防风暴=同 kind 10s≤5 条内存滑窗;`/api/config/test` per-channel;设置页 01 改通道列表。**增量:日成本阈值告警**(依赖 E1 落地后,阈值可配、走既有 webhook)。
- **铁律校验**:出站本就是既有能力;各渠道回执 recent 可展 ✓;密钥 CONF_DIR 内、页面打码。
- **验收**:test_notify_channels(每渠道 payload/迁移/滑窗/部分失败降级)。

### E15 代理团队花名册与消息流 · 1–2 人日
- **价值**:agent-teams 新方向,本机实测已有数据 [L];多代理互发消息现在完全不可见。
- **数据源**:D13 + D18(Agent 回执 team 字段)交叉。
- **改动点**:`/api/sessions` 挂 `team{members[],inboxCounts{}}`;「👥 N agents」徽标→花名册;只计数+末条摘要(mtime 变才重读,inbox 只读尾 64KB 防御)。
- **铁律校验**:只读 ✓;**绝不写 inbox/socket(§6 拒收线)**。
- **验收**:fixture 合成 config+inboxes 断言花名册/计数。

## 5b. 批次路线建议

- **第 1 批**:E11(即时性地基+事件样本采集)→ E1(成本,吃 D2 红利)→ E9(小件)。逻辑:E11 让一切新指标新鲜度不再是借口;E1 价值最大。
- **第 2 批**:E2 甘特 → E12 MCP(把 E1/E2 数据变成可查询接口)→ E3 diff → E4/E5/E6(同属「转录元数据上卡」,一个 PR 系列)。
- **第 3 批**:E13(先 payload spike)→ E14 → E7/E8/E10/E15 按反馈取舍。
- **依赖边**:E12 的 cost_summary 依赖 E1;E13/E6 展示条依赖 E2 组件;E14 预算告警依赖 E1;其余互相独立(垂直切片)。

## 5c. 定价兜底表(E1 估算路径用)

> 来源:**Anthropic 官方 `claude-api` 技能文档本机镜像**(cached 2026-06-24)[A]——权威等级高于网页转述;与 ROADMAP §2.3 一致,补 Fable/Mythos。线上以 anthropic.com/pricing 为准。

| 模型 | ID | 输入 $/M | 输出 $/M |
|---|---|---|---|
| Claude Fable 5 / Mythos 5 | `claude-fable-5`/`claude-mythos-5` | 10.00 | 50.00 |
| Claude Opus 5 / 4.8 / 4.7 / 4.6 | `claude-opus-5` 等 | 5.00 | 25.00 |
| Claude Sonnet 5($2/$10 intro 至 2026-08-31)| `claude-sonnet-5` | 3.00 | 15.00 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 1.00 | 5.00 |
| Opus 5 fast mode | `speed:"fast"` | 10.00 | 50.00 |

缓存价:读 0.1×、写 1.25×(5m)/2×(1h)[R/K——实现时以镜像 prompt-caching 节复核];转录 usage **分不出 5m/1h 写价**,统一 1.25× 并注明低估上限;新 tokenizer 多产 ~30% token,跨 tokenizer 历史比较要标注 [R/K]。网关/未知模型 → `costSource='unknown'` 显示 `—`(本机 qwen 实测被折算出 $16.4,不可信 [L])。

## 6. 明确不做(沿用 ROADMAP §4,增补)

- 远程监听/多机同步/云端托管(铁律 3);写 `~/.claude/projects`(铁律 2);
- 依赖 telemetry 私有格式(D17:未文档化字段随时变 [L]);
- Agent SDK 实时订阅(观测不到用户正常会话 [R]);
- **「从网页向会话发消息」双向通道**(D12 `messagingSocketPath`+peerFeatures 证明技术上可达 [L]):协议未公开、等价于以用户身份注入指令、与只读定位根本冲突——**只读可观测(teams/inboxes),绝不写**;
- 「重跑/一键继续 workflow」(写操作+脚本注入面);历史转录删除/清理管理 UI(诱导破坏用户数据)。

## 7. 对 ROADMAP.md 的实测勘误

| ROADMAP 论断 | 核实结论 | 证据 |
|---|---|---|
| §3.1 成本=「usage 四字段+定价表估算」 | **降级为兜底**:转录尾 `cost-state` 官方 `totalCostUSD`+逐模型分解直接可读;估算只补进行中/旧数据 | D2 [L] |
| §3.6 「workflowProgress **可能含**时间戳,缺则用 agent 转录推断」 | **确认含**(queuedAt/startedAt/lastProgressAt);journal.jsonl 实测**无时间戳**(只 started/result)→ 进行中时间线走记录 timestamp | D3/D4 [L] |
| §1 「run 级 durationMs 已有」 | 补充:`scan.py parse_completed` 只抄 6 字段,时间戳/model/attempt 白丢——扩展比 ROADMAP 预估更便宜 | scan.py:114-121 [L] |
| §2.1 「hooks 28 种事件」 | 未获任何可及来源支持:官方镜像列 9 种 [A],线上参考页另有 async/HTTP/prompt/MCP hook 型 [W],社区「更多」说法不采信数字。**精确清单列为 E11 立项实测项** | §3.1 |
| §2.1 「SessionEnd 不含 usage/cost…issue #50863/#50926」 | 本会话检索未直接复核编号 → UNVERIFIED;hooks 路子代理查得 **#50863/#50926 系编号借用**,真实 cost 诉求为 #42965/#37814/#45757 [S,立项前自行点开验证]。(不影响结论:**USD 权威源在转录文件 D2,hook 输入只是搬运** [L]) | §3.1/§3.5 |
| §2.1 「插件捆绑 MCP:plugin.json `mcpServers`」 | 镜像示例支持 manifest 显式声明 **mcpServers/commands/agents/hooks 路径** [A];根 `.mcp.json` 同样可行 [A]。(线上参考是否收窄该 schema,本轮未读到原文——实现时以 `claude plugin validate` 实测为准)| §3.3 |
| §2.1 「statusline 有 used_percentage」 | [W] sample 实为 `context_window{used_tokens,max_tokens}`;`used_percentage` 口径未获本轮来源证实 → E13 立项第一步实测 dump payload | §3.2 |
| §2.1 「monitors=CC 官方(需≥2.1.105)」 | 本轮**未命中任何官方出处** [W-缺席];xray 自身已实测部分宿主静默跳过 → 降级为「无害前瞻声明」,SessionStart hook 为唯一承重入口 | §3.4 |
| §2.2 社区三项目 | claude-hud ✅(~16.6K★二手)/ code-hub ✅(日更 PWA)/ **golden-eye ⚠️ 未核实到本体** → 借鉴点换独立出处 | §4.1 |
| §2.3 定价表 | **与官方 claude-api 镜像一致** ✓(补 Fable/Mythos $10/$50、fast mode);新增警告:网关下 cost 按牌价折算出虚假 USD [L] | §5c/D17 |
| §3.5 多渠道通知 | 方向不变;`sent.json` 键结构与渠道无关(数组化即可)[L];防风暴参数 [R] | §5b/E14 |

## 8. 参考

**官方文档**([W]:本环境 WebFetch 被企业网关拦截,以下均为 WebSearch 命中摘要;实现前留「读原文复核」工序。域名注意:官方文档站为 code.claude.com [W],docs.anthropic.com 为旧域名跳转 [K])
- Hooks:https://code.claude.com/docs/en/hooks(参考:async/HTTP/prompt/MCP-tool hook 在列)· https://code.claude.com/docs/en/hooks-guide · Agent SDK:https://code.claude.com/docs/en/agent-sdk/hooks
- Statusline:https://code.claude.com/docs/en/statusline(cost/context_window/rate_limits/exceeds_200k_tokens)· 字段诉求 issue:https://github.com/anthropics/claude-code/issues/11535
- Plugins:https://code.claude.com/docs/en/plugins-reference(`${CLAUDE_PLUGIN_DATA}` v2.1.78+ 持久目录)· Changelog:https://code.claude.com/docs/en/changelog
- 官方插件技能文档([A] 本机镜像,版本落后线上):`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/{hook-development,plugin-structure,mcp-integration,plugin-settings,command-development}/SKILL.md`
- 官方定价镜像([A] 本机):`anthropic-agent-skills/skills/claude-api/SKILL.md`(cached 2026-06-24;线上 anthropic.com/pricing 为准)
- 官方度量口径:https://github.com/anthropics/claude-code-monitoring-guide · 需求 issue:https://github.com/anthropics/claude-code/issues/26394
- 二手 statusline/社区技术文章:gist.github.com/AKCodez/ffb420ba6a7662b5c3dda2edce7783de · nick-liu.com/posts/statusline-side-channel · pub.towardsai.net(claude-hud 专文)· claudefa.st/hooks-guide(事件数说法不采信)

**社区对标**:§4 逐条给链;**[R] 承 ROADMAP 未复验**:ccusage / agent-notify / agents-router / ai-cli-complete-notify。

**本仓库内部锚**:`scripts/ccviewer/{scan,sessions,notify,web,config,jsonl}.py`、`frontend/src/{00-types,20-render,30-app}.ts`、`hooks/hooks.json`、`monitors/monitors.json`;`CLAUDE.md` 铁律 1–7;`ROADMAP.md`(本文 §7 为其勘误)。

---
*方法说明:①本机 `~/.claude` 全量探查(2026-09-05,24 项目/286 转录/163MB,§2 逐字段实测 [L]);②官方镜像文档直读 [A];③本会话 WebSearch×4 交叉 [W](WebFetch 不可用,全文未读);④4 路联网调研子代理报告已收(其后三路另报 API 400)——细节凡未被①②③独立复现者一律标 [S],集中列 §3.5 作各方案「立项第一步」实测清单;初稿曾把子代理细节误标为已核实,v1.1 已全面降级。*
