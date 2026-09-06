# CLAUDE.md

本文件指导 Claude Code 在本仓库中的工作。修改本仓库代码前先读完本文件。

## 项目是什么

Claude Code 插件 **lucid**：网页版 Workflow 执行进度实时查看器。
零依赖（仅 Python3 stdlib）、无构建步骤、服务只绑定 127.0.0.1。
本目录同时就是本地市场 `kw-dev-plugins`（`.claude-plugin/marketplace.json` 中 source 为 `"./"`）。

- 用户文档：`README.md`（英文版，GitHub 默认展示）/ `README.zh-CN.md`（中文版），两份互链；内容（原理、安装、页面功能、API、安全）改动时须同步对方
- webhook 详解：`scripts/README.md`
- 扩展调研：`docs/feature-extension-research.md`（2026-09 定稿：数据源实证地图 D1–D19 + 官方通道核实 + E1–E15 方案卡；`ROADMAP.md` 为其初版，§7 为勘误表）

## 铁律（违反即 bug）

1. **零依赖**：`scripts/server.py` 与 `scripts/ccviewer/` 包只许 import stdlib。不引第三方包、不加 pip install 步骤。
2. **只读数据源**：扫描 `~/.claude/projects/` 永远只读；服务唯一可写目录是 `~/.claude/cc-viewer/`（config.json / sent.json / server.pid / cas.pem）。
3. **仅本机监听**：bind 地址硬编码 `127.0.0.1`，绝不改成 0.0.0.0；POST 保留 Origin 同源守卫。
4. **命令模板变量必须写花括号形式** `${CLAUDE_PLUGIN_ROOT}`——裸 `$CLAUDE_PLUGIN_ROOT` 不会被 Claude Code 展开，且该变量不存在于 Bash 工具环境（2026-09-04 实际踩坑：导致从项目源码而非已安装插件启动服务）。`commands/lucid.md` 中已修复，勿回退。
5. **回归测试已入库，`python3 tests/run_all.py` 是准入门槛（1.2.18 起）**：
   - `tests/test_*.py`（后端，纯 stdlib）：fixture 驱动真实函数 + `test_web_api.py` 真起 server 子进程打全链路 HTTP；
   - `tests/frontend/test_*.ts`（前端一律 TypeScript，1.2.31 起；开发期依赖 node——运行时仍零依赖）：node 原生 type-stripping 直跑 .ts（**需 node ≥22.18**，无编译步骤；版本过旧 run_all 警示并跳过）；`harness.ts` 无头 DOM 桩加载**真实编译产物**驱动 render/diff/抽屉/轮询；`test_render_golden.ts` 为 card/sessCard 出 HTML 的黄金快照——**任何前端重构前后黄金必须逐字节一致**（故意改文案/结构才 `UPDATE=1` 重录并在提交注明）；类型检查由 `typecheck.ts` 套件代跑（`tsc -p tsconfig.check.json`，需开发机 `npm install` 一次；无 node_modules 则警示跳过）；
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

## 双路径陷阱：源码 ≠ 运行副本

插件已安装后，**运行时加载的是缓存副本**，不是本仓库：

```
源码(本仓库)  ~/projectDir/cc-viewer/
安装副本      ~/.claude/plugins/cache/kw-dev-plugins/lucid/<版本>/   ← 命令/服务实际从这里加载
```

- 改完源码必须同步：前端有改动先 `python3 frontend/build.py`（tsc 过编译，产物落 `static/index.html`）；然后 `claude plugin validate .` + `claude plugin install lucid@kw-dev-plugins` 重装，或手动覆盖安装副本（版本目录一致时等效，**`scripts/` 含 `ccviewer/` 子包与 `static/`，拷贝要递归 `cp -R`；`frontend/` 是开发源码，不进安装副本**）。
- **正在运行的服务进程是旧代码**——重启才生效：
  `python3 <脚本路径> --stop`（按 PID 文件停），再后台启动**安装副本路径**的脚本。
- 排查"改了没生效"先 `ps -o command -p $(cat ~/.claude/cc-viewer/server.pid)` 看进程从哪份代码启动。

## 架构（多文件模块地图，按模块/函数名定位）

`scripts/server.py` 是薄入口（argparse / 启停 / 线程与端口装配），核心在 `scripts/ccviewer/` 包：

