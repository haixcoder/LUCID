

> 审查日期：2026-09-18 · 被测版本：`lucid@1.2.62`（marketplace `kw-dev-plugins`，仓库 `haixcoder/LUCID`）
> 被测实例：`http://127.0.0.1:8787/`（本机常驻服务，pid 14341，`scripts/server.py`）
> 审查方式：浏览器真机实测（Playwright 无头 Chromium 1600×1000 / 390×844）+ 源码对照 + 服务端日志与接口计时

---

## 一、结论先行

**lucid 的架构与工程质量明显高于同类工具，但「显示层」存在一批高可见度、低修复成本的硬伤，且「实时性」这一核心卖点并未按自家 ROADMAP 落地。**

- **最该先修的一条**：页面主表格 `step · output` 列大量显示 `(tool-call step)` 占位符，agent 输出的 Markdown（`**`、`##`、反引号、表格）全部原样暴露 —— 实测正文含 **308 个 `**`、420 个反引号、63 行表格竖线**。这是用户盯着看的主区域，信息密度被严重稀释。
- **第二该修**：顶部仪表 `RUNS / TASKS / LIVE / DONE / ALERT` **硬编码英文**，切到中文/法文界面也不翻译（源码写死，非字典缺失）；同时 `0 LIVE` 与同屏 `活跃 8` 词义冲突。
- **第三该修**：2 秒轮询每次都做全盘 I/O 扫描 —— 后端**已有** `scan_cached()` 缓存函数，但 HTTP 路径**没调用**；实测 `/api/sessions` 单次 **0.49s**、**393KB**，`/api/runs` **465KB**，且**无 gzip、HTTP/1.0 无 keep-alive**，合计算力与带宽每秒约 **429KB**。
- **工程卫生**：服务端日志 **1115 行中约 86% 是客户端断连产生的 Python traceback**（37 次 `BrokenPipeError` + 16 次 `ConnectionResetError`），真实故障被淹没。
- **与自家 ROADMAP 的差距**：ROADMAP 标 ⭐ 的三项（成本面板、hooks 即时事件源、MCP server）**全部未落地**；其中 `/api/poke` 端点在代码中**根本不存在**，意味着"轮询→事件驱动"的架构升级一步未走。

**总体判断**：显示层缺陷多为「一个函数/一处 `T()` 包裹」级别的小改动，收益/成本比极高；性能与实时性问题则需要按 ROADMAP 的 S0 计划推进。建议按下方第四章的优先级表执行。

---

## 二、实测环境

| 项 | 值 |
|---|---|
| 插件版本 | 1.2.62（市场最新同为 1.2.62，已安装即最新） |
| 缓存旧版 | 1.2.43（标记 `.orphaned_at`，未清理） |
| 服务进程 | `python3 .../1.2.62/scripts/server.py`，监听 `127.0.0.1:8787` |
| 工作目录 | `/Users/3KMR46N/projectDir/axis` |
| 数据规模（实测时刻） | 18 runs / 137 tasks / 51 sessions（其中 alive 8） |
| 通知配置 | `~/.claude/cc-viewer/config.json`：`enabled=false, url=""`（未启用，非插件缺陷） |
| 页面渲染规模 | DOM **20,590 节点**，页面总高 **53,657 px**，正文 **187,191 字符** |

> 说明：`config.json` 中 `enabled=false` 属用户未配置，不计入缺陷。

---

## 三、缺陷清单

### A. 显示层

#### A1 【P0】agent 输出的 Markdown 完全不渲染

- **现象**：`last output` 行与步骤详情里，`**加粗**`、`## 标题`、`` `代码` ``、`| 表格 |` 全部以原始符号显示。
- **证据**：
  - 实测页面正文统计：`**` 出现 **308 次**，反引号 **420 次**，含 ≥3 个 `|` 的表格行 **63 行**。
  - 截图 `/tmp/lucid_shots/01_initial.png`：`**讲稿上限 = 3,240 字**` 原样带星号。
  - 截图 `/tmp/lucid_shots/08_runs.png`：`## 汇总: SDK 无需发布,已是最新 **v2.4.5 已于 0…`、`不是"执行了 497 次任务"——是**后端全量测试套件里共…`
- **影响**：页面最核心的内容区（agent 的结论/汇总）可读性差，星号噪声淹没正文。对中文用户尤其明显（Markdown 惯用 `**` 强调）。

#### A2 【P0】`step · output` 列被 `(tool-call step)` 占位符填满

