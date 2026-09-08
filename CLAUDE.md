# CLAUDE.md

本文件指导 Claude Code 在本仓库中的工作。修改本仓库代码前先读完本文件。

## 项目是什么

Claude Code 插件 **lucid**：网页版 Workflow 执行进度实时查看器。
零依赖（仅 Python3 stdlib）、无构建步骤、服务只绑定 127.0.0.1。
本目录同时就是本地市场 `kw-dev-plugins`（`.claude-plugin/marketplace.json` 中 source 为 `"./"`）。

- 用户文档：`README.md`（英文版，GitHub 默认展示）/ `README.zh-CN.md`（中文版），两份互链；内容（原理、安装、页面功能、API、安全）改动时须同步对方
- webhook 详解：`scripts/README.md`
- 扩展调研：`docs/feature-extension-research.md`（2026-09 定稿：数据源实证地图 D1–D19 + 官方通道核实 + E1–E15 方案卡；`ROADMAP.md` 为其初版，§7 为勘误表）
- 扩展调研·第二轮：`docs/runtime-state-deep-research.md`（2026-09-06：新增数据面 **D20–D51**（转录内 19 类：`toolUseResult.structuredPatch` 现成 diff hunk、`task_reminder` 待办图、**`<persisted-output>`+`projects/<proj>/<sess>/tool-results/` 大输出全文溢出指针（D50→E26，可消灭「超出转录留存范围」这条 miss）**、`last-prompt`、`hook_non_blocking_error`、`goal_status`、`usage.cache_creation.{5m,1h}`、`cost-state.hasUnknownModelCost`…；盘外 11 类 + 1 页官方目录定性：`~/.claude.json` 官方逐项目聚合 `projects[path].last*`、**官方目录定性页 D51**、teams member 字段、/tmp 任务输出寿命、telemetry 的 D49 禁用边界…）+ **E16–E26** 方案卡 + 对 R1 的实测勘误（§3）与官方通道定案（§4：hook 事件全集 **33 个**、**http 型 hook 早在 2.1.63**（E11 不必自写 POST 脚本）、`Stop` stdin 自带 `background_tasks[]`/`session_crons[]`、statusline 官方 schema 含分母 `context_window_size` 与 `prompt_cache.hit_ratio`、**OTLP `http/json` → 零依赖可收官方遥测但 blocked_on_user 等在 spans 须开 traces**、`monitors` 确为 2.1.105 官方组件）。**取证入口（重要）**：`curl https://code.claude.com/docs/en/<页名>.md` 可直读官方文档原文——**WebFetch 被网关拦 ≠ 网络不通，别再拿它当"读不到官方文档"**；本轮经此新读到 `…/claude-directory.md`（99KB：**`~/.claude` 每个路径的官方定性 + `cleanupPeriodDays` 保留期规则**——判断某数据源稳不稳、会不会被修剪，先查它）；再加本机两份 CHANGELOG（`~/.claude/cache/changelog.md` 到 2.1.252、`~/.claude/plugins/marketplaces/claude-code-plugins/CHANGELOG.md` 到 2.1.259）与 `strings` 已装 `claude.exe`（**三条使用戒律：字面量存在≠运行期一定发送、≠层级正确；"数函数名"不等于"数事件数"；得出 0 之前必须先问已知字段能否被同一探针看见**）。新字段上界面前七问检查单在其 §9，仍欠实测见 §9.5）
- 问题复盘：`docs/lessons-learned.md`（2026-09-06 定稿，覆盖 1.2.0→1.2.38 全史：六类问题的事件↔根因↔规则↔防线对照；**诊断新 bug 先对照其 §7 检查单**；同类型问题第二次出现=防线有洞，回来补该文档与对应测试）
- xyflow 集成调研：`docs/xyflow-integration-research.md`（2026-09-08：「针对选中项目可视化编排 Workflow」可行性实证——**@xyflow/system 0.0.82 有 UMD 构建(100KB,d3 内联,全局 XYFlowSystem),与本仓零 bundler 模式同构**；框架无关积木 XYPanZoom/XYDrag/XYHandle + 手写 DOM/状态垫片即可交互,无需 React；**隐藏 DOM 契约十条 C1–C10 源码实证**(connectable/connectableend、data-id=`${flowId}-${nodeId}-${handleId}-${type}`、包装层回调不许 throw、onDraggingChange 等无空值防护——全部 PoC 踩过)；产物=Workflow 脚本写 `~/.claude/cc-viewer/drafts/`(铁律 2 合规)终端 scriptPath 执行；方案卡 X1–X5,X1+X2 建议第 1 批；**PoC 在 `docs/poc/xyflow/`,headless 合成事件五断言可复跑**(`?smoke=1` → title 报 SMOKE OK),取证命令在 §8)
- Workflow 全功能对齐调研：`docs/workflow-alignment-research.md`（2026-09-08，证据基座 **Claude Code 2.1.263**：CC Workflow 能力分四层——L1 脚本语言面 12 个元素（`meta{name,description,whenToUse,phases[{title,detail,model?}]}`、`agent(prompt,{label,phase,schema,model,effort,isolation,agentType})`、`pipeline`(无栅栏,回调收 `(prev,orig,index)`)、`parallel`(栅栏,null 不 reject)、`phase`/`log`/`args`/**`budget{total,spent(),remaining()}` 硬上限**/**`workflow()` 子流仅一层**、沙箱禁 `Date.now/Math.random/new Date` 与 `import()`）、L2 运行面（journal 的 `v2:<sha256>` 即 resume 缓存键、实测并发上限 16、`meta.phases` 单独就能出阶段进度）、L3 调用面（工具入参 `script|name|scriptPath|args|resumeFromRunId`）、L4 分发面（`.claude/workflows` / `~/.claude/workflows` / 插件 `workflows` 清单字段 + `/plugin:name` 命名空间）；**证据源=官方页 curl + `strings` 还原内置 `workflow-authoring` 技能全文（脚本 API 唯一权威，官方页列不全）+ 本机 5 次真实运行 + 官方插件 7 份脚本**；**对齐设计=三层表达**（A 结构层可视化 / B 组合层半可视化 `map`=pipeline、`branch`=if、`loop`=while、`retry`/`log`/`subflow` / C 代码逃生舱 `code` 节点），**语义覆盖 100% 靠 A∪B∪C，可视化覆盖随 X7–X9 从 ~45%→~85%**；实施卡 X6–X12（曳光弹），含对齐矩阵 34 项、生成器映射与沙箱执行断言、区域规则、风险清单）
- 编辑器实施规格（开发文档）：**已按此实施完毕（1.2.43）**——`docs/xyflow-editor-dev-guide.md`（2026-09-08：调研的"怎么做"分册——架构图/草稿 JSON schema 与执行件 JS 双文件契约、后端三路由实现代码(`/static` 白名单、`POST /api/draft/save` 消毒与原子落盘、`GET /api/drafts`)、前端 6 文件改动清单(39-flow-shim/40-flow/45-flowgen/00-types/template/05-i18n)、生成器语义映射验收表、契约 C1–C10↔测试逐条对应、测试计划(后端 6+全链路 2+前端 5+打包 2+真机)、部署与 vendor 升级 runbook(锁版人工升,0.0.x 无 semver 承诺)、故障排查表(8 条全为本 PoC 实录)、曳光弹实施顺序 6 步;**实施时版本号 1.2.42→1.2.43**)
- 性能与架构调研：`docs/perf-architecture-research.md`（2026-09-06 实测定稿：基线 `/api/sessions` warm **170ms/轮**（54 会话中 53 已死仍全量重解析 46.9MB JSON/轮；`_main_steps` 占 68%，其中**孤儿回合 rev_lines 深扫 31/54 会话每轮重复 26.9MB**——最大单项隐藏开销）；方案卡 F1–F6——**F1 `scan_sessions` 按会话 (mtime_ns,size) 签名缓存 170ms→实测模拟 5ms（34×），铁线="缓存只装内容派生字段，ageSec/status/子代理 state 等时间态每轮现算"（误缓存=等待通知卡死，测试钉死）**；F2 单遍尾窗解析（`_analyze`/`_main_steps`/`_title` 现各读各的 2 遍 256KB）；F3 gzip（309KB→95KB@q1，ended 会话占载荷 85%）；F4 notify 线程通知全 off 仍 5s 全盘扫描→播种降频 30–60s；F5 前端 sig 未变跳过重建（stub 实测 sessCard×54=21ms/轮）。明确不做：增量偏移解析/SQLite/ETag/WebSocket（反过度工程清单附理由）。测量学教训：**长扫描必须 `process_time()`——墙钟被系统睡眠污染过一次"560s"假读数**；探针字节归因须双计数源互洽）