| 模块 | 职责 |
|------|------|
| `config.py` | `PROJ`/`CONF_DIR`/`PIDF` 路径、`CURRENT_PORT`（入口赋值，web 请求期以 `config.CURRENT_PORT` 属性读取）、`load_conf`/`save_conf`/`port_free`、`DETAIL_CAP`/`TURN_RESULT_CAP`/`INPUT_TIERS` 契约常量。**路径与配置一律 `config.X` 属性访问**（不许 from-import 按值拷贝——测试靠单点重定向 `config.PROJ`/`config.CONF_DIR` 驱动真实代码） |
| `jsonl.py` | JSONL 读取族唯一实现（1.2.18 收编原四处自造窗口读取）：`iter_records`/`tail_text`/`tail_records`/`head_records`/`rev_lines`（反向深扫，**16MB 上限为文档承诺并已真正执行**，超界走 miss）。行为契约钉在 `tests/test_jsonl_unit.py`，改读取层先过它 |
| `guard.py` | 自启动/看护：双触发口——`hooks/hooks.json` 的 SessionStart 钩子（主入口，任意版本可用）+ `monitors/monitors.json` 官方后台 monitor（需 CC ≥2.1.105 且宿主支持，实测第三方网关宿主会静默跳过）；两者都跑 `--detach`：guard.pid 跨会话幂等确保常驻看护循环，循环 TCP 探活 `127.0.0.1:<port>` 未监听→setsid 分离启动 `server.py`（独立于会话存活），周期复查崩溃自动重启；循环仅状态变化输出一行（落 server.log），常稳态零输出 |
| `scan.py` | 扫描与状态重建（下表"扫描/存活"两层） |
| `agent.py` | `api_agent()` 单 agent 全文 |
| `sessions.py` | 主 agent 与子代理状态（`scan_sessions()`→`/api/sessions`）：**无权威 journal，尾窗启发式推断**——主:`main_state()` 四态 running / **input_required**(等待用户，`waitReason`=ask〔挂起 AskUserQuestion/ExitPlanMode〕\| permission〔挂起普通工具且静默 ≥120s，"疑似"，与长命令同形〕\| turn〔无挂起、末条 assistant 且 `stop_reason`∈end_turn/stop_sequence〕) / waiting / ended；子:mtime<90s=running，尾行 `stop_reason==end_turn`=done，否则 idle。候选 = **转录 `<sess>.jsonl` ∪ 会话目录**（只遍历目录会漏掉无子代理的纯交互会话，即"在等你"的那个）；`scan_sessions_cached(6)` 供通知线程复用。只扫"活跃或近 2h"会话，上限 40，转录只读尾 256KB 控制成本；`lastText` 为 300 字摘要且同回 `lastTextMid`（该摘要所在消息 id——前端等待行 data-src 的全文锚点，摘要+可拉全文=合规，只给摘要无锚点=违规）；`prompts`＝卡顶「❯ 你输入」回显（`_user_prompt` 判"真·用户输入"→tool_result/isMeta/`<local-command-*>`/无参命令全剔除,`/goal` 取 `<command-args>`；条目 {u,t≤300,ts}=尾窗最近 30 条+头扫首条 `f:1`，用户记录无 message.id，全文锚点=记录 uuid 走 `_prompt_detail`）；**步骤 `turn` 键**（`_main_steps` 每步带"开启该回合的真人输入记录 uuid"，''=输入在尾窗之前；边界判定复用 `_user_prompt` 单点）——展示端以「一次任务=一个独立展示单元」按回合分组（1.2.20）；**按步全文 `_step_detail` 例外:1MB 块反向深扫至 16MB**（截图附件是 MB 级 base64,会把旧步骤挤出固定尾窗;找不到返回 `miss:True`,前端必须显式提示而非静默空白）；**OUT=回合累计全文**（`_turn_texts` 以"上一条真人输入"为边界,按时间序收集所在回合的 assistant text **与工具活动(▸ 调用入参/◂ 回执,单条回执≤`TURN_RESULT_CAP` 超限标注「截断」,未回执行标「未回执」)**;单步只展示自己那块=用户报的"每次只展示最新一条",1.2.15 修;只收 text 块会让工具型回合全文变成一串以冒号收尾的过渡句、冒号后永远没内容=用户报的"每行以:结尾之后无内容",1.2.18 修——数据在转录里,显示层砍的即铁律7 违规;IN 仍按步隔离,子代理/等待行同用此单点) |
| `notify.py` | webhook 通知线程（下表） |
| `web.py` | HTTP handler `class H`、`make_server()`，启动时读入 `static/index.html` |
| `static/index.html` | 前端运行时文件：**HTML/CSS 壳 = `frontend/template.html`，脚本块 = `frontend/src/*.ts` 的 tsc 编译产物**（禁手改，见铁律 6） |
| `frontend/src/*.ts`（仓库根） | 前端 TS 源码：00-types(类型契约/共享状态) 05-i18n(多语言文案层) 10-util(mdLite 渲染器) 20-render(运行卡/会话卡) 30-app(轮询/diff 装配)；`build.py` 构建，`dist/` 为中间产物 |