- **现象**：主表格中最主要的 `step · output` 列，大量行显示 `(tool-call step)`，实际内容（工具名）落在旁边的 `tools` 列，导致该列信息量为零。
- **证据**：截图 `08_runs.png` 单屏内出现 6 次以上；`frontend/src/05-i18n.ts:108` 定义 `'(工具调用步)': '(tool-call step)'`。
- **影响**：页面视觉重心（最大的列）承载零信息，用户被迫横向扫到 `tools` 列才能理解发生了什么。建议改为在 output 列直接给出工具入参摘要（如 `Bash: git log --oneline -8`）。

#### A3 【P0】顶部仪表 5 个标签硬编码英文，不随语言切换

- **现象**：切到 `zh` / `fr` 后，`RUNS / TASKS / LIVE / DONE / ALERT` 仍为英文。
- **证据**（源码直证，非字典缺失）：
  ```ts
  // frontend/src/30-app.ts:179-183
  ...<span>RUNS</span></div>
  <div class="g"><b>${tHit}...</b><span>TASKS</span></div>
  <div class="g lv"><b>${n(r => r.status === 'running')}</b><span>LIVE</span></div>
  <div class="g ok"><b>${n(r => r.status === 'completed')}</b><span>DONE</span></div>
  <div class="g er"><b>${n(r => ALERT_ST.has(r.status))}</b><span>ALERT</span></div>
  ```
  五个标签均未包裹 `T()`。实测截图 `06_lang_chinese.png`、`07_empty_search.png` 中 `lang="zh"` / `lang="fr"` 时依旧英文。
- **影响**：插件宣称"五语种界面"，但页面**最显眼**的区域不翻译，与产品描述直接冲突。

#### A4 【P0】会话行在过滤态下自相矛盾：`会话 0 · 活跃 8`

- **现象**：搜索无命中时，分区标题显示 `sessions (principal + sous) 0 · actives 8`。
- **根因**（源码直证）：
  ```ts
  // frontend/src/30-app.ts:149
  const vis = sess.filter(sessHit), live = sess.filter(s => s.alive).length, waiting = vis.filter(sessStuck).length;
  tt.innerHTML = `${T('AGENT 状态 · 会话(主+子)')} ${vis.length}${live ? ' · ' + T('活跃') + ' ' + live : ''}...`;
  ```
  `vis` 走 `sessHit` 过滤，`live` 却用**未过滤**的 `sess`，同一行里三个数字两套口径。
- **旁证**：同一文件 `30-app.ts:170-172` 的注释明确记录过同类事故并已修 —— *"用户真实报过:只见 3 RUNS 不知还有第 4 个被筛掉"* —— 仪表盘改成了「命中/总数」，**会话行漏改**。
- **影响**：数字互斥，用户无法判断真实会话数；且这正是历史上已被用户投诉过的同类问题复发。

#### A5 【P1】`LIVE` 与 `活跃` 同屏词义冲突

- **现象**：顶栏 `0 LIVE`，同屏下方 `活跃 8`，再下方卡片徽标 `RUNNING`。
- **根因**：两者统计对象不同 —— `LIVE` 数的是 **run**（`r.status === 'running'`），`活跃` 数的是**会话**（`s.alive`）。实测：18 个 run 中 running = 0，51 个 session 中 alive = 8，两者数字都对。
- **加剧因素**：CSS 类 `.card` 被 run 卡（`20-render.ts:12`，判 `r.live`）与 session 卡（`20-render.ts:154`，判 `r.alive`）**共用**，两者都渲染成 `class="card live"`，视觉上无法区分。
- **影响**：用户看到"标着 RUNNING 的卡片"却被告知 `0 LIVE`，会直接判定"计数坏了"。术语层应拆分为 `RUNNING`(run) / `ACTIVE`(session) 或合并为单一指标。

#### A6 【P1】同一状态两个名字：仪表 `ALERT` vs 卡片 `FAILED`

- **证据**：`20-render.ts:49` `ALERT_ST = new Set(['failed','error','stale','aborted','killed','timeout'])`，仪表显示 `ALERT 3`，卡片徽标显示 `FAILED`。实测 run 状态分布 `{completed:15, failed:3}` 与仪表 `DONE 15 / ALERT 3` 一致。
- **影响**：用户需要在脑中做一次 `ALERT ⇄ FAILED` 映射，且 `ALERT` 听起来像"告警"而非"失败"。

#### A7 【P1】项目下拉出现未解码的目录名，且排序错位