## 铁律（违反即 bug）

1. **零依赖**：`scripts/server.py` 与 `scripts/ccviewer/` 包只许 import stdlib。不引第三方包、不加 pip install 步骤。
2. **只读数据源**：扫描 `~/.claude/projects/` 永远只读；服务唯一可写目录是 `~/.claude/cc-viewer/`（config.json / sent.json / server.pid / cas.pem）。
3. **仅本机监听**：bind 地址硬编码 `127.0.0.1`，绝不改成 0.0.0.0；POST 保留 Origin 同源守卫。
4. **命令模板变量必须写花括号形式** `${CLAUDE_PLUGIN_ROOT}`——裸 `$CLAUDE_PLUGIN_ROOT` 不会被 Claude Code 展开，且该变量不存在于 Bash 工具环境（2026-09-04 实际踩坑：导致从项目源码而非已安装插件启动服务）。`commands/lucid.md` 中已修复，勿回退。
5. **回归测试已入库，`python3 tests/run_all.py` 是准入门槛（1.2.18 起）**：
   - `tests/test_*.py`（后端，纯 stdlib）：fixture 驱动真实函数 + `test_web_api.py` 真起 server 子进程打全链路 HTTP；
   - `tests/frontend/test_*.ts`（前端一律 TypeScript，1.2.31 起；开发期依赖 node——运行时仍零依赖）：node 原生 type-stripping 直跑 .ts（**需 node ≥22.18**，无编译步骤；版本过旧 run_all 警示并跳过）；`harness.ts` 无头 DOM 桩加载**真实编译产物**驱动 render/diff/抽屉/轮询；`test_render_golden.ts` 为 card/sessCard 出 HTML 的黄金快照——**任何前端重构前后黄金必须逐字节一致**（故意改文案/结构才 `UPDATE=1` 重录并在提交注明）；类型检查由 `typecheck.ts` 套件代跑（`tsc -p tsconfig.check.json`，需开发机 `npm install` 一次；无 node_modules 则警示跳过）；
   - `tests/browser/test_*.ts`（真实输入冒烟，1.2.47 起；需 node ≥22 的全局 WebSocket + 本机 Chrome，缺 Chrome 的套件自己跳过并警示）：用 CDP `Input.dispatchMouseEvent` 走浏览器**真实事件管线**驱动真 Chrome（puppeteer 同路径，零第三方依赖）。**存在的理由 = 合成事件会给出假绿灯**：页面内 `dispatchEvent` 绕开浏览器的 pointer→mouse 兼容事件派生，1.2.47 的「连线不收尾」在 `?flowsmoke` 全绿时真机全坏。编辑器**交互类**回归一律进这里，别再只靠合成事件。
   - 历史教训：t1..t8 时代的"无头桩"每次现写现丢在 /tmp，重启即绝迹；入库后新 bug 一律"先补一条会挂的测试，再修"。
   - 部署前仍须真机冒烟：`/api/runs` 返回 200 且 JSON 结构不变、页面 ver==api ver、安装副本==源码。
6. **前端一律 TypeScript（必须遵守）**：前端唯一合法源码是 `frontend/src/*.ts`（全局脚本模式，按文件名序拼接，不用 import/export）。
   - `scripts/ccviewer/static/index.html` 中主 `<script>` 块是 **build 产物，禁止手改**；改前端 = 改 `frontend/src/` → `python3 frontend/build.py`（tsc --strict 类型检查+编译 → 注入 `frontend/template.html`）。构建失败（任何类型错误）禁止部署。
   - 唯一保留的手写 JS 例外：`template.html` head 里的 3 行夜间主题 boot 片段（须先于 body 存在执行）；HTML/CSS 壳也手改 `template.html`（再 build）。
   - 1.2.31 起全仓库手写 JS 仅剩该片段（测试与安装器均已 TS 化）：npm 安装器源码是 `tools/install.ts`，`bin/install.js` 为其 **tsc 编译产物（提交入库）**——npm `bin` 指向产物,因用户 node 可能低至 16.7、不能依赖原生 .ts。产物禁手改：改 `.ts` 后 `npm run build`（`npm install`/`npm publish` 的 prepare 钩子自动重建），`tests/test_packaging.py` 会核对产物==编译输出。
   - `frontend/dist/` 为中间产物（拼接源+编译 JS），不进安装副本；同步/安装只需 `scripts/`。
   - 后续本仓库所有新增/修改的前端逻辑都必须用 TS 编写；发现 index.html 与 `frontend/src` 不一致时，以 build 重建为准，禁止直接补丁产物。

7. **日志/输出信息必须「可看全」（违反即 bug）**：任何展示日志、转录、命令输出、错误回执、通知正文的界面，都必须给用户一条看到**全部内容**的路径，三选一——
   - ① 详情抽屉：`<details class="term">` + `data-src` 懒拉全文（结果缓存进 `FULL`，跨轮询不重取）；
   - ② 定高展示框 + 纵向滚动：复用既有 `.rich,.pane pre{max-height:clamp(300px,45vh,560px);overflow:auto}`；**新增滚动容器必须一并纳入 `render()`/`renderSessions()` 的 scrollTop 快照选择器**，否则轮询重建后滚动位置丢失；
   - ③ 内容本身就是短的（单行结构化字段）。
   - 禁止「只裁不展」：`slice()` / `text-overflow:ellipsis` / `-webkit-line-clamp` 只能作为**摘要**出现在同一信息已有展开入口的地方；摘要行自己必须可展开且**展开即全文**（会话卡 `.waitline` = details + `data-src="S|proj|sess|main#lastTextMid"` 懒拉该步所在回合的累计全文，`.promptline` = `main#<记录uuid>` 懒拉整条用户输入全文；只展开一个仍被裁的摘要=违规，1.2.11 就栽在这）。
   - 禁止在展示层二次砍数据源已给的量（历史坑：后端给 30 行日志、前端 `slice(-15)`，另 15 行永久看不见）。要省空间就限高滚动，不要限条数/限字符。
   - 数据源有硬上限时**必须在界面上写明**（日志尾标注「近 N 行·单行≤M 字」；尾窗 256KB / `DETAIL_CAP` 取不到全文时走 `miss:True` → 「⚠ 该步已超出转录留存范围」），不许让用户误以为看到的就是全部。
   - 非页面通道（飞书通知正文、`server.log` 单行）没有滚动：必须自带定位锚（项目 + runId/会话前 8 位）让人回页面看全，且**错误类宁可不截**（webhook 回执/异常串保留 2000 字）。