分四层的行为要点：

| 层 | 入口 | 要点 |
|----|------|------|
| 扫描/状态重建 | `scan.scan()` → `parse_completed()` / `parse_live()` | run JSON **只在正常收尾时写**；进行中状态由 journal.jsonl + agent-*.jsonl 实时重建；回看窗口门禁的活动度=**max(会话目录 mtime, 转录 `<sess>.jsonl` mtime)**——目录 mtime 只在直接子项增删时刷新，journal/run 写入碰不到它，单用它会把"老目录里正在跑的 workflow"整段藏掉（仪表 RUNS/LIVE 失准的真实根因，1.2.14 修，与 sessions._candidates 同一取舍） |
| 存活判定 | `scan.live_session_ids()` + `scan.parse_live()` 尾部 | 权威信号 = `~/.claude/sessions/<pid>.json` 注册表且进程存活；父进程已死且有未完成 agent → `aborted`（孤儿），无 pending → `completed`；60s 宽限防竞态；`STALE_SEC=30min` 无活动 → `stale` |
| Webhook 通知 | `notify.notify_loop()` → `send_hook(r, text, kind)` | 守护线程 5s 一轮；**两类分型**：`workflow_status`（run 终态，`STATUS_ZH` 白名单）+ `input_required`（`notify_inputs()`，档位 `notifyInput`=off/blocked/all，默认 blocked 只发 ask/permission；正文 `sess_text()`）；**启动首轮静默播种**（`sweep`，防历史刷屏），键一律播种只把发送门控住（防"事后开启"补发历史）；去重靠 sent.json（保留 2000 条，run 键 `wf_*` 与 session 键 `sess|<id>|<静默起点>` 混存，字典序截断故上限抬高）；macOS 钥匙串导出 CA 解决公司 TLS 代理（`macOS_ca_bundle()`，每日刷新） |
| HTTP 端点 | `web.class H` | API：`/api/runs`（响应含 `projects[]`＝回看窗口内有会话活动的全部项目，项目下拉数据源，`scan.projects_in_window()` 与 `scan()` 同活动度口径） `/api/sessions` `/api/agent` `/api/subagent` `/api/config` `/api/config/save`（含 `notifyInput` 档位，缺省值不改）`/api/config/test`（body `{"kind":"input_required"}` 按等待型发） |

端口优先级：**config.json 的 port > `--port` 参数**；网页改端口保存后服务 `os.execv` 自重启到新端口（PID 不变），响应带 `reloc` 字段由页面自动跳转。

缓存三件套（进程内，勿轻易失效）：`_WF_CACHE`（已完结 run 的 name/phases 永不过期）、`scan_cached(6)`（notify 线程复用 6s 内扫描，省一半全盘 I/O）、前端 `CARDS`/`FULL`。

## 前端不变量（改 frontend/src/*.ts 时必读，改完 `python3 frontend/build.py`）

这些是历史 bug 换来的教训，破坏会复发：