- **现象**：下拉首项为 `-Users-3KMR46N-projectDir-myLinux`，其余为正常绝对路径（`/Users/3KMR46N/Downloads/0914/defense` …）。
- **根因**（源码直证）：
  ```python
  # scripts/ccviewer/scan.py:62-66
  def session_cwd(proj_dir, sess_id):
      for d in iter_records(...):
          if d.get('cwd'): return d['cwd']
      return proj_dir          # ← 回退成 ~/.claude/projects 的编码目录名
  ```
  转录前 5 条记录无 `cwd` 时，直接把编码目录名当展示名返回。
- **影响**：同一列表两套命名体系；编码名不可读；`-` 开头导致排序被顶到最前（实测 `/api/runs` 返回的 15 个项目中它排第 1）。

#### A8 【P1】移动端横向溢出，顶部指标被裁切

- **证据**：390×844 视口下 `scrollWidth = 702` vs `clientWidth = 390` → 出现横向滚动条；截图 `05_mobile.png` 中顶栏 `3 ALER` 被右边缘切断，会话行 `sessions (main + sub) 51 · live 8` 也被切。
- **根因**：全站仅 5 处 `@media`，最窄断点为 `640px`，**没有手机档布局**（`frontend/template.html:91,208,219,392,399`）。
- **影响**：手机/窄分屏下不可用。若产品定位是"本机桌面看板"可降级为不修，但应在 README 注明。

#### A9 【P1】断连时旧数据无「陈旧」标记

- **证据**：Playwright 拦截全部 `/api/**` 后，顶栏变为 `⚠ link down — reconnecting`，但下方 **187,495 字符**旧内容**原样保留**，无"最后更新于 XX:XX"提示。
- **对照**：run 级其实已有 `stale` 概念（`20-render.ts:49`），页面级缺失。
- **影响**：用户会把过期快照当实时数据做判断 —— 对"监控看板"是原则性缺陷。

#### A10 【P2】可访问性缺失

- **实测**：`aria-label` = **0**，`aria-live` = **0**，`role` = **0**，`h1` = **0**（页面仅有 `h2`）。
- **键盘路径**：69 张卡 × 每卡数十行 `details/summary`（原生可聚焦）全在 Tab 序列里，键盘用户需数百次 Tab 才能穿过页面。
- **默认语言**：`<html lang="en">`，中文用户首次打开即为英文界面。

#### A11 【P2】长文本硬截断，截断处无统一省略提示

- **证据**：截图 `08_runs.png`：`结论: **最新版 v2.4.5 已于 09-10 发布完成,无需…`、`谜底解开了——**没有需要发布的东西,最新 SDK 已经发…`。列宽固定，中英混排处还会把 `qwen3.8-flash` 折成两行，`last activity` 列头也折成 `last` / `activity` 两行。
- **影响**：布局观感不整齐；被截断的内容需展开才可见，但截断本身没有提供 hover 全文。

#### A12 【P2】i18n 字典缺 1 个键，5 种语言全部回落原文

- **证据**：`40-flow.ts:105` 与 `:113` 调用 `T('label / phase')`，但 `05-i18n.ts` 中**无此键**（grep 零命中）→ 五种语言下均显示原始 key `label / phase`。
- **量化**：实测字典 217 个键、源码 `T()` 调用去重 134 个，缺失 **1** 个。覆盖率很高，属漏网。
- **附带发现**：A3 的 5 个仪表标签**不在**这 134 个调用里（根本没走 `T()`），所以**用字典覆盖率检查抓不到 A3** —— 需单独做"硬编码文案扫描"。

---

### B. 功能层

#### B1 【P0】Compose（可视化编排）入口不可发现

- **现象**：未选中具体项目时 `#btnFlow` 为 `hidden`（实测 `display: none`）。
- **源码**：
  ```ts
  // frontend/src/40-flow.ts:745-750
  function syncFlowEntry(): void {
    const b = $<HTMLElement>('btnFlow'); if (!b) return;
    const on = flowCanCompose(fproj);
    b.hidden = !on;
    b.title = on ? T('对选中项目「%1」编排 Workflow…') : T('先在上方选一个具体项目,才能编排 Workflow');
  }
  ```
- **问题**：引导文案写在 `title`（tooltip）上，而按钮已 `hidden` —— **tooltip 永远不会被看到**。新用户没有任何路径知道"选了项目就会出现编排入口"。
- **影响**：这是插件宣传的差异化能力（拖节点连线 → 生成脚本 → 保存草稿），却处于"零可发现性"状态。