8. **统计口径单点 + 消费者审计（违反即 bug；1.2.34→1.2.38 连续五版同类用户反馈换来的元规则）**：凡"计数 / 列表 / 门禁 / 过滤命中"这类统计概念——
   - 判定逻辑只许住**唯一函数**（`_window_hit`/`_user_prompt`/`window_activity`/`sessHit`/`sessStuck`/`diffPaint`…），各展示面只许调用，禁止另写一份"同一口径"；
   - **改口径 = 先枚举全部消费者**（API 字段→下拉→仪表→卡片→tooltip→通知→测试），同一版本一起改——只改数据源不改消费者列表（或反之）是本项目最贵的失误模式（1.2.36 改仪表埋 1.2.38 之雷）；
   - 口径类修复的测试必须**把参数切换多次做参数化断言**（如 4d/14d/45d/1d 四档），并钉**对账不变量**（用户能从可见数字核到明细：列表之和==仪表小计）；
   - fs 元数据（mtime/size/目录项）只支持"内容不可能比它新"的**单向负控制粗筛**，绝不配做入选依据；入选看内容自带语义（timestamp/type/stop_reason）。固定尺寸尾窗只许做显示成本控制，不许做计数与判定数据源。详见 `docs/lessons-learned.md` 类 1/2。

## 双路径陷阱：源码 ≠ 运行副本

插件已安装后，**运行时加载的是缓存副本**，不是本仓库：

```
源码(本仓库)  ~/projectDir/cc-viewer/
安装副本      ~/.claude/plugins/cache/kw-dev-plugins/lucid/<版本>/   ← 命令/服务实际从这里加载
```

- 改完源码必须同步：前端有改动先 `python3 frontend/build.py`（tsc 过编译，产物落 `static/index.html`）；然后 `claude plugin validate .` + `claude plugin install lucid@kw-dev-plugins` 重装，或手动覆盖安装副本（版本目录一致时等效，**`scripts/` 含 `ccviewer/` 子包与 `static/`，拷贝要递归 `cp -R`；`frontend/` 是开发源码，不进安装副本**）。
- **正在运行的服务进程是旧代码**——重启才生效。常驻进程有两把：**server 与 guard 看护循环**，且 guard 会从**自己的运行路径** setsid 拉起 server——只重启 server 不杀 guard，旧循环会探测端口后把旧代码原地复活（1.2.10→1.2.11 实际踩坑，此后每次部署必"先杀旧 guard"）。升级动作顺序固定：`kill $(cat ~/.claude/cc-viewer/guard.pid)` → `server.py --stop` → 从**新安装副本路径**后台起 server → 新路径起 `guard.py --detach`。
- 排查"改了没生效"先 `ps -o command -p $(cat ~/.claude/cc-viewer/server.pid)` **与 guard.pid 两条一起看**：两个路径的版本号必须一致且都指向新目录。

## 架构（多文件模块地图，按模块/函数名定位）

`scripts/server.py` 是薄入口（argparse / 启停 / 线程与端口装配），核心在 `scripts/ccviewer/` 包：