- **按卡 diff 渲染**（`render()`）：完成卡数据冻结 → HTML 串不变 → DOM 不重建，滚动/选中不跳。不许改回整体 innerHTML 重绘。
- **按卡 diff 只有一份实现：`diffPaint(el, store, items, painted)`（30-app，1.2.18 抽取）**——运行卡区与会话卡区（#sess/`SCARDS`）都走它。上面列的身份保持/ref 同步/open·滚动快照恢复等不变量住在这一个函数里；新增卡片区直接复用，勿再复制循环。其抽屉 `data-src="S|proj|sess|agent[#msgId]"` 走 `/api/subagent`（toggle 监听器双容器复用 `onToggle`）。
- **回合分组（1.2.20，会话卡任务区）**：一次真人输入=一个任务=一个独立展示单元——输入行（`.promptline.turnhd`）作组头带步数徽章，该回合步骤行挂在同组 `.tg` 下；**归属只认后端 `step.turn`（`_main_steps` 单点），前端不许再猜边界**。组序按时间戳排序（`turn=''`=尾窗前的孤儿组置顶且组头无锚点须显式措辞；只有输入没有步骤的新回合也自成一组）。组头/步骤抽屉键与分组前完全一致（`<sid>:prompt:<uuid>` / `<sid>:<msgId>`）——FULL 缓存与 open/滚动快照跨升级延续，改分组结构不许改键格式。契约测试 `tests/frontend/test_turn_group.ts`。
- **IN/OUT 抽屉面板构造只有一份：`paneIn`/`paneOut`（20-render）**——正文统一过 `unent→mdLite`（预览与全文同一口径；曾出现"预览不解实体、展开才解"）；等待行/提示词行带 hint/miss 分支的面板是其近亲，改三态标签时同审。`ALERT_ST`（20-render）是仪表 ALERT 计数唯一判定集。
- **空态↔非空态对称清理**：`<p.idle>` 无 data-rid，diffPaint 的按卡清理不认识它——两个区的 render 都必须自己负责（`vis` 恢复时先摘 idle，否则永久残留，1.2.18 修过一次运行卡区）。
- **构建戳自取用 `document.querySelector('meta[name="wfo-ver"]')`**——模板里该 meta **只有 name 没有 id**，`getElementById` 必 null（"部署旧标签页自动刷新 + 版本角标"曾因写法错误静默失效多版，无头桩才暴露；勿回退成 `$('wfo-ver')`）。
- **卡 HTML 字符串禁止内嵌逐秒变化字段**（曾内嵌 `ageSec"Ns 前"` → 每轮 diff 必失配重建 → 展开的 details"点开即关"）：时间一律 `fmtC(epochMs)`，并保留 renderSessions 的 open/滚动快照恢复；步骤/抽屉的稳定键一律用 `message.id`（尾窗滑动不漂移）。
- **渲染转录/子代理文本必须先过 `unent()`**（实体转义竖线 `&#124;`/`&amp;#124;` 不解码则 mdLite 认不出表格、页面露出转义串），再进 `mdLite(wrapLong/pretty(...))`；行内预览不许再用裸 `inlineMd` 渲染可能含块级 md 的内容。
- **outerHTML 后 `ref` 同步**：替换节点若正被 `ref`（insertBefore 锚点）引用，必须指向新节点，否则抛 NotFoundError 打断整轮渲染（曾伪装成"链路中断"）。
- **tick 的 try/catch 分离**：fetch 失败与 render 失败必须分开报告——JS bug 不许冒充掉线（见 `tick()` 注释）。
- **后台节流补偿（1.2.16）**：`setInterval(2s)` 在隐藏标签页会被浏览器降到 ~1 次/分钟（真实反馈："终端输入后切回页面看不到最新执行信息"），`catchUp()` 在 visibilitychange/pageshow/focus 时立即补扫（1s 冷却去重；`auto` 关闭则尊重设置不越权）。新增轮询/刷新驱动不许只挂 setInterval——必须同时有可见性补扫路径，否则节流问题复发。
- **详情抽屉滚动位置 / details 展开态**跨轮询保持（`sc` 快照 + `open` 集合恢复）；全文靠 `FULL` 缓存 + `/api/agent` 首次展开拉取。
- **项目下拉(#fproj)数据源 = `/api/runs` 的 `projects[]`(回看窗口内有会话活动的全部项目,含无 workflow 运行的纯会话项目)∪ runs/sessions 载荷键**——只从 runs∪sessions 推列表会把纯会话项目整个藏掉(真实反馈:「窗口设 180 天,展示的总项目数不对」,1.2.35 修);键一律 `cwd||project` 与过滤判定同源可去重;重建判定比**内容串**(`PSTR`,20-render)不比数量——数量相同集合变化(一进一出)时旧数量判定永久留陈旧选项。契约测试 `tests/frontend/test_proj_list.ts`。
- **筛选/视图状态必须 localStorage 持久化**（`wfo-fproj`/`wfo-fstr`/`wfo-auto`）：项目筛选/搜索词/自动刷新只存内存模块变量 → 刷新(含部署自动 reload)后全丢（真实用户 bug）；启动恢复 + 选项重建带 `selected`，保存值已不在数据源时清空回落。新增筛选字段同理。仪表计数是"视图口径"——过滤/搜索生效时 RUNS 必须显示 `命中/总数` 并挂 title 说明原因（否则用户把被滤掉的运行当成"数据不准"，1.2.14 真实反馈；测试 t4 以 `3/4`+title 断言）。
- **会话等待态（3.2）**：`input_required` 的判定只在后端 `sessions.main_state()` 一处（三分 `waitReason`），前端只做展示与高亮，不许再推断；**告警/安静的显示分级也只有一个判定点 `sessStuck`**（20-render）——ask/permission=真卡住→反白 ⏸ 闪烁告警+色条+计入区标题 ⏸ N；turn=执行完成正常交回→安静青色「回合已完」、无告警视觉（用户据此报过 bug:"关了通知还提示等待输入"——通知档位从来只管推送,页面显示曾把 turn 一律渲染成 ⏸ 才是根因,1.2.13 分档）。卡 HTML 里放的是 `wlab`/`wtxt` 等**每轮稳定**字段，绝不放 `ageSec` 或 `AD()` 毫秒相位（1.2.13 曾给告警徽标加 `AD(1.8)`→冻结数据每轮 diff 失配→"点开即关"复发,测试 `diff/stable` 拦下）。新增等待成因只改 `main_state` + 前端 `wlab`/`sessStuck` + `notify.WAIT_ZH` + i18n 四处，缺一处即出现"页面说等待授权、推送写未知"。
- **提示词回显（1.2.13）**：「什么算用户输入」只在后端 `sessions._user_prompt()` 一处判定（剔除 tool_result/isMeta/`<local-command-*>`/无参命令，`<command-name>/x</command-name>`+`<command-args>` 合成 `/x args`），摘要（`_analyze.prompts`）与全文（`_prompt_detail` 按记录 uuid 反查）共用它，不许前端再过滤；用户记录**没有 message.id**，锚点一律用转录记录 uuid。
- **多语言：新增用户可见文案一律走 `T()`（`frontend/src/05-i18n.ts`）** —— key 就是简体中文原文（源语言，zh 不入字典），插值 `%1..%n`；查不到自动回落 key，所以漏译显示中文而非空白。静态壳文案挂 `data-i18n`（换 textContent）/`data-i18n-ph`（换 placeholder），由 `applyI18n()` 统一刷；`<b>01</b>` 这类编号必须包到内层 `<span>`，否则整块被覆盖。CSS `content:` 里的文案走 `html[lang=x]{--tr-more:…}` 变量（与 JS 字典各一份）。语种存 `localStorage.wfo-lang`（与 `wfo-theme` 同为"视图状态"，**不进服务端 config.json**），首访按 `navigator.language` 猜。切语言必须走 `setLang()`：它清 `CARDS/SCARDS/GSTR` 与旧 `.idle` 节点后整屏重绘，漏清则该语言下 diff 陈旧。后端 `msg` 只做精确命中（`已保存` 等静息文案），含插值数字的校验错回落原文，不为此加模糊匹配。
- `mdLite` 用 \u0001 控制字符做占位符抽取围栏/表格，改动分段逻辑注意转义。

## 开发/验证速查

```bash
python3 tests/run_all.py                 # ★ 回归总入口(改动前基线、部署前门禁;支持关键字过滤与 -v)
python3 tests/run_all.py web_api -v      # 只跑 HTTP 全链路并打印全部断言
UPDATE=1 node tests/frontend/test_render_golden.ts   # 故意改卡 HTML 后重录黄金快照(提交信息须注明)
npm install                                          # 开发机一次性(typescript+@types/node:typecheck 套件与安装器编译;运行时仍零依赖)
python3 frontend/build.py                # 前端:TS→tsc --strict→注入产物(首次自动抽 template.html)
python3 scripts/server.py                # 前台启动（默认 8787，config 优先）
python3 scripts/server.py --stop         # 按 PID 优雅停止
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