#### B2 【P0】2 秒轮询每次全盘扫描，已有缓存函数却未接入 HTTP 路径

- **证据**（源码直证）：
  ```python
  # scripts/ccviewer/web.py:211-216
  if u.path == '/api/runs':
      self._json({... 'runs': scan(), ...})          # ← 未缓存版本
  elif u.path == '/api/sessions':
      self._json({'now': time.time(), 'sessions': scan_sessions()})   # ← 未缓存版本
  ```
  而 `scan_cached(maxage)`（`scan.py:292`）、`scan_sessions_cached(maxage)`（`sessions.py:733`）**已实现**，却只被通知线程使用（`notify.py:181` 调 `scan_cached(6)`）。
- **实测开销**：

  | 接口 | 响应体 | 耗时（3–5 次） |
  |---|---|---|
  | `/api/runs` | **465,632 B** | 0.038 – 0.088 s |
  | `/api/sessions` | **392,783 B** | **0.487 – 0.542 s** |
  | `/`（首屏 HTML） | 301,414 B | 0.003 s |

- **影响**：每 2 秒传输约 **858 KB** JSON（≈ 429 KB/s），`/api/sessions` 单次接近 500ms（占 2s 周期的 25%）。多开标签页时并发扫描叠加，且 `_scan_cache` 是**无锁全局单槽**，存在竞态。

#### B3 【P1】无 gzip 压缩 + HTTP/1.0 无 keep-alive

- **证据**：
  - 带 `Accept-Encoding: gzip, deflate, br` 请求 `/` 与 `/api/sessions`，响应头**均无 `Content-Encoding`** → 301 KB / 393 KB 明文传输。
  - 响应行为 `HTTP/1.0 200 OK`；`web.py:329` 用 `ThreadingHTTPServer` 但**未设 `protocol_version`**，默认 HTTP/1.0 → 无 keep-alive。
- **影响**：在 2 秒轮询节奏下，每轮新建 2 个 TCP 连接、传输未压缩大包。

#### B4 【P1】ROADMAP 三项 ⭐ 能力全部未落地

| ROADMAP 条目 | 计划 | 实际 |
|---|---|---|
| 3.1 成本面板（⭐ 首推） | 复用 `sessions.py` 四字段 + 定价表 → `COST` 仪表 | **未实现**：前端 `grep -rn "COST\|成本"` 仅命中编排器的预估条注释，无成本仪表 |
| 3.3 hooks 即时事件源（⭐ 架构升级点） | `PostToolUse(Workflow)` → `POST /api/poke`，2s → <100ms | **未实现**：`hooks/hooks.json` 仅有 `SessionStart` 启动 guard；后端 **`/api/poke` 端点不存在**（全仓 grep 零命中） |
| 3.4 插件捆绑 MCP server | `list_runs` / `run_detail` / `search_runs` / `cost_summary` | **未实现** |
| 3.6 Timeline / 甘特视图 | phase 时间轴 | **未实现** |
| S2 URL 深链 `?proj=&run=` | 筛选态进 URL | **未实现** |

- **影响**：ROADMAP 自我认定"2s 轮询 → 事件驱动"是架构升级点，目前**一步未走**；B2 的扫描开销因此无法通过缓存之外的路径缓解。成本面板被标为"首推"，是社区验证过的刚需，缺口最明显。

#### B5 【P2】`?flowsmoke=1` 自检代码留在生产包内

- **证据**：`frontend/src/40-flow.ts:754-761`，作者注释说明"留在生产代码里"的理由（无头桩给不出真实布局）。
- **评估**：属**有意取舍**且有注释交代，但生产包内含仅用于自检的合成事件代码，会增大体积与攻击面。建议改为构建期剔除。

---

### C. 数据 / 性能层

#### C1 【P0】服务端日志被客户端断连 traceback 淹没

- **证据**：`~/.claude/cc-viewer/server.log` 共 **1115 行**，其中：
  - `BrokenPipeError: [Errno 32] Broken pipe` — **37 次**
  - `ConnectionResetError: [Errno 54] Connection reset by peer` — **16 次**
  - 每次都是约 18 行的完整 Python 堆栈 → 约 **86% 的日志行是断连噪声**