| 模块 | 职责 |
|------|------|
| `config.py` | `PROJ`/`CONF_DIR`/`PIDF` 路径、`CURRENT_PORT`（入口赋值，web 请求期以 `config.CURRENT_PORT` 属性读取）、`load_conf`/`save_conf`/`port_free`、`DETAIL_CAP`/`TURN_RESULT_CAP`/`INPUT_TIERS` 契约常量。**路径与配置一律 `config.X` 属性访问**（不许 from-import 按值拷贝——测试靠单点重定向 `config.PROJ`/`config.CONF_DIR` 驱动真实代码） |
| `jsonl.py` | JSONL 读取族唯一实现（1.2.18 收编原四处自造窗口读取）：`iter_records`/`tail_text`/`tail_records`/`head_records`/`rev_lines`（反向深扫，**16MB 上限为文档承诺并已真正执行**，超界走 miss）。行为契约钉在 `tests/test_jsonl_unit.py`，改读取层先过它 |
| `guard.py` | 自启动/看护：双触发口——`hooks/hooks.json` 的 SessionStart 钩子（主入口，任意版本可用）+ `monitors/monitors.json` 官方后台 monitor（需 CC ≥2.1.105 且宿主支持，实测第三方网关宿主会静默跳过）；两者都跑 `--detach`：guard.pid 跨会话幂等确保常驻看护循环，循环 TCP 探活 `127.0.0.1:<port>` 未监听→setsid 分离启动 `server.py`（独立于会话存活），周期复查崩溃自动重启；循环仅状态变化输出一行（落 server.log），常稳态零输出 |
| `scan.py` | 扫描与状态重建（下表"扫描/存活"两层） |
| `agent.py` | `api_agent()` 单 agent 全文 |
| `sessions.py` | 主 agent 与子代理状态（`scan_sessions()`→`/api/sessions`）：**无权威 journal，尾窗启发式推断**——主:`main_state()` 四态 running / **input_required**(等待用户，`waitReason`=ask〔挂起 AskUserQuestion/ExitPlanMode〕\| permission〔挂起普通工具且静默 ≥120s，"疑似"，与长命令同形〕\| turn〔无挂起、末条 assistant 且 `stop_reason`∈end_turn/stop_sequence〕) / waiting / ended；**running 亦带成因 `waitReason`=workflow**(1.2.42——真实反馈「提示等待授权,实际主 agent 已把任务交给工作流在执行」:挂起 `Workflow` 工具 **且该会话有运行目录 `subagents/workflows/wf_*`**＝工作流已启动后台跑,其单条长步骤会让主转录静默 >120s 被误判成 permission⏸告警+推"等待授权"→ 判 `running/workflow`,页面显示"等待 workflow 执行"用活动样式、`sessStuck` 不含它(不计⏸、不发等待推送);无运行目录的挂起 Workflow(启动授权待批窗口)仍走 permission。运行目录信号住 `scan_sessions`(与 `age` 用的 `subagents/agent-*.jsonl` 平铺 glob 不同源,workflow 深一层),判定只住 `main_state` 一处,四消费者(徽标 wlab/sessStuck/⏸ 计数/notify.WAIT_ZH)共用):子:mtime<90s=running，尾行 `stop_reason==end_turn`=done，否则 idle。候选 = **转录 `<sess>.jsonl` ∪ 会话目录**（只遍历目录会漏掉无子代理的纯交互会话，即"在等你"的那个）；`scan_sessions_cached(6)` 供通知线程复用。门禁=活跃 ∪ 近 2h 实时口径 ∪ 【回看窗口口径】(`_window_hit` 单点,与 projects[]/byCwd 同一判定,1.2.38——真实反馈「选 claudeConfig 仪表 10 任务、下方列表一张卡没有」:仪表 1.2.36/37 已落窗,列表曾只认活跃+2h),上限 200(旧 40 会被 10d 窗实测 64 会话截断,重现同症状),转录只读尾 256KB 控制成本；`lastText` 为 300 字摘要且同回 `lastTextMid`（该摘要所在消息 id——前端等待行 data-src 的全文锚点，摘要+可拉全文=合规，只给摘要无锚点=违规）；`prompts`＝卡顶「❯ 你输入」回显（`_user_prompt` 判"真·用户输入"→tool_result/isMeta/`<local-command-*>`/无参命令全剔除,`/goal` 取 `<command-args>`；条目 {u,t≤300,ts}=尾窗最近 30 条+头扫首条 `f:1`，用户记录无 message.id，全文锚点=记录 uuid 走 `_prompt_detail`）；**步骤 `turn` 键**（`_main_steps` 每步带"开启该回合的真人输入记录 uuid"，''=输入在尾窗之前；边界判定复用 `_user_prompt` 单点）——展示端以「一次任务=一个独立展示单元」按回合分组（1.2.20）；**按步全文 `_step_detail` 例外:1MB 块反向深扫至 16MB**（截图附件是 MB 级 base64,会把旧步骤挤出固定尾窗;找不到返回 `miss:True`,前端必须显式提示而非静默空白）；**OUT=回合累计全文**（`_turn_texts` 以"上一条真人输入"为边界,按时间序收集所在回合的 assistant text **与工具活动(▸ 调用入参/◂ 回执,单条回执≤`TURN_RESULT_CAP` 超限标注「截断」,未回执行标「未回执」)**;单步只展示自己那块=用户报的"每次只展示最新一条",1.2.15 修;只收 text 块会让工具型回合全文变成一串以冒号收尾的过渡句、冒号后永远没内容=用户报的"每行以:结尾之后无内容",1.2.18 修——数据在转录里,显示层砍的即铁律7 违规;IN 仍按步隔离,子代理/等待行同用此单点)。`turns`＝**全转录精确计数**（`count_user_inputs`:逐行子串预筛后走 `_user_prompt` 单点判定,同 uuid 重传去重,(mtime_ns,size) 缓存→稳态零重读,半行自然丢弃下轮补;实测全库 111MB 仅 0.2s。旧"尾窗 256KB+头扫首条"对大会话系统性数错——真实反馈「执行任务总次数显示错误」,1.2.36 修）；`window_activity()`＝项目列表+TASKS 的**单一数据源**,返回 {projects[], tasks{total,byCwd}}:真人输入按【自身时间戳】落回看窗口(缓存含时间戳升序列表,跨窗长会话只计窗内、无时间戳旧记录按会话活动度兜底)。判窗不信 fs mtime——mtime 只作「内容不可能比它新」的粗筛,入选看最后一条输入的时间戳(真实反馈:4d 窗口混进没操作过的项目,mtime 被非输入写入顶新而内容在 4.9d 前,1.2.37 修)；该判定住 `_window_hit` **唯一实现**,projects[]/byCwd/会话卡列表三处共用,不许写第二份(1.2.38)。测试 `tests/test_sessions_window.py` |
| `notify.py` | webhook 通知线程（下表） |
| `web.py` | HTTP handler `class H`、`make_server()`，启动时读入 `static/index.html`（**改了 static 下产物必须重启服务才生效——INDEX_HTML 是 import 期读的**）。编排器三单点全在本模块（handler 只调用，不写第二份口径）：`static_path`（白名单静态件：末段取名 + 枚举 + resolve 后 is_relative_to 软链双保险）、`_draft_dir`（cwd→`<sanitize>-<hash6>`，**cwd 永不作为写路径成分**；空 cwd 落 `__no_cwd__` 常量而非进程工作目录——`realpath('')` 会回落 cwd，保存与回载就可能不同目录=存了却看不见）、`save_draft`（`.js`+`.json` 成对 `tmp→os.replace` 原子落盘；同名异内容默认并存 `<name>-<sha8>.*`，`overwrite:true` 才覆盖；name 白名单 `[A-Za-z0-9][A-Za-z0-9._ -]{0,79}\Z`；脚本空/超 1MB/`draft.v!=1`/非 dict 全拒；OSError 回 `ok:false` 不打 500）、`list_drafts`（**目录枚举本身即口径**，坏件静默跳过，`DRAFT_LIMIT=200`） |
| `static/index.html` | 前端运行时文件：**HTML/CSS 壳 = `frontend/template.html`，脚本块 = `frontend/src/*.ts` 的 tsc 编译产物**（禁手改，见铁律 6） |
| `frontend/src/*.ts`（仓库根） | 前端 TS 源码：00-types(类型契约/共享状态+图类型) 05-i18n(多语言文案层) 10-util(mdLite 渲染器) 20-render(运行卡/会话卡) 30-app(轮询/diff 装配) **39-flow-shim(vendor ambient 声明，纯 declare 不产出 JS) 40-flow(编排器模态) 45-flowgen(图→脚本纯函数，零 DOM)**；`build.py` 构建，`dist/` 为中间产物 |
| `static/xyflow.system.umd.js` | vendored `@xyflow/system@0.0.82` UMD（100KB，d3 内联，全局名 `XYFlowSystem`）——**提交入库的构建产物**（铁律 1 合规形态，同 `bin/install.js`），由 template 在主脚本块**之前**以经典 `<script src>` 引入；**人工锁版**：0.0.x 无 semver 承诺，升级=换文件 + 重跑 §7 契约测试 + headless 五断言（runbook 见 dev-guide §9） |

分四层的行为要点：

| 层 | 入口 | 要点 |
|----|------|------|
| 扫描/状态重建 | `scan.scan()` → `parse_completed()` / `parse_live()` | run JSON **只在正常收尾时写**；进行中状态由 journal.jsonl + agent-*.jsonl 实时重建；回看窗口门禁的活动度=**max(会话目录 mtime, 转录 `<sess>.jsonl` mtime)**——目录 mtime 只在直接子项增删时刷新，journal/run 写入碰不到它，单用它会把"老目录里正在跑的 workflow"整段藏掉（仪表 RUNS/LIVE 失准的真实根因，1.2.14 修，与 sessions._candidates 同一取舍） |
| 存活判定 | `scan.live_session_ids()` + `scan.parse_live()` 尾部 | 权威信号 = `~/.claude/sessions/<pid>.json` 注册表且进程存活；父进程已死且有未完成 agent → `aborted`（孤儿），无 pending → `completed`；60s 宽限防竞态；`STALE_SEC=30min` 无活动 → `stale` |
| Webhook 通知 | `notify.notify_loop()` → `send_hook(r, text, kind)` | 守护线程 5s 一轮；**两类分型**：`workflow_status`（run 终态，`STATUS_ZH` 白名单）+ `input_required`（`notify_inputs()`，档位 `notifyInput`=off/blocked/all，默认 blocked 只发 ask/permission；正文 `sess_text()`）；**启动首轮静默播种**（`sweep`，防历史刷屏），键一律播种只把发送门控住（防"事后开启"补发历史）；去重靠 sent.json（保留 2000 条，run 键 `wf_*` 与 session 键 `sess|<id>|<静默起点>` 混存，字典序截断故上限抬高）；macOS 钥匙串导出 CA 解决公司 TLS 代理（`macOS_ca_bundle()`，每日刷新） |
| HTTP 端点 | `web.class H` | API：`/api/runs`（响应含 `projects[]`+`tasks{total,byCwd}`＝`sessions.window_activity()` 单点产出:项目下拉数据源与 TASKS 仪表同一判窗口径(输入自身时间戳落窗,mtime 只作粗筛),切换回看窗口两处一起变,1.2.37） `/api/sessions`（候选同走 `_window_hit` 窗口口径+活跃/近2h 实时口径——仪表数了的任务,下方列表必有其概览,1.2.38） `/api/agent` `/api/subagent` `/api/config` /api/config/save`（含 `notifyInput` 档位，缺省值不改）`/api/config/test`（body `{"kind":"input_required"}` 按等待型发） **`/api/drafts?proj=`（草稿列表/回载）`POST /api/draft/save`（保存草稿，Origin 守卫天然覆盖）`GET /static/<白名单>`** |

端口优先级：**config.json 的 port > `--port` 参数**；网页改端口保存后服务 `os.execv` 自重启到新端口（PID 不变），响应带 `reloc` 字段由页面自动跳转。

缓存三件套（进程内，勿轻易失效）：`_WF_CACHE`（已完结 run 的 name/phases 永不过期）、`scan_cached(6)`（notify 线程复用 6s 内扫描，省一半全盘 I/O）、前端 `CARDS`/`FULL`。

## 前端不变量（改 frontend/src/*.ts 时必读，改完 `python3 frontend/build.py`）

这些是历史 bug 换来的教训，破坏会复发：

- **按卡 diff 渲染**（`render()`）：完成卡数据冻结 → HTML 串不变 → DOM 不重建，滚动/选中不跳。不许改回整体 innerHTML 重绘。
- **按卡 diff 只有一份实现：`diffPaint(el, store, items, painted)`（30-app，1.2.18 抽取）**——运行卡区与会话卡区（#sess/`SCARDS`）都走它。上面列的身份保持/ref 同步/open·滚动快照恢复等不变量住在这一个函数里；新增卡片区直接复用，勿再复制循环。其抽屉 `data-src="S|proj|sess|agent[#msgId]"` 走 `/api/subagent`（toggle 监听器双容器复用 `onToggle`）。
- **回合分组（1.2.20，会话卡任务区）**：一次真人输入=一个任务=一个独立展示单元——输入行（`.promptline.turnhd`）作组头带步数徽章，该回合步骤行挂在同组 `.tg` 下（1.2.45 起该回合启动的 workflow 运行卡也挂同组、按时间插在步骤行之间）；**归属只认后端 `step.turn`（`_main_steps` 单点），前端不许再猜边界**。组序按时间戳排序（`turn=''`=尾窗前的孤儿组置顶且组头无锚点须显式措辞；只有输入没有步骤的新回合也自成一组）。组头/步骤抽屉键与分组前完全一致（`<sid>:prompt:<uuid>` / `<sid>:<msgId>`）——FULL 缓存与 open/滚动快照跨升级延续，改分组结构不许改键格式。契约测试 `tests/frontend/test_turn_group.ts`。
- **Workflow 内嵌卡（1.2.41 嵌入会话卡；1.2.45 落点细到步骤——用户两次反馈「主 agent 的展示信息和 workflow 信息块没有在一起」「主agent 和 itemview 和 workflow 的itemview 没有在一起」）**：主 agent 调起的运行卡嵌进发起会话卡的回合时间线（`.wfembed` 包层），**嵌不嵌只住 `wfEmbedded` 单点**（＝`runHit` ∧ 发起会话卡本轮 `sessHit`），sessCard 只渲染已判定清单；嵌入即从 #list 摘除，发起会话不可见时留独立卡。三消费者（仪表 rv / #list vis / 嵌入 embeds）必须共用 runHit+wfEmbedded——只数 #list 的仪表=1.2.38 对账事故复发。运行过滤从 render() 内联表达式抽出 `runHit` 单点（与 sessHit 同规矩，禁止第二份）；#list 空态判定用 rv 非 vis（全嵌入时不许谎报 NO MATCH）。**落点判定也只此一处（1.2.45，`sessCard` 内 `runsOf`/`grpBody`）**：运行卡按 `startedAt` 归入"最后一个 ts ≤ startedAt 的回合组"，组内与步骤行同池按时间混排（同刻步骤行在前），早于全部组的运行卡留组前独立单元；无运行卡的回合组走旧路径逐字节不变（黄金零漂移）。1.2.41 曾只做到**回合组粒度**（整组之后），一个 13 步的回合把该回合启动的 3 张卡全推到组尾——而当时夹具每回合只有 1 步，两种粒度输出相同，测试恒真（教训入 `docs/lessons-learned.md` 类 1）。data-k 命名空间天然不冲突（runId=`wf_*` vs sessionId=uuid），嵌入后 diffPaint 的 open/滚动快照按容器全子树恢复，展开态照常跨重建保持。**测试桩配套**：harness `matchChain` 的后代组合符此前误实现为"相邻逐级"（子组合符语义），平铺 DOM 侥幸等价，嵌套卡让它查空——已按 CSS 规范改回任意深度祖先匹配；新增嵌套 DOM 时链式选择器依赖此语义。契约测试 `tests/frontend/test_wf_embed.ts`（19 断言：在一起/步骤级时间序/紧挨发起步骤/仪表对账/过滤三态/展开态保持/懒拉在 #sess 生效/无步骤会话）。
- **IN/OUT 抽屉面板构造只有一份：`paneIn`/`paneOut`（20-render）**——正文统一过 `unent→mdLite`（预览与全文同一口径；曾出现"预览不解实体、展开才解"）；等待行/提示词行带 hint/miss 分支的面板是其近亲，改三态标签时同审。`ALERT_ST`（20-render）是仪表 ALERT 计数唯一判定集。
- **空态↔非空态对称清理**：`<p.idle>` 无 data-rid，diffPaint 的按卡清理不认识它——两个区的 render 都必须自己负责（`vis` 恢复时先摘 idle，否则永久残留，1.2.18 修过一次运行卡区）。
- **构建戳自取用 `document.querySelector('meta[name="wfo-ver"]')`**——模板里该 meta **只有 name 没有 id**，`getElementById` 必 null（"部署旧标签页自动刷新 + 版本角标"曾因写法错误静默失效多版，无头桩才暴露；勿回退成 `$('wfo-ver')`）。
- **卡 HTML 字符串禁止内嵌逐秒变化字段**（曾内嵌 `ageSec"Ns 前"` → 每轮 diff 必失配重建 → 展开的 details"点开即关"）：时间一律 `fmtC(epochMs)`，并保留 renderSessions 的 open/滚动快照恢复；步骤/抽屉的稳定键一律用 `message.id`（尾窗滑动不漂移）。
- **渲染转录/子代理文本必须先过 `unent()`**（实体转义竖线 `&#124;`/`&amp;#124;` 不解码则 mdLite 认不出表格、页面露出转义串），再进 `mdLite(wrapLong/pretty(...))`；行内预览不许再用裸 `inlineMd` 渲染可能含块级 md 的内容。
- **outerHTML 后 `ref` 同步**：替换节点若正被 `ref`（insertBefore 锚点）引用，必须指向新节点，否则抛 NotFoundError 打断整轮渲染（曾伪装成"链路中断"）。
- **tick 的 try/catch 分离**：fetch 失败与 render 失败必须分开报告——JS bug 不许冒充掉线（见 `tick()` 注释）。
- **后台节流补偿（1.2.16）**：`setInterval(2s)` 在隐藏标签页会被浏览器降到 ~1 次/分钟（真实反馈："终端输入后切回页面看不到最新执行信息"），`catchUp()` 在 visibilitychange/pageshow/focus 时立即补扫（1s 冷却去重；`auto` 关闭则尊重设置不越权）。新增轮询/刷新驱动不许只挂 setInterval——必须同时有可见性补扫路径，否则节流问题复发。
- **详情抽屉滚动位置 / details 展开态**跨轮询保持（`sc` 快照 + `open` 集合恢复）；全文靠 `FULL` 缓存 + `/api/agent` 首次展开拉取。
- **项目下拉(#fproj)数据源 = `/api/runs` 的 `projects[]`(回看窗口内有会话活动的全部项目,含无 workflow 运行的纯会话项目)∪ runs/sessions 载荷键**——只从 runs∪sessions 推列表会把纯会话项目整个藏掉(真实反馈:「窗口设 180 天,展示的总项目数不对」,1.2.35 修);键一律 `cwd||project` 与过滤判定同源可去重;重建判定比**内容串**(`PSTR`,20-render)不比数量——数量相同集合变化(一进一出)时旧数量判定永久留陈旧选项。判窗**只信转录内容里每条输入的 timestamp**,fs mtime 仅作「内容不可能比它新」的粗筛——真实反馈:4 天窗口列出没操作过的项目(researchProject 类:mtime 被非输入写入顶新,最后输入在窗户外),`projects[]` 与 `tasks` 同住 `sessions.window_activity()` 单点,多次切换窗口时列表与计数一并正确(1.2.37)。契约测试 `tests/frontend/test_proj_list.ts` + `tests/test_tasks_count.py` 多窗口参数断言。
- **筛选/视图状态必须 localStorage 持久化**（`wfo-fproj`/`wfo-fstr`/`wfo-auto`）：项目筛选/搜索词/自动刷新只存内存模块变量 → 刷新(含部署自动 reload)后全丢（真实用户 bug）；启动恢复 + 选项重建带 `selected`，保存值已不在数据源时清空回落。新增筛选字段同理。仪表计数是"视图口径"——过滤/搜索生效时 RUNS 必须显示 `命中/总数` 并挂 title 说明原因（否则用户把被滤掉的运行当成"数据不准"，1.2.14 真实反馈；测试 t4 以 `3/4`+title 断言）。**例外:TASKS 是"回看窗口口径"**（1.2.36,数据源 `/api/runs.tasks`＝真人输入按自身时间戳落窗的精确和,而非视图会话和——视图曾只含"活跃+近2h",求和会把窗口口径压成几小时,真实反馈「总次数又显示错误」;1.2.38 起视图本身也按 `_window_hit` 落窗,会话列表与 byCwd 对账一致）:无过滤=tasks.total；仅项目=byCwd[fproj]/total(窗口精确命中)；含搜索=视图命中/total(搜索够不到窗口外会话,title 交代);无 tasks 字段(旧后端)回落 tsum(视图 turns)。契约测试 `tests/frontend/test_tasks_gauge.ts`。
- **会话等待态（3.2）**：`input_required` 的判定只在后端 `sessions.main_state()` 一处（三分 `waitReason`），前端只做展示与高亮，不许再推断；**告警/安静的显示分级也只有一个判定点 `sessStuck`**（20-render）——ask/permission=真卡住→反白 ⏸ 闪烁告警+色条+计入区标题 ⏸ N；turn=执行完成正常交回→安静青色「回合已完」、无告警视觉（用户据此报过 bug:"关了通知还提示等待输入"——通知档位从来只管推送,页面显示曾把 turn 一律渲染成 ⏸ 才是根因,1.2.13 分档）。卡 HTML 里放的是 `wlab`/`wtxt` 等**每轮稳定**字段，绝不放 `ageSec` 或 `AD()` 毫秒相位（1.2.13 曾给告警徽标加 `AD(1.8)`→冻结数据每轮 diff 失配→"点开即关"复发,测试 `diff/stable` 拦下）。新增等待成因只改 `main_state` + 前端 `wlab`/`sessStuck` + `notify.WAIT_ZH` + i18n 四处，缺一处即出现"页面说等待授权、推送写未知"。**交接工作流(1.2.42,真实反馈「提示等待授权,实际主 agent 已将任务交给工作流执行」)不是"等人"成因,别塞进 `input_required`**:`main_state` 判 `status=running` + `waitReason=workflow`(仅当挂起 `Workflow` 且该会话有运行目录 `subagents/workflows/wf_*`＝已启动在后台跑;无目录仍 permission),徽标 `badge` 走 running 活动样式显示"等待 workflow 执行",`sessStuck` 不认它→不⏸/不计等待数/不发等待推送(notify 只发 input_required,天然过滤);⏸ 计数与等待推送的门槛恒为 ask|permission,加新"非卡住"态时勿误扩。测试 `tests/frontend/test_workflow_wait.ts` + 后端 `test_sessions_state.py`(E 交接/F 无目录对照)。
- **提示词回显（1.2.13）**：「什么算用户输入」只在后端 `sessions._user_prompt()` 一处判定（剔除 tool_result/isMeta/`<local-command-*>`/无参命令，`<command-name>/x</command-name>`+`<command-args>` 合成 `/x args`），摘要（`_analyze.prompts`）与全文（`_prompt_detail` 按记录 uuid 反查）共用它，不许前端再过滤；用户记录**没有 message.id**，锚点一律用转录记录 uuid。
- **多语言：新增用户可见文案一律走 `T()`（`frontend/src/05-i18n.ts`）** —— key 就是简体中文原文（源语言，zh 不入字典），插值 `%1..%n`；查不到自动回落 key，所以漏译显示中文而非空白。静态壳文案挂 `data-i18n`（换 textContent）/`data-i18n-ph`（换 placeholder），由 `applyI18n()` 统一刷；`<b>01</b>` 这类编号必须包到内层 `<span>`，否则整块被覆盖。CSS `content:` 里的文案走 `html[lang=x]{--tr-more:…}` 变量（与 JS 字典各一份）。语种存 `localStorage.wfo-lang`（与 `wfo-theme` 同为"视图状态"，**不进服务端 config.json**），首访按 `navigator.language` 猜。切语言必须走 `setLang()`：它清 `CARDS/SCARDS/GSTR` 与旧 `.idle` 节点后整屏重绘，漏清则该语言下 diff 陈旧。后端 `msg` 只做精确命中（`已保存` 等静息文案），含插值数字的校验错回落原文，不为此加模糊匹配。
- `mdLite` 用 \u0001 控制字符做占位符抽取围栏/表格，改动分段逻辑注意转义。

### 编排器不变量(1.2.43，改 `40-flow.ts` / `45-flowgen.ts` / `#flow` 骨架时必读)

- **与主视图物理隔离**：编辑器 DOM 只住 `#flow`，绝不进 `#list`/`#sess` 的 diffPaint 池（`test_render_golden.ts` 采样区之外，黄金必须零漂移）；`tick()/render()/catchUp()` 不碰它，编辑器打开时轮询照常；`flowRender()` 未 `flowWired` 时直接返回。**节点/handle HTML 只有一份实现：`nodeHTML`/`handleHTML`**——C2–C6 的类名与 `data-id` 拼法全在这里，别处再拼一份即铁律 8 违规（`test_flow_editor.ts` 按选择器钉死）。
- **`XYFlowSystem` 只许在函数体内取**（顶层解构会在无 vendor 的环境——无头桩——直接 ReferenceError 打断整块产物；一律走 `xy()`）。喂给 vendor 的**每个回调**必须经 `safely()`：vendor 对包装层回调不做 try/catch，抛出即静默打断它自己的监听注册（症状"拖出虚线后松手什么都没发生"）；`XYPanZoom` 的六个回调（含 `onTransformChange`）一个不许省（内部无空值防护直调）。`handleBounds` 由 `measureFlow()` 手写测量并**除以 zoom** 后注入 `internals`（不引 ResizeObserver；漏除=非 1 倍缩放下吸附与边端点全错）。
- **派生缓存每次交给 vendor 前必须刷成真值**(1.2.49,真实反馈「在 agent 编排时拖拽节点会漂移」)——`flookup` 是喂给 vendor 的缓存,`FS.nodes` 才是唯一真相;而 vendor 的 `adoptUserNodes` 默认 **`checkEquality=true`:节点对象引用没变就沿用旧 `internals`**。我们的 `applyDrag` 是原地改 `n.position`(不做不可变更新)→ `positionAbsolute` 停在上一次拖拽前的值 → vendor 的拖拽基线(`distance = 指针 − positionAbsolute`)与最近 handle 搜索全用旧坐标:**拖过一次后再拖,节点跳回上一次的位移量**(跳变正好抵消这次拖动,看着像拖不动)。刷新只住 `syncLookup()` 一处(与 `handleBounds` 注入同点);`nodeOrigin=[0,0]` 且无父节点 ⇒ `positionAbsolute` 恒等于 `position`。**新增派生字段先问它要不要在这里刷**。测:`test_flow_editor` 的桩已忠实模拟 `checkEquality`(不模拟这条语义,该根因在无头桩里根本不可见)+ 真实输入 `tests/browser/test_drag_real.ts`(两次拖拽 + 缓存不变量 + 拖过再连线)。
- **连线起点绝不许 `ev.preventDefault()`**(1.2.47,真实反馈「连线成功后,连线没有结束」)——取消 `pointerdown` 会让浏览器**不再派发兼容鼠标事件**(mousedown/mousemove/mouseup;Chrome 实测,合成事件绕开这层所以冒烟全绿),而 vendor 的拖拽全靠 document 上的 mousemove/mouseup:拖拽期间零回调 → 松手不收尾 → 松手后一动鼠标手势才"迟到地"开始并跟着光标跑。防选中改由 CSS 承担(`#fPane user-select:none`,表单控件再放行),不碰事件默认行为。**新增任何 vendor 驱动的指针交互,先问"我这一下 preventDefault 会不会掐掉它的兼容鼠标事件"**。测:`test_flow_editor` 钉"pointerdown 不许调 preventDefault" + `tests/browser/test_connect_real.ts` 用真实输入跑全链路。
- **生成器三口径各一个函数**：`flowValidate`（错误清单，空=可生成）/ `flowMetaPhases`（phase 首现去重——顶部 PHASES 条与脚本 `meta.phases` 共用它）/ `flowGenerate`（出码，只有内部 bug 才抛）。UI 与测试只调这三个，禁止另数 phase 或自己判分层；产物不许含 `Date.now()/Math.random()`（沙箱禁用且破 resume）。
- **入口只在选中具体项目时存在**(1.2.44,真实反馈「选择全部项目时不应该有编排入口,只有选择具体项目时才支持通过拖拽的方式创建 workflow」)——判定只住 `flowCanCompose(cwd)` 一个函数,三个消费者共用:`syncFlowEntry()`(按钮显隐 + tooltip;由 `render()` 每轮与启动时各调一次,故 localStorage 恢复值失效回落、切项目都自动跟上)、`btnFlow.onclick`(不满足就不打开)、`openFlow()` 首行守卫(绕开入口也写不出无项目的草稿)。理由不是 UI 偏好而是数据口径:草稿目录 slug、提示词上下文、终端 `cd` 执行目录都要一个确定 cwd。**新增按项目的功能入口请照抄这个形状**(判定单点 + 展示面只调用 + 按钮默认 `hidden` 由 JS 决定显隐),别在按钮上写第二份 if。
- **坐标系换算单点 `paneToFlow`**(1.2.46,真实反馈「选中节点连线时,链接节点的虚线会漂移」)——屏幕(pane 相对像素)→ 流坐标只住这一个函数,三消费者共用:`drawConn` 的**未悬停**分支、拖放落点、`flowCenter`。为什么必须有:节点/边/临时虚线都住被 `translate+scale` 变换的 `#fViewport`,只有流坐标能在里面直接画;而 vendor 的 `connection.pointer` 是 **pane 相对屏幕像素**(`XYHandle` 内 `q(e,domNode)=clientX-paneRect.left`)——漏换算的偏移量 = `view.x + px·(zoom-1)`(平移多少偏多少)。**悬停到 handle 的分支坐标系数不同,别混**:那里用 `handlePoint()` 的流坐标。测:`test_flow_editor` 三档参数化(恒等/缩放/平移+缩放,判据是"在屏幕上钉住光标")+ `paneToFlow` 直测 + 冒烟 `connPath-anchored`。
- **草稿的落盘与枚举住后端单点**（`web.save_draft / list_drafts / _draft_dir`），前端只发请求、服务端不重编译（执行件由 `45-flowgen` 产出并随请求带上，单一真相）；铁律 2：草稿只写 `CONF_DIR/drafts/`，**执行永远在用户终端**（`Workflow({scriptPath})`），服务不碰控制面。
- **语言**：静态壳走 `data-i18n`，但节点卡、草稿下拉 `<option>`、状态行是**动态拼的** → `setLang()` 必须调 `flowRelang()`（重刷下拉 + 清一次性状态行 + 重绘），漏了就是"切语言后编辑器留着旧文案"；空画布提示故意**不用** `.idle` 类（`setLang` 会把它 `.remove()` 掉）。
- **真机冒烟**：`?flowsmoke=1` 把十条断言写进 `document.title`(1.2.46 新增 `connPath-anchored`:虚线自由端在**屏幕上**钉住光标——桩算得出流坐标、算不出"屏幕上钉不钉";`drag-add`:真实 HTML5 `DataTransfer` 拖拽建节点)（无头桩给不出真实布局，连线吸附/拖拽阈值/滚轮缩放只能浏览器实证）。三个已踩的**假失败/假挂死**：① 用自适应缩放的 7 卡起手图会把 handle 推到窗口外（`elementFromPoint` 拿不到）；② 拿图里已存在的节点对测"加边"，会被自己的去重单点静默吃掉；③ `#fConn` 常驻无限 CSS 动画 → 无头虚拟时钟永不空闲 → `--dump-dom` **挂死**（冒烟入口自带禁用动画的 `<style>`，1.2.46）。**它还会给出假绿灯**：冒烟全用合成事件，绕开浏览器的 pointer→mouse 兼容派生——1.2.47「连线不收尾」在它十断言全绿时真机全坏 → 交互类回归进 `tests/browser/test_connect_real.ts`（CDP 真实输入）。

## 开发/验证速查

```bash
python3 tests/run_all.py                 # ★ 回归总入口(改动前基线、部署前门禁;支持关键字过滤与 -v)
python3 tests/run_all.py web_api -v      # 只跑 HTTP 全链路并打印全部断言
UPDATE=1 node tests/frontend/test_render_golden.ts   # 故意改卡 HTML 后重录黄金快照(提交信息须注明)
npm install                                          # 开发机一次性(typescript+@types/node:typecheck 套件与安装器编译;运行时仍零依赖)
python3 frontend/build.py                # 前端:TS→tsc --strict→注入产物(首次自动抽 template.html)
python3 scripts/server.py                # 前台启动（默认 8787，config 优先）
python3 scripts/server.py --stop         # 按 PID 优雅停止
# ★ 编排器：三套件单跑 + 真机冒烟（改过 static 产物必须重启服务——INDEX_HTML 是 import 期读的）
python3 tests/run_all.py draft && python3 tests/run_all.py flow
python3 tests/run_all.py connect_real    # 真实输入冒烟·连线(CDP 驱动真 Chrome,自起临时服务;需本机 Chrome)
python3 tests/run_all.py drag_real       # 真实输入冒烟·拖拽节点(同上;脚手架在 tests/browser/harness.ts 共用)
T=$(mktemp -d); mkdir -p $T/.claude/projects $T/.claude/sessions $T/.claude/cc-viewer
HOME=$T nohup python3 scripts/server.py --port 8923 >/dev/null 2>&1 &      # 临时 HOME：不碰真实 pid/config
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless=new --disable-gpu \
  --window-size=1600,1000 --user-data-dir=/tmp/ch-flow --proxy-server=http://127.0.0.1:1 \
  --virtual-time-budget=15000 --timeout=20000 --dump-dom 'http://127.0.0.1:8923/?flowsmoke=1' | grep -oE '<title>[^<]*'
#   期望 SMOKE OK ✓nodes ✓contract-C3C4C5 ✓connPath-anchored ✓connect+1 ✓connPath-drawn ✓connPath-cleared ✓drag-move ✓zoom ✓drag-add ✓gen
#   （--proxy-server 让外网字体请求快速失败，否则 load 事件挂住 --dump-dom；localhost 默认不走代理）
python3 scripts/guard.py --once          # 看护:确保服务在跑(不跑则 setsid 拉起)并退出,调试用
python3 scripts/guard.py --detach        # 会话开始入口(函数自身):确保常驻循环在跑(无则 setsid 拉起)并退出
python3 scripts/guard.py --interval 3    # 看护循环(自启动/崩溃自动重启;由 hooks+monitors 双机制 --detach 拉起)
curl -s http://127.0.0.1:8787/api/runs | python3 -m json.tool | head   # 快照结构
curl -s http://127.0.0.1:8787/api/config                              # webhook 配置+最近推送
claude plugin validate .                 # 校验两份清单（CI 加 --strict）
```

数据目录探针（判断解析逻辑是否仍适配）：`~/.claude/projects/<proj>/<sess>/workflows/wf_*.json`、
`.../subagents/workflows/wf_*/journal.jsonl`、`.../workflows/scripts/<name>-wf_*.js`。

## 版本管理

本仓库是 git 仓库（2026-09-04 起）。

**铁律：每次更新 = 版本号 +1。** 任何变更（代码、前端构建产物、命令、README/文档、CLAUDE.md 规则本身、仅配置文件）一旦要同步给用户/市场，必须同步把 `.claude-plugin/plugin.json` 的 `version` +1（patch 级即可），**禁止"只改代码不升版本"**——升版本后 `claude plugin update` 会落到新的 cache 目录（`cache/.../lucid/<版本>/`），旧版本残留可清理；这样每次更新都可在 cache 中追溯。**npm 通道（1.2.30 起）：`package.json` 的 version 必须与 plugin.json 相等**，且运行时新增目录要同时进 `package.json.files` 与 `bin/install.js` 的 `COMPONENTS`，否则装出来的副本缺组件——`tests/test_packaging.py` 钉死这两条。

**npm 发布通道（kw-lucid）**：npm 包即"插件+自足市场"——tarball 根目录带 `.claude-plugin/marketplace.json`（source `"./"` 相对被 add 的目录解析，与仓库目录市场同一语义），用户 `npx -y kw-lucid` 或 `npm install -g kw-lucid` + `marketplace add "$(npm root -g)/kw-lucid"` 完成安装；`bin/install.js`（1.2.31 起为 `tools/install.ts` 的编译产物，`npm publish` 的 prepare 钩子自动重建，`test_packaging` 核对产物不陈旧）把包同步到稳定路径 `~/.claude/plugins/marketplaces/kw-lucid-npm/` 再走 claude CLI（避开 npx 缓存失效）。发布流程（需 `npm login`，手动执行）：`python3 tests/run_all.py && claude plugin validate . && npm pack --dry-run` 全绿后 `npm publish`。注意 CLI 的 `{"source":"npm"}` 插件源与 npm marketplace-add 亦存在/缺失（marketplace add npm 官方标注 not yet implemented），本通道刻意不依赖它们，保持本地开发流不变。配套流程（重装前先 `--stop` 旧进程）：

**铁律：每次功能/文档更新验证通过后，自动 `git commit`，不要等用户开口。** 提交信息按既有风格（`feature:` / `docs:` / `fix:` 前缀 + 中文描述 + 版本号 `1.x.x→1.x.x`）；含未跟踪文件用 `git add -A`；默认只 commit 不 push。若工作区混有历史遗留改动，一并纳入并在提交信息中注明。

**术语："发布" = 将最新内容推送到 GitHub。** 用户说"发布 / 发布到 github / 上线"等，一律理解为 `git commit`（若有未提交改动）+ `git push origin <当前分支>`，把本地领先的提交全部推到远端 `origin`（本仓库远端为 `git@github.com:haixcoder/LUCID.git`，走 SSH，无 `gh` CLI 时用 `git push`）；**无需再逐次征求 push 同意**——"发布"这个指令本身即明示。推送前先确认工作区已提交、`git status -sb` 无冲突，推后用 `git fetch && git status -sb` 验证 `main...origin/main` 不再 ahead。仅 commit（默认自动行为）不触发推送，只有"发布"指令才推送。

```bash
claude plugin validate . && claude plugin marketplace update kw-dev-plugins
claude plugin update lucid@kw-dev-plugins          # 升版本后重装到新 cache 目录
nohup python3 ~/.claude/plugins/cache/kw-dev-plugins/lucid/<新版本>/scripts/server.py &
git push origin main                              # "发布"=推送到 GitHub（详见上条术语定义）
```