- **抛出点**：`scripts/ccviewer/web.py:207` `self.wfile.write(body)`，未捕获客户端断开。
- **触发条件**：页面刷新、关标签、切换端口 —— 对 2 秒轮询的看板而言是**高频常态**。
- **影响**：日志中除两条 `lucid 服务已自动启动` 外**没有任何有效业务信息**；真实故障无法从日志定位。

#### C2 【P1】全量渲染无虚拟滚动

- **实测**：DOM **20,590 节点**，页面总高 **53,657 px**，正文 **187,191 字符**，一次铺开全部 run 与 session 内容。
- **缓解现状**：代码已用 `diffPaint` 做按卡 diff（`30-app.ts`），避免整页重建 —— 这是好的工程实践。
- **残留问题**：节点基数过大本身即为瓶颈，长列表滚动与首屏渲染都会退化；且 A10 的键盘路径问题直接源于此。

#### C3 【P1】`web.py` 是测试最薄弱的模块，恰是 C1/B2 的所在

- **实测引用数**（被多少个测试文件引用）：`sessions.py` 13、`jsonl.py` 12、`config.py` 10、`agent.py` 10、`scan.py` 9、`notify.py` 4、**`web.py` 仅 2**。
- **相关性**：本报告的两个服务端缺陷（C1 断连 traceback、B2 未走缓存）都落在 `web.py` 的 `_json()` / `do_GET()`，即覆盖最薄的模块。这不是巧合 —— 缺测试的地方就是缺陷堆积的地方。
- **建议**：为 `web.py` 补 `test_web_api.py` 用例：客户端提前断开时无异常抛出、`/api/runs` 与 `/api/sessions` 命中缓存、响应头含 gzip。

#### C4 【P2】缓存旧版本未清理

- `~/.claude/plugins/cache/kw-dev-plugins/lucid/1.2.43` 仍带 `.orphaned_at` 标记占用磁盘，无自动回收。

---

## 四、优先级与修复建议

| 优先级 | 编号 | 问题 | 建议动作 | 预估成本 |
|---|---|---|---|---|
| **P0** | A1 | Markdown 不渲染 | 引入轻量行内渲染（粗体/代码/标题），或至少剥离 `**` 与 `` ` `` 符号 | 小 |
| **P0** | A2 | `(tool-call step)` 占位 | output 列直接填工具名 + 入参摘要 | 小 |
| **P0** | A3 | 仪表标签硬编码 | 5 处 `<span>` 包 `T()`，字典补 5 语言词条 | 极小 |
| **P0** | A4 | 会话行口径矛盾 | `live` 改用 `vis.filter(s => s.alive)`，与 `30-app.ts:170` 的「命中/总数」口径统一 | 极小 |
| **P0** | B1 | Compose 入口不可发现 | 常显按钮 + 置灰态 + 内联提示"请先选择项目"，替代 `hidden` | 小 |
| **P0** | B2 | 轮询全盘扫描 | `web.py` 改调 `scan_cached()/scan_sessions_cached()`，maxage 取 1–2s | 小 |
| **P0** | C1 | 日志被断连淹没 | `_json()` 内 `try/except (BrokenPipeError, ConnectionResetError)` 静默返回 | 极小 |
| **P1** | A5/A6 | 术语冲突 | 拆分 RUNNING(run) / ACTIVE(session)；`ALERT` 统一为 `FAILED` | 小 |
| **P1** | A7 | 项目名未解码 | `session_cwd()` 回退时把 `-` 还原为 `/`，或标注"(cwd 未知)" | 小 |
| **P1** | A9 | 无陈旧标记 | 顶栏加"最后更新 HH:MM:SS"，断连超 N 秒后给数据区加降透明度/蒙层 | 小 |
| **P1** | B3 | 无 gzip / HTTP/1.0 | 设 `protocol_version = 'HTTP/1.1'` + 按 `Accept-Encoding` 走 gzip | 中 |
| **P1** | B4 | ROADMAP 缺口 | 按 ROADMAP 顺序推进：成本面板 → hooks `/api/poke` → MCP | 大 |
| **P1** | C2 | 全量渲染 | 长列表虚拟滚动，或默认折叠仅渲染首屏 | 中 |
| **P2** | A8 | 移动端溢出 | 补 `max-width:640px` 断点，或 README 注明仅桌面 | 中 |
| **P2** | A10 | 可访问性 | 补 `h1`、`aria-live`（状态区）、`aria-label`（图标按钮） | 小 |
| **P2** | A11 | 硬截断 | 截断处统一 `…` + `title` 全文 | 小 |
| **P2** | B5/C3 | 生产自检代码 / 旧版残留 | 构建期剔除 smoke 代码；清理 orphan 缓存 | 小 |

**建议执行顺序**：先做「极小成本 × 高可见度」的一批（A3、A4、C1、A2），一次提交即可显著改善观感与日志可用性；再做 A1/A9/B1/B2；最后按 ROADMAP 推进 B4。

---

## 五、值得肯定的部分

审查中发现以下设计明显优于同类工具，建议保持：

1. **零运行时依赖**：Python3 stdlib 单进程，仅绑定 `127.0.0.1`，只读本地文件源，无数据库无构建步骤。
2. **按卡 diff 渲染**：`diffPaint` 对稳定卡片不重建，滚动/选中/hover 不跳动 —— 直接解决了"执行中页面漂移"的经典问题，注释中还记录了根因。
3. **空状态完善**：`NO MATCH · 无匹配运行，调整搜索或筛选` / `TELEMETRY SILENT · 近 N 天无 workflow 运行记录` 两种空态分得很清（实测搜索无命中时正确显示）。
4. **断连有降级提示**：`⚠ link down — reconnecting`，且代码注释明确区分"链路中断"与"渲染异常"，不让 JS bug 伪装成掉线。
5. **回归测试入库**：`tests/run_all.py` 覆盖后端 fixture + 真起服务的 HTTP 全链路 + 前端无头 DOM 桩/黄金快照。
6. **主题系统**：四主题（Daylight / Phosphor night / Icefield / Matrix 系）实测切换均正常。
7. **ROADMAP 质量**：对标了官方 hooks/statusline/MCP 能力与 3 个社区同类项目，附出处链接，并明确列出"不做"的边界（不监听 0.0.0.0、不写 `~/.claude/projects`、不引第三方运行时依赖）。这份文档本身是资产。

---

## 六、复现方法（附录）

```bash
# 1. 打开页面（服务已常驻）
open http://127.0.0.1:8787/

# 2. 接口开销实测
curl -s -o /dev/null -w "runs: %{time_total}s %{size_download}B\n" http://127.0.0.1:8787/api/runs
curl -s -o /dev/null -w "sessions: %{time_total}s %{size_download}B\n" http://127.0.0.1:8787/api/sessions

# 3. 压缩与协议
curl -s -D- -o /dev/null -H "Accept-Encoding: gzip" http://127.0.0.1:8787/api/sessions | head

# 4. 日志噪声
grep -c BrokenPipeError ~/.claude/cc-viewer/server.log     # → 37
grep -c ConnectionResetError ~/.claude/cc-viewer/server.log # → 16

# 5. 源码直证
P=~/.claude/plugins/cache/kw-dev-plugins/lucid/1.2.62
sed -n '179,183p' $P/frontend/src/30-app.ts     # 仪表标签硬编码
sed -n '149p'     $P/frontend/src/30-app.ts     # live 未过滤
sed -n '62,66p'   $P/scripts/ccviewer/scan.py   # 项目名回退
sed -n '211,216p' $P/scripts/ccviewer/web.py    # scan() 未走缓存
sed -n '745,750p' $P/frontend/src/40-flow.ts    # Compose 入口 hidden
```

浏览器实测脚本与截图证据已归档到本目录 `evidence/`：

| 文件 | 用途 |
|---|---|
| `evidence/lucid_recon.py` | 首屏渲染、控件清单、控制台错误、API 响应结构 |
| `evidence/lucid_interact.py` | 设置面板、主题切换、窄屏响应式 |
| `evidence/lucid_i18n.py` | 语言切换、搜索空态、状态分布 |
| `evidence/01_initial.png` | 首屏全貌（可见 `0 LIVE`、`**` 未渲染、`(tool-call step)`） |
| `evidence/02_settings.png` | 设置面板（正常渲染，含语言/主题/端口/回看窗口） |
| `evidence/05_mobile.png` | 390px 移动端（`3 ALER` 被裁切 + 横向溢出） |
| `evidence/06_lang_chinese.png` / `06_lang_french.png` | 中文/法文界面下仪表仍为英文 |
| `evidence/07_empty_search.png` | 搜索无命中：`会话 0 · 活跃 8` 矛盾态 |
| `evidence/08_runs.png` | run 卡详情（Markdown 原文、占位符、硬截断、列头折行） |

> 注：截图拍摄于 2026-09-18 16:11–16:25，数据随本机会话变化，数值以文中标注的实测时刻为准。

