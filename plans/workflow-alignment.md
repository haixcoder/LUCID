# Plan: Lucid 编排器 ↔ Claude Code Workflow 全功能对齐

**PRD:** `docs/workflow-alignment-research.md`（v1.0，2026-09-08；证据基座 Claude Code 2.1.263）
**Created:** 2026-09-08
**Status:** Draft
**Methodology:** Tracer Bullet Development（曳光弹开发模式）
**模式说明:** 本 PRD 本身是技术设计文档，经用户确认采用**契约级 Feature Planning**——保留跨相位锁定的架构契约（草稿 schema 形状、节点/handle 语义、生成物形状、校验规则顺序），不写实现内部分解。
**基线版本:** 1.2.49 → 每相位版本 +1（Phase 1 落到 1.2.50 … Phase 9 落到 1.2.58）

---

## Scope

### In Scope

- **L1 脚本语言面全覆盖**（PRD §2.1、§4 矩阵 #1–#27）：草稿 v2、`whenToUse`、`phases[].detail`、args 契约、`map`(=pipeline)、`branch`/`merge`、`loop`+budget 守卫、agent 选项（effort/agentType/isolation/phase 恒发）、`retry`、`log`、`code`、`subflow`、schema 根形状预校验、确定性/import 禁令扫描。
- **L3/L4 呈现面**（#26、#29–#34）：首次/恢复/分发三条命令区、审批与边界文案、成本/上限预估条、`Large workflow` 红条。
- **语义覆盖率目标 100%**（A∪B∪C 三层表达，PRD §0.4）：图 + 半可视化组合 + `code` 逃生舱；可视化覆盖率随 P4–P6 从 ~45% 升至 ~85%。
- **文档同步**：README.md / README.zh-CN.md 双语、CLAUDE.md 编排器不变量、`docs/xyflow-editor-dev-guide.md` 契约表、`docs/lessons-learned.md`（同类型问题第二次出现时）。

### Out of Scope

- 可视化任意表达式编辑器（不做第二个 JS IDE；条件/items 一律文本框，PRD §4「不做」）
- 可视化 `budget` 动态扩缩（"最详尽答案"是策略不是图）
- 内建调试器、控制面（暂停/停止/恢复执行归终端 `/workflows`；本仓服务不做控制面，PRD §5.6.4）
- 服务写 `.claude/workflows/`（铁律 2；分发只给复制命令；一键分发另立提案）
- `workflow()` 多层嵌套（运行期仅一层）
- `disallowedTools` / `bashCommandClamp` / `stallMs`（无文档化契约）、`isolation:'remote'`（本 build 不可用）
- 运行态查看器新数据面（L2 已由 `runtime-state-deep-research.md` D20–D51 覆盖）
- v1 草稿迁移工具（v1 原样载入即兼容，不需要迁移）

---

## Architectural Decisions

_以下决策已锁定，适用于全部相位；变更任一决策需重评受影响相位。_

### Layer Model（本项目特有，六层）

```
1. Presentation   — 编辑器 DOM（#flow：节点卡 / 检查器 / 阶段带 / 命令区 / 成本条）
2. Routing        — 后端 HTTP（GET /api/drafts、POST /api/draft/save、GET /static/<白名单>）
3. Domain Logic   — 图模型 + 三单点（校验器 / 阶段推导 / 生成器）
4. Execution      — 生成脚本在沙箱内的可执行语义（桩替身真跑，非文本比对）
5. Persistence    — 草稿落盘（draft.v 兼容、目录 slug、原子写）
6. Verification   — 三层测试（run_all 门禁 / 黄金快照 / 真实输入冒烟 / 真机）
```

### AD-1 草稿 schema v2（纯加宽，向后兼容）

```jsonc
{
  "v": 2,
  "name": "audit-routes", "desc": "…", "whenToUse": "…",
  "cwd": "/abs/project",
  "argsSpec": { "schema": { /* JSON Schema */ }, "example": { "paths": ["a.ts"] }, "required": true },
  "phases": [ { "title": "Scan", "detail": "每文件一个审计代理" } ],   // 空数组 = 沿用推导
  "nodes": [
    { "id": "n2", "type": "agent", "position": {"x":300,"y":150},
      "data": { "label": "审计", "phase": "Scan", "prompt": "审计 {{n1}}",
                "model": "", "effort": "", "agentType": "", "isolation": false,
                "schemaText": "{…}", "retry": { "n": 3, "backoffMs": 1000 } } },
    { "id": "n3", "type": "map",     "data": { "items": "ARGS.paths", "prompt": "审计 {{item}}", "label": "audit:{{item}}" } },
    { "id": "n4", "type": "branch",  "data": { "cond": "n3.length === 0" } },
    { "id": "n5", "type": "loop",    "data": { "cond": "dry < 2", "maxRounds": 5, "budgetGuard": true } },
    { "id": "n6", "type": "log",     "data": { "text": "已确认 {{n2}}.length 条" } },
    { "id": "n7", "type": "code",    "data": { "code": "const seen=new Set(); return found.filter(…)", "out": "n7" } },
    { "id": "n8", "type": "subflow", "data": { "ref": "triage-issues", "argsExpr": "{ issues: ARGS.ids }" } },
    { "id": "n9", "type": "return",  "data": { "ret": "{ rows: n3 }" } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "sourceHandle": "out",   "target": "n3", "targetHandle": "in" },
    { "id": "e2", "source": "n4", "sourceHandle": "true",  "target": "n2", "targetHandle": "in" },
    { "id": "e3", "source": "n4", "sourceHandle": "false", "target": "n6", "targetHandle": "in" },
    { "id": "e4", "source": "n5", "sourceHandle": "body",  "target": "n2", "targetHandle": "in" },
    { "id": "e5", "source": "n2", "sourceHandle": "back",  "target": "n5", "targetHandle": "in" }
  ],
  "next": 10, "view": { "x": 20, "y": 10, "zoom": 1 }
}
```

**兼容策略（锁定）：** `v=1` 原样载入（新字段缺省为空）→ 保存写 `v=2`；未知 `v`（如 3）**仍拒绝并提示，不猜**；发号器 `next` 沿用"只前进不回退"。`draft.v` 判定必须两端同改：后端落盘校验 + 前端载入校验（两处当前都硬拒 `v!==1`）。

### AD-2 节点型与 handle 语义（锁定）

| 型 | 入 | 出 handle | 语义 |
|---|---|---|---|
| `start` | — | `out` | args 入口（`Q` 兜底保留） |
| `agent` | `in` | `out` | 一次 `agent()` |
| `map` | `in` | `out` | `pipeline` 入口；下游线性链 = 各级 |
| `branch` | `in` | `true` / `false` | 两区域须汇于同一 `merge`（或各自到 `return`） |
| `loop` | `in` | `body` / `out` | body 区域单入口单出口；回边 `back` 回 `loop` |
| `merge` | `in`×2 | `out` | 分支汇合点（显式声明） |
| `log` | `in` | `out` | `log()` |
| `code` | `in` | `out` | 任意 JS 片段，返回值绑定节点 id |
| `subflow` | `in` | `out` | `workflow(name \| {scriptPath}, args)` |
| `return` | `in` | — | `return` 表达式 |

**handle 与 DOM 契约不变**：`nodeHTML`/`handleHTML` 仍是唯一实现，`data-id = ${FLOW_ID}-${nodeId}-${handleId}-${type}`，新 handle 只增加 handleId 取值（`true`/`false`/`body`/`back`），不新增拼法。

### AD-3 区域规则（结构化约束，校验器强制）

1. 循环体 = 从 `loop.body` 可达、且能到达 `back` 源点的节点集合；**只有一个外部入口**且出口只有 `back`。违反 → `循环体不是单入口单出口区域`。
2. 分支区域 = `true`/`false` 各自可达集，**不相交**，且都终止于同一 `merge`（或 `return`）。违反 → `分支区域不合法`。
3. 环**只允许**由 `loop` 回边构成；不在任何 `loop` 区域内的环照旧报错。
4. `map` 下游每级 = 单个 `agent` 节点，或"扇出 → 汇于同一 `merge`"区域（生成 `() => parallel([…])` 回调，官方 `review-changes` 范式）；级内嵌套 `map`/`loop` → 报错（走 `code` 节点）。

### AD-4 生成物映射契约（每型一段，语义等价可审计）

```js
export const meta = { name, description, whenToUse, phases: [{ title, detail }] }

// args 契约（有 argsSpec 时）
const ARGS = (typeof args === 'string') ? JSON.parse(args) : args
if (!ARGS || typeof ARGS.paths === 'undefined') throw new Error('需要 args {paths:[…]}')

// start
const Q = (typeof ARGS === 'string' && ARGS.trim()) || ARGS ?? '<start.note>'

// agent（单点）
const n2 = await agent(`审计 ${n1}`, { label:'审计', phase:'Scan', model:'sonnet', effort:'low',
                                       agentType:'code-reviewer', isolation:'worktree', schema: SCHEMA_n2 })

// 并行层（现状不变）
const [n3, n4] = await parallel([() => agent(…), () => agent(…)])

// map（= pipeline，无栅栏；单节点级 / 扇出级两种回调形态）
const n5 = await pipeline(ARGS.paths, (item, _all, i) => agent(`审计 ${item} #${i}`, { label:`audit:${item}`, phase:'Scan' }))
const n6 = await pipeline(n5, r => parallel(['correctness','security','perf'].map(lens =>
  () => agent(`用 ${lens} 视角复核 ${r.path}`, { label:`verify:${r.path}:${lens}`, phase:'Verify', schema: VERDICT }))))

// branch
let n6
if (n3.length === 0) { n6 = await agent(…) } else { n6 = await agent(…) }

// loop（+ budget 守卫）
let n7 = [], round = 0, dry = 0
while (dry < 2 && round < 5) {
  if (budget.total && budget.remaining() < 50000) { log('预算将尽,提前收束'); break }
  round++
  /* body */
}

// retry（生成一次助手，形状取自官方 scan.js）
async function $retry(prompt, opts, n, backoffMs) {
  let r = await agent(prompt, opts)
  for (let k = 0; k < n && !r; k++) {
    const label = (opts.label || 'agent') + ':retry' + (k + 1)
    log(`${label} 失败,${backoffMs * 2 ** k}ms 后重试`)
    await new Promise(res => setTimeout(res, backoffMs * 2 ** k))
    r = await agent(prompt, { ...opts, label })
  }
  return r
}

// log / code / subflow
log(`已确认 ${n2.length} 条`)
const n8 = await (async () => { /* code 原文 */ })()
const n9 = await workflow('triage-issues', { issues: ARGS.ids })
```

**语义等价判据（锁定）：** 生成脚本必须能进桩替身沙箱真跑，断言 ① 调用序列 ② 每次调用参数 ③ 返回值。**不是文本比对。**

### AD-5 校验器规则顺序（锁定）

结构 → 区域 → 引用 → 载荷。新增规则并入同一次 `flowValidate` 调用，不新增第二个校验入口。规则清单见 PRD §5.4；`code` 节点的确定性扫描须跳过字符串/注释（小扫描器），命中但无法判定 → 降级为警告。

### AD-6 单点纪律（铁律 8 的相位级落实）

- 既有三口径 `flowValidate` / `flowMetaPhases` / `flowGenerate` 仍是唯一实现，新能力一律并入，禁止旁路。
- **新增口径必须单点**：区域分析（循环/分支可达集）、代理数估算（`agent` 数 × 所在 loop 的 `maxRounds`）、未知全局扫描、沙箱桩替身跑器（从 `test_flow_editor.ts` 抽取为共享助手，禁止第二份）。
- 每个新单点落地时**先枚举全部消费者**（UI 展示 / 生成器 / 测试），同相位一起改。

### AD-7 三层表达边界（不撒谎）

- A 结构层（可视化）：DAG + 阶段带 + 扇出/扇入。
- B 组合层（半可视化）：`map`/`branch`/`loop`/`retry`/`log`/`subflow`。
- C 代码层（逃生舱）：`code` 节点，唯一会引入"幻觉 API"的地方 → 必须有 `CODE` 徽章 + 未知全局警告。
- 表达式一律文本框；能做的是**结构**，不是语法。

### AD-8 写边界（铁律 2/3）

服务唯一可写目录 = `~/.claude/cc-viewer/`（草稿落 `drafts/`）。分发到 `.claude/workflows/` 只给**复制命令**，在用户终端执行；执行/恢复/停止永远在用户终端，服务不做控制面。

### AD-9 版本、构建与提交

- 每相位：`python3 frontend/build.py` → `python3 tests/run_all.py` 全绿 → `.claude-plugin/plugin.json` 与 `package.json` 版本 +1（parity 由 `tests/test_packaging.py` 钉死）→ 一个 commit（信息含相位号与测试结果）。
- `scripts/ccviewer/static/index.html` 是构建产物，禁止手改；改 `static` 产物后必须重启服务（`INDEX_HTML` 是 import 期读的）。
- 部署顺序固定：先杀旧 guard → `server.py --stop` → 新副本起 server → 新路径起 `guard.py --detach`。

### AD-10 测试策略

- **L1 专项**：生成器语义用桩替身真跑（新增 `tests/frontend/test_flowgen_*.ts`，沿用 `harness.ts` 加载真实编译产物）；DOM 契约走 `nodeHTML`/`handleHTML` 单点选择器断言；**新 handle 的真实拖拽一律进 `tests/browser/test_*_real.ts`**（合成事件给假绿灯，1.2.47 已实证）。
- **L2 冒烟**：`python3 tests/run_all.py`（16 个 Python 套件 + typecheck + 12 个前端套件 + 2 个真实输入套件全绿）。
- **L3 回归**：黄金快照逐字节零漂移（编辑器不在采样区，但主视图必须一致）；v1 草稿夹具载入生成物零 diff；`?flowsmoke=1` 既有十断言不回归；打包版本一致；`/api/runs` 响应结构不变。

---

## Phases

### Phase 1: 草稿 v2 骨架与 meta 扩展 [SKELETON] [HITL] — Size: S

**Depends on:** —
**Approval:** [HITL] — 骨架证明"纯加宽 + 双端兼容"这一架构赌注，需人审后再铺开后续 8 个相位。

> **Tracer bullet:** 在头部填「何时用」、在阶段带编辑标题与说明 → 保存为 v2 草稿 → 刷新页面回载 → 生成脚本带 `meta.whenToUse` 与 `phases[{title,detail}]` → 桩替身沙箱跑通 → 复制命令在终端执行。

**Stories/AC covered:** PRD §5.1（schema v2）、§5.5（阶段带可编辑）、§6 X6；矩阵 **#2、#3、#4**（回归锚点：#1、#5、#6、#7、#23）

**End-to-end flow:**
1. **User does:** 打开编排器（选中具体项目）→ 头部输入 `whenToUse` → 阶段带编辑 `title`/`detail` → 点保存
2. **System does:** 前端组装 `draft.v=2`；后端 `save_draft` 接受 `v∈{1,2}`，原子落盘 `.json` + `.js`
3. **User sees:** 保存成功提示 + 草稿下拉出现该草稿；刷新后重新选中，字段逐字还原
4. **Data:** `~/.claude/cc-viewer/drafts/<slug>/<name>.json`（含 `v:2`）+ 同名 `.js`（生成物）
5. **Test:** 桩替身执行生成脚本断言 `meta` 形状与 `phase()` 序列；v1 夹具零 diff；黄金零漂移

**Architectural touchpoints:**
- **Routes:** `POST /api/draft/save`（接受 `v:2`）、`GET /api/drafts`（透传 v2）
- **Models:** `draft.v=2` 加宽（`whenToUse`、`phases[{title,detail}]`）；`FlowNodeData` 预留后续相位字段
- **Services:** 三单点 `flowValidate`/`flowMetaPhases`/`flowGenerate`；后端 `save_draft`/`list_drafts`
- **Contracts consumed:** AD-1 草稿 v2 形状、AD-2 `start`/`agent`/`return` 既有 handle
- **Contracts produced:** `draft.v=2` 的持久化与载入契约；`meta.whenToUse`、`meta.phases[{title,detail}]` 生成契约

**Acceptance criteria:**
- [ ] 载入既有 v1 草稿（7 节点 demo）后，生成脚本与载入前逐字节一致（零改动兼容）
- [ ] 保存后 `.json` 的 `v` 为 2，且含 `whenToUse` 与 `phases[{title,detail}]`
- [ ] 刷新页面 → 选中草稿 → 头部 `whenToUse`、阶段带 `title`/`detail` 逐字还原
- [ ] 阶段带留空时仍按 `phase||label` 首现去重（既有口径 `flowMetaPhases` 不变）
- [ ] 生成脚本的 `meta.whenToUse` / `meta.phases[].detail` 与 UI 逐字一致
- [ ] 桩替身沙箱执行：`meta` 为纯字面量、`phase()` 序列与阶段带顺序一致
- [ ] 载入 `v:3` 草稿被拒绝并给出可读提示（不猜、不降级）
- [ ] 后端拒绝路径覆盖：`v` 缺失/非整数/未知值各返回 `ok:false` 且不落盘
- [ ] `python3 tests/run_all.py` 全绿；黄金快照逐字节一致
- [ ] 安装副本 == 源码，页面 `ver` == `/api/runs` 的 `ver`（真机冒烟）

**Test plan:**
- **L1 (Specialized):** `node tests/frontend/test_flowgen_meta.ts`（新增：v2 字段生成 + 桩替身执行）；`python3 tests/run_all.py draft`（v2 接受 / v1 兼容 / v:3 拒绝）；`node tests/frontend/test_flow_editor.ts`（阶段带显式优先 + 回载）
- **L2 (Smoke):** `python3 tests/run_all.py` — 16 Python + typecheck + 前端 + 2 真实输入套件全绿
- **L3 (Regression):** `node tests/frontend/test_render_golden.ts` 黄金逐字节；v1 夹具载入生成物零 diff；`?flowsmoke=1` 十断言；`python3 tests/test_packaging.py` 版本 parity

**Risks:**
- **Data:** v2 加宽同时触及后端落盘校验与前端载入校验两处拒绝逻辑，漏一处即"存了却看不见"（1.2.35 类事故）。缓解：`draft.v` 判定单点 + 双端用例 + 真机回载。

---

### Phase 2: args 契约与 JSON Schema 根形状预校验 [AFK] — Size: S

**Depends on:** Phase 1
**Approval:** [AFK] — 沿用既有面板/校验/生成三单点模式，AC 全部可自动断言。
**Can parallel with:** Phase 3、Phase 7

> **Tracer bullet:** 在 args 面板声明 `{paths: string[]}` 与示例 → 生成前置校验块 → 缺参时脚本抛可读错误、传参时跑通。

**Stories/AC covered:** PRD §5.1 `argsSpec`、§5.3 args 契约、§5.4 规则 3、§5.5 args 面板；矩阵 **#20、#9**

**End-to-end flow:**
1. **User does:** 在 args 面板填 JSON Schema、示例 JSON、勾必填；给 agent 节点填 schema
2. **System does:** 面板内联校验 JSON 合法性 + 根形状；生成 `ARGS` 解析与前置校验块
3. **User sees:** 非法 JSON 时面板内联报错且不生成；合法时右侧脚本出现解析与校验块
4. **Data:** `argsSpec` 随草稿 v2 落盘（Phase 1 契约）
5. **Test:** 桩替身分别以对象与字符串化 args 跑两次，断言同一调用序列

**Architectural touchpoints:**
- **Routes:** 无新增（复用 `POST /api/draft/save`）
- **Models:** `argsSpec{schema, example, required}`
- **Services:** `flowValidate` 载荷规则（JSON Schema 根形状单点）；`flowGenerate` args 段
- **Contracts consumed:** AD-1 `argsSpec`、AD-4 args 契约段
- **Contracts produced:** args 面板字段形状；schema 根形状校验规则（`agent.schema` 与 `argsSpec.schema` 共用）

**Acceptance criteria:**
- [ ] args 面板支持 Schema 文本 + 示例 JSON + 必填开关；非法 JSON 内联报错且 `flowValidate` 返回错误
- [ ] 生成脚本含 `const ARGS = (typeof args === 'string') ? JSON.parse(args) : args`
- [ ] 必填开启时生成前置校验块，缺失字段抛错且错误信息含**缺失字段名**
- [ ] `schemaText` 根不是 `{type:'object', properties}` → 报错；`required ⊄ properties` → 报错
- [ ] `argsSpec.schema` 与 `agent.schema` 走**同一**根形状校验单点（测试断言两者共用）
- [ ] 桩替身执行：合法 args 对象与字符串化 JSON 得到相同调用序列
- [ ] `python3 tests/run_all.py` 全绿；黄金零漂移

**Test plan:**
- **L1:** `node tests/frontend/test_flowgen_args.ts`（新增：解析块/校验块/桩替身双向）；`node tests/frontend/test_flow_editor.ts`（面板校验 RED 用例）；`python3 tests/run_all.py draft`（载荷校验拒绝路径）
- **L2:** `python3 tests/run_all.py`
- **L3:** 黄金逐字节；既有 schema 常量生成（`const SCHEMA_x`）不变；`?flowsmoke=1` `gen` 断言

**Risks:**
- **Data:** args 是脚本唯一外部输入，schema 过松/过紧都只在运行期暴露。缓解：生成物前置校验 + 桩替身双向断言。

---

### Phase 3: 运行与分发通道（命令区 + 边界文案） [AFK] — Size: S

**Depends on:** Phase 1
**Approval:** [AFK] — 纯呈现层，文案与命令串可自动断言。

> **Tracer bullet:** 保存草稿后右侧命令区同时给出首次运行、恢复运行、分发三条命令，并标注"服务不写盘、执行在终端"的边界。

**Stories/AC covered:** PRD §2.3 调用面、§2.4 分发面、§5.5 运行区、§5.6.3/4；矩阵 **#29、#30、#31、#32、#34、#26**

**End-to-end flow:**
1. **User does:** 保存草稿后查看命令区，点复制
2. **System does:** 拼出首次/恢复/分发三条命令（含绝对 scriptPath 与示例 args）
3. **User sees:** 三条命令可一键复制，附边界说明（终端执行、恢复需同会话、脚本只编排不读写文件）
4. **Data:** 无新增落盘（命令由草稿路径派生）
5. **Test:** 文案断言命令串含 scriptPath 与草稿名、不含任何写 `.claude/workflows/` 的动作

**Architectural touchpoints:**
- **Routes:** 无新增
- **Models:** 无新增图模型字段——命令由 `draft.cwd`/`name` 与保存返回的绝对路径派生
- **Services:** 命令拼装单点（三种形态共用一处）
- **Contracts consumed:** Phase 1 草稿保存返回的绝对路径
- **Contracts produced:** 命令区三种形态文案契约（`scriptPath` / `scriptPath+resumeFromRunId` / `cp` 分发）

**Acceptance criteria:**
- [ ] 首次命令为 `Workflow({scriptPath: '<绝对路径>', args: <示例>})`
- [ ] 恢复命令附 `resumeFromRunId: 'wf_…'` 占位，并注明"仅同会话、恢复前先停旧 run"
- [ ] 分发命令给出项目（`.claude/workflows/`）与个人（`~/.claude/workflows/`）两处 `cp` 目标
- [ ] 三条命令一键复制成功（复用既有 `copyText`）
- [ ] 文案明确：服务只写 `~/.claude/cc-viewer/`；执行/恢复/停止在终端 `/workflows`
- [ ] 断言：三条命令串均不含任何写 `.claude/workflows/` 的自动化动作
- [ ] 新增文案全部走 `T()`，切语言后命令区与帮助文案同步刷新（`flowRelang` 覆盖）
- [ ] `python3 tests/run_all.py` 全绿；黄金零漂移

**Test plan:**
- **L1:** `node tests/frontend/test_flow_editor.ts`（命令区三形态 + 文案断言）；`node tests/frontend/test_i18n.ts`（新 key 五语种齐全）
- **L2:** `python3 tests/run_all.py`
- **L3:** 黄金逐字节；`?flowsmoke=1` 十断言；铁律 2 复核（无新增写路径）

**Risks:**
- 无显著风险——纯呈现层，沿用既有命令区与复制通道。

---

### Phase 4: `map` 节点 = `pipeline`（含扇出级） [AFK] — Size: M

**Depends on:** Phase 1、Phase 2
**Approval:** [AFK] — 语义等价由桩替身到达顺序断言机械验证。
**Can parallel with:** Phase 5、Phase 7

> **Tracer bullet:** 建 `map` 节点（items 表达式 + 回调模板）→ 下游级（单节点或扇出→汇合）→ 生成无栅栏 `pipeline`，桩替身断言条目 A 的 stage2 早于条目 B 的 stage1。

**Stories/AC covered:** PRD §5.2 规则 4、§5.3 map 段、§4.1（`pipeline` 优先级最高）；矩阵 **#15、#14**

**End-to-end flow:**
1. **User does:** 拖入 `map` 节点，填 items 表达式与 `{{item}}`/`{{index}}` 模板；下游接一级或多级
2. **System does:** 校验级形态（单节点级 / 扇出→同一 merge 级）；生成 `pipeline(items, 回调…)`
3. **User sees:** 右侧脚本出现 `await pipeline(…)`；无栅栏语义在生成物中可读
4. **Data:** `map` 节点随草稿 v2 落盘
5. **Test:** 桩替身记录各条目各级到达顺序，断言无栅栏与失败条目落 `null`

**Architectural touchpoints:**
- **Routes:** 无新增
- **Models:** `map` 节点型（`items` 表达式、回调 `prompt`/`label` 模板）
- **Services:** 级形态判定单点（单节点级 vs 扇出级）；`flowGenerate` pipeline 段
- **Contracts consumed:** AD-2 `map` handle、AD-3 规则 4、AD-4 map 段
- **Contracts produced:** 级形态判定单点（单节点级 vs 扇出级）；`parallel` 显式扇出视觉提示

**Acceptance criteria:**
- [ ] `map` 节点新增：`items` 表达式、回调 `prompt`/`label` 模板（支持 `{{item}}`/`{{index}}`）
- [ ] 下游线性链每级生成一个回调；级内"扇出→同一 `merge`"生成 `() => parallel([…])` 回调
- [ ] 桩替身断言**无栅栏**：条目 A 的 stage2 早于条目 B 的 stage1（带延迟桩记录到达顺序）
- [ ] 桩替身断言某级抛错 → 该条目落 `null` 且跳过后续级，其余条目不受影响
- [ ] 级内嵌套 `map`/`loop` → 校验报错并提示改用 `code` 节点
- [ ] `items` 为 `ARGS.x` 时与 Phase 2 args 契约协同（传参跑通）
- [ ] 既有"层内多 agent → `parallel` 栅栏"生成物逐字节不变
- [ ] `python3 tests/run_all.py` 全绿；黄金零漂移；`?flowsmoke` 新增 `map-gen` 断言

**Test plan:**
- **L1:** `node tests/frontend/test_flowgen_pipeline.ts`（新增：无栅栏到达顺序 + 失败落 null + 两种级形态）；`node tests/frontend/test_flow_editor.ts`（map 节点 DOM 契约 + 级内嵌套拒绝）
- **L2:** `python3 tests/run_all.py`
- **L3:** 既有 parallel 生成断言零变化；黄金逐字节；`?flowsmoke=1` 十断言 + 新断言

**Risks:**
- **Architecture（High）：** 无栅栏 `pipeline` 与当前"按层 `parallel` 栅栏"的生成模型根本不同，若映射错，图与脚本语义会静默分叉。缓解：桩替身到达顺序断言 + 与官方 `review-changes` 范式同构。
- **Data（Medium）：** items 来源有 args 与上游结果两种，需统一表达式命名空间。缓解：单一表达式文本框 + 变量名解析复用既有 `{{nX}}` 单点。

---

### Phase 5: `branch` + `merge` [AFK] — Size: M

**Depends on:** Phase 1
**Approval:** [AFK] — 区域规则有最小正反例，生成物由桩替身双分支验证。
**Can parallel with:** Phase 4、Phase 7

> **Tracer bullet:** 拖出 `true`/`false` 两条边 → 两区域各建链 → 汇于同一 `merge` → 生成 if/else，桩替身断言只走一支且 merge 处变量可见。

**Stories/AC covered:** PRD §5.2 规则 2、§5.3 branch 段；矩阵 **#16**

**End-to-end flow:**
1. **User does:** 拖入 `branch` 节点，填条件表达式；两分支各接链，汇于 `merge`
2. **System does:** 区域校验（可达集不相交、同终止点）；生成 `let <id>; if (cond) {…} else {…}`
3. **User sees:** 生成物为可读 if/else；非法区域给出可读错误
4. **Data:** `branch`/`merge` 节点随草稿 v2 落盘
5. **Test:** 桩替身 cond 真/假各跑一次，断言只调用对应分支 agent

**Architectural touchpoints:**
- **Routes:** 无新增
- **Models:** `branch`/`merge` 节点型（`cond` 表达式、双入 handle）
- **Services:** 区域分析单点（可达集计算，Phase 6 共用）
- **Contracts consumed:** AD-2 `branch`/`merge` handle、AD-3 规则 2
- **Contracts produced:** 区域分析单点（可达集计算，Phase 6 共用）

**Acceptance criteria:**
- [ ] `branch` 节点两个出 handle（`true`/`false`），`merge` 两个入 handle；DOM 契约走 `nodeHTML`/`handleHTML` 单点
- [ ] 区域规则 2 正例通过、反例（可达集相交 / 终止点不同）报可读错误
- [ ] 生成 `let <id>; if (cond) { … } else { … }`，条件为文本表达式
- [ ] 桩替身：cond 真/假各跑一次，只调用对应分支的 agent，`merge` 处变量可见
- [ ] 分支各自到 `return`（无 `merge`）的合法形态被接受
- [ ] 真实输入冒烟：`tests/browser/test_branch_real.ts` 用 CDP 拖出 `true`/`false` 两条边并断言建边成功
- [ ] `python3 tests/run_all.py` 全绿；黄金零漂移

**Test plan:**
- **L1:** `node tests/frontend/test_flowgen_branch.ts`（新增：双分支执行 + 区域正反例）；`node tests/browser/test_branch_real.ts`（真实 handle 拖拽）
- **L2:** `python3 tests/run_all.py`
- **L3:** 既有 `out`/`in` handle 选择器与 `data-id` 拼法不变（`contract-C3C4C5` 断言）；黄金逐字节

**Risks:**
- **Architecture（Medium）：** 区域分析（可达集/不相交/同终止点）易写错，写错的代价是生成物语义静默错误。缓解：只支持结构化区域、显式报错不猜、最小正反例。
- **UX（Medium）：** 双出 handle 的视觉区分度（颜色/标签）影响可读性。缓解：handle 标签直写 `true`/`false`，区域底色沿用 AD-2 表达。

---

### Phase 6: `loop` + budget 守卫 + 成本/上限预估条 [AFK] — Size: M

**Depends on:** Phase 5（共用区域分析单点）
**Approval:** [AFK] — 循环上界与提前 break 两条路径由桩替身机械验证。
**Can parallel with:** Phase 4、Phase 7

> **Tracer bullet:** 建 `loop` 节点（条件 + `maxRounds` + 可选 budget 守卫）+ 回边成环 → 生成 `while` 上界 → 桩替身断言跑满与提前 break 两条；成本条显示代理数×上界，≥25 变红。

**Stories/AC covered:** PRD §5.2 规则 1/3、§5.3 loop 段、§5.4 规则 5/7、§5.5 成本条；矩阵 **#17、#21、#28、#33**

**End-to-end flow:**
1. **User does:** 拖入 `loop`，填条件与 `maxRounds`，勾 budget 守卫；body 内接链，回边连回 `loop`
2. **System does:** 区域校验（单入口单出口）；生成 `while (cond && round < maxRounds)` 与预算守卫断点；计算成本条
3. **User sees:** 生成物含上界与守卫；成本条显示 `◆代理数 · 并发≤16 · 循环上界 · 预算守卫`，超阈值变红
4. **Data:** `loop` 节点与 `maxRounds` 随草稿 v2 落盘
5. **Test:** 桩替身两条路径（跑满 / 预算不足 break）+ 成本条口径断言

**Architectural touchpoints:**
- **Routes:** 无新增
- **Models:** `loop` 节点型（`cond`/`maxRounds`/`budgetGuard`）与 `back` 回边
- **Services:** 区域分析单点复用；代理数估算单点；`flowGenerate` while 段
- **Contracts consumed:** AD-2 `loop` handle、AD-3 规则 1/3、AD-4 loop 段
- **Contracts produced:** 代理数估算单点（`agent` 数 × 所在 loop `maxRounds`）；预算守卫生成契约

**Acceptance criteria:**
- [ ] `loop` 节点含 `cond` 表达式、`maxRounds`（必填 ≥1，缺省 1）、`budgetGuard` 开关、`back` 回边
- [ ] 区域规则 1 正例通过、反例（多入口 / 出口不止 `back`）报可读错误
- [ ] 非 `loop` 回边构成的环仍报错（既有环检测不放松）
- [ ] 生成 `while (cond && round < maxRounds) { … }`；守卫开启时生成 `if (budget.total && budget.remaining() < N) { log(…); break }`
- [ ] 桩替身两条：跑满 `maxRounds` 退出；预算桩返回不足时提前 `break` 且 `log` 文案出现
- [ ] 成本条：`◆代理数 · 并发≤16 · 循环上界 · 预算守卫`；估算口径单点；≥25 时红条（对齐 `Large workflow` 阈值）
- [ ] 真实输入冒烟：`tests/browser/test_loop_real.ts` 拖出回边并断言建边成功
- [ ] `python3 tests/run_all.py` 全绿；黄金零漂移

**Test plan:**
- **L1:** `node tests/frontend/test_flowgen_loop.ts`（新增：跑满 / break / 区域正反例）；`node tests/browser/test_loop_real.ts`（回边真实拖拽）；`node tests/frontend/test_flow_editor.ts`（成本条口径）
- **L2:** `python3 tests/run_all.py`
- **L3:** 既有环检测（DAG 拒绝）对非 loop 环仍报错；黄金逐字节；`?flowsmoke=1` 十断言

**Risks:**
- **Architecture（High）：** 环 + 区域分析 + 变量作用域（body 内变量在循环外的可见性）三者叠加，最易产生"能生成但语义错"。缓解：结构化区域 + 桩替身两条路径 + 生成物预览人工可读。
- **Data（Medium）：** 代理数估算引入新口径，若与运行期实际并发/总数上限脱节会误导成本预期。缓解：估算单点 + 界面上写明"估算值、并发上限 16、单次运行代理总数上限 1000"。

---

### Phase 7: agent 选项 + `retry` + `log` [AFK] — Size: M

**Depends on:** Phase 1
**Approval:** [AFK] — 选项落 opts 与重试退避序列均由桩替身断言。
**Can parallel with:** Phase 4、Phase 5

> **Tracer bullet:** 检查器给出 effort/agentType/isolation → 落到生成 opts；勾选 retry → 生成一次 `$retry` 助手；`log` 节点生成 `log()`；桩替身断言失败→退避→成功。

**Stories/AC covered:** PRD §2.1.3、§2.1.4（重试是脚本层模式）、§5.3 retry/log 段；矩阵 **#8、#10、#11、#12、#13、#18、#19**

**End-to-end flow:**
1. **User does:** 在检查器选 effort 档位、agentType、isolation 开关；给 agent 勾 retry{n,backoffMs}；拖入 `log` 节点填模板
2. **System does:** 生成 opts 字段；按需生成一次 `$retry` 助手；`log` 节点生成 `log(\`…\`)`
3. **User sees:** 生成物中 opts 与助手可读；重试日志走 `log()` 而非静默
4. **Data:** 选项与 `retry` 随草稿 v2 落盘
5. **Test:** 桩替身：第一次返回 `null` → 断言 `retry 1/N` 日志与 1x/2x/4x 退避 → 最终成功；耗尽后返回 `null`

**Architectural touchpoints:**
- **Routes:** 无新增
- **Models:** `agent.data` 新字段（`effort`/`agentType`/`isolation`/`retry`）、`log` 节点型
- **Services:** `$retry` 助手生成单点（全图一次）；opts 拼装单点
- **Contracts consumed:** AD-1 `agent.data` 新字段、AD-4 retry/log 段
- **Contracts produced:** agentType 枚举只读通道；`$retry` 助手生成契约（全图只生成一次）

**Acceptance criteria:**
- [ ] 检查器：effort 五档下拉（`low|medium|high|xhigh|max`）、agentType 下拉（枚举 `~/.claude/agents` + 插件 agents，允许自由文本回落）、isolation 开关（带"贵/仅并行改文件时用"提示）
- [ ] `agent({phase})` 在单节点与并行层**都**发出（当前仅并行层）
- [ ] model 白名单与真实模型 id 对齐（`claude-*` 正则 + 常用别名），非法值报错
- [ ] `$retry` 助手全图只生成一次；形状与官方 `scan.js` 同构（`log` + 指数退避 `setTimeout`）
- [ ] 桩替身：首次返回 `null` → 日志含 `retry 1/N`、退避序列 1x/2x/4x → 最终返回结果；耗尽后返回 `null`
- [ ] `log` 节点生成 `log(\`…\`)`，`{{nX}}` 占位解析正确
- [ ] `python3 tests/run_all.py` 全绿；黄金零漂移

**Test plan:**
- **L1:** `node tests/frontend/test_flowgen_retry.ts`（新增：重试成功/耗尽/退避序列）；`node tests/frontend/test_flow_editor.ts`（选项落 opts + phase 恒发 + agentType 枚举）
- **L2:** `python3 tests/run_all.py`
- **L3:** 未勾选选项时生成物与 Phase 1 基线逐字节一致（默认路径不漂移）；黄金逐字节

**Risks:**
- **UX（Medium）：** agentType 下拉枚举跨本机与插件两个来源，空/重复/命名空间前缀（`plugin:agent`）需处理。缓解：只读枚举 + 自由文本回落 + 去重。
- **Architecture（Medium）：** `retry` 包裹后 `label` 变化会影响 `/workflows` 分组与 resume 缓存键。缓解：助手标签规则固定为 `label:retryN`，与官方脚本同形。

---

### Phase 8: `code` + `subflow` + 载荷/引用校验 [AFK] — Size: L

**Depends on:** Phase 1
**Approval:** [AFK] — 校验规则每条一正一反，执行语义由桩替身断言。
**Can parallel with:** Phase 4、Phase 5、Phase 7

> **Tracer bullet:** 拖入 `code` 节点写片段 → 生成器原样插入并绑定返回值 → 非法 `import(`/`Date.now()` 被校验拦下；`subflow` 引用已保存工作流 → 生成 `workflow(...)`，二层嵌套报错。

**Stories/AC covered:** PRD §2.1.4、§5.2 节点表、§5.3 log/code/subflow 段、§5.4 规则 1/2/2b/4；矩阵 **#27、#22、#24、#25**

**End-to-end flow:**
1. **User does:** 拖入 `code` 节点写 JS 片段；拖入 `subflow` 选引用名或填 scriptPath 与 args 表达式
2. **System does:** 确定性/import/未知全局扫描 + 引用与深度校验；生成器原样插入 code 段、生成 `workflow(...)`
3. **User sees:** `CODE` 徽章 + "此段不参与可视化语义"提示；违规项在错误区逐条列出
4. **Data:** `code`/`subflow` 节点随草稿 v2 落盘
5. **Test:** 桩替身断言 code 返回值被下游引用、`workflow(name, args)` 调用参数正确

**Architectural touchpoints:**
- **Routes:** 无新增
- **Models:** `code` 节点型（`code` 片段 + `out` 绑定）、`subflow` 节点型（`ref`/`argsExpr`）
- **Services:** 确定性扫描单点（跳过字符串/注释）；未知全局白名单；引用与深度校验
- **Contracts consumed:** AD-2 `code`/`subflow`、AD-4 code/subflow 段、AD-5 规则顺序
- **Contracts produced:** 确定性扫描器（跳过字符串/注释）；未知全局白名单；子流引用与深度校验

**Acceptance criteria:**
- [ ] `code` 节点：等宽编辑区 + `CODE` 徽章 + "不参与可视化语义"提示；返回值绑定节点 id
- [ ] 校验：片段含 `import(` → 错误（运行前即失败）
- [ ] 校验：`Date.now()` / `Math.random()` / `new Date()` 命中且**不在字符串/注释里** → 错误；无法判定 → 警告（降级不误杀）
- [ ] 未知全局提示：既不在脚本白名单（`agent/parallel/pipeline/phase/log/budget/workflow/args`）也不在片段内声明/JS 内建 → 警告
- [ ] `subflow` 节点：`ref` 支持已保存名与 `{scriptPath}`；指向不存在的草稿 → 错误；子流内再 `subflow` → 错误
- [ ] 桩替身：code 片段返回值被下游引用；`workflow(name, args)` 参数正确
- [ ] 生成物仍不含 `Date.now()/Math.random()`（既有沙箱禁令断言保持）
- [ ] `python3 tests/run_all.py` 全绿；黄金零漂移

**Test plan:**
- **L1:** `node tests/frontend/test_flowgen_code.ts` + `node tests/frontend/test_flowgen_subflow.ts`（新增：执行语义 + 每条校验正反例）；`node tests/frontend/test_flow_editor.ts`（CODE 徽章与节点 DOM 契约）
- **L2:** `python3 tests/run_all.py`
- **L3:** 既有沙箱禁令断言不放松；黄金逐字节；`?flowsmoke=1` 十断言

**Risks:**
- **Architecture（Medium）：** `code` 片段是唯一会引入"幻觉 API"的地方（本机首次真实运行即死在 `ReferenceError: agents is not defined`）。缓解：未知全局警告 + `CODE` 徽章 + 生成物预览高亮该段。
- **Integration（Medium）：** `subflow` 引用另一草稿时，草稿被改名/删除会让引用悬空。缓解：引用校验在每次生成前执行，错误显式列出而非静默跳过。
- **Data（Medium）：** `code` 片段不参与区域分析，若片段内含控制流跳转（如提前 `return`）会破坏生成器的变量绑定假设。缓解：片段包裹在 `await (async () => { … })()` 内，绑定在闭包返回值上。

**Size L 说明:** 两个新节点型 + 三组校验规则同属 PRD §6 X11 卡；拆开会让 `code` 与 `subflow` 各自的校验规则落两次改动，故保持一张卡。

---

### Phase 9: 真实运行端到端验收 + 文档同步 [HITL] — Size: M

**Depends on:** Phase 1–8
**Approval:** [HITL] — 需在用户终端真跑工作流（消耗 token），且文档定稿需人审。

> **Tracer bullet:** 用一份含 `map`+`branch`+`loop`+`retry`+`log`+`code`+`subflow` 的夹具草稿生成脚本 → 终端真跑 → 查看器显示运行与阶段 → README 双语 + CLAUDE.md + dev-guide 同步。

**Stories/AC covered:** PRD §6 X12、§7 端到端行、§4.1（四种调用形态）；矩阵 **#29/#30 实测复核 + 全矩阵回归**

**End-to-end flow:**
1. **User does:** 在编辑器画一份全节点型夹具图 → 保存 → 按命令区在终端执行 `Workflow({scriptPath, args})`
2. **System does:** Claude Code 沙箱执行生成脚本；本仓查看器消费 `wf_*.json` 与 `journal.jsonl`
3. **User sees:** 终端 `/workflows` 阶段树与编辑器阶段带一致；查看器页面显示该运行
4. **Data:** 运行产物落 `~/.claude/projects/<proj>/<sess>/workflows/`（只读消费）
5. **Test:** 真机闭环 + `resumeFromRunId` 恢复命中缓存（`durationMs≈0`、`totalTokens=0`）

**Architectural touchpoints:**
- **Routes:** `/api/runs`、`/api/sessions`（只读消费，结构不变）
- **Models:** 全节点型夹具草稿（覆盖 AD-1 全字段）
- **Services:** 无新增服务；只读消费 `/api/runs`、`/api/sessions`
- **Contracts consumed:** 全部 AD-1…AD-10
- **Contracts produced:** 端到端验收报告（夹具草稿 + 运行 runId + 阶段对照）

**Acceptance criteria:**
- [ ] 全节点型夹具草稿生成脚本在真终端跑通；`/workflows` 阶段树与编辑器阶段带一致
- [ ] 查看器 `/api/runs` 显示该运行，runId/阶段/代理计数与终端一致
- [ ] `resumeFromRunId` 恢复命令实测命中缓存（全部代理 `cached:true`、`totalTokens=0`）
- [ ] 分发命令实测：复制到 `.claude/workflows/` 后该工作流可按名调用
- [ ] README.md 与 README.zh-CN.md 双语同步（新能力 + 命令区 + 边界说明），互链完整
- [ ] CLAUDE.md 编排器不变量更新（新节点型单点、区域规则、成本估算单点、新 handle）
- [ ] `docs/xyflow-editor-dev-guide.md` 补新节点型契约行与测试映射
- [ ] `claude plugin validate .` 通过；`python3 tests/run_all.py` 全绿；`?flowsmoke=1` 全断言通过
- [ ] 部署顺序按 dev-guide §9：杀旧 guard → 停 server → 新副本起 server → 新路径起 guard，两条 pid 路径版本一致
- [ ] 安装副本 == 源码；页面 `ver` == `/api/runs` 的 `ver`

**Test plan:**
- **L1:** 真机闭环（终端 `Workflow({scriptPath, args})` + 恢复命令）；`?flowsmoke=1` 全断言；`node tests/browser/test_connect_real.ts` 与 `test_drag_real.ts` 回归
- **L2:** `python3 tests/run_all.py`
- **L3:** `/api/runs`、`/api/sessions` 响应结构不变；黄金逐字节；`tests/test_packaging.py` 版本 parity；安装副本与源码 diff 为空

**Risks:**
- **Integration（High）：** 真实运行是本计划的最终判据，任何"桩替身绿、真机红"的语义偏差在此暴露（1.2.47 连线事故的同类）。缓解：桩替身与真实运行**双证据**，夹具覆盖全部节点型。
- **Data（Medium）：** 真跑消耗 token 且依赖用户终端，无法在 CI 复现。缓解：夹具规模压到最小（每型一个代理），并保留 runId 供复核。

---

## Coverage Map

| PRD ID / 矩阵行 | Phase | 覆盖方式 |
|---|---|---|
| #1 `meta.name`/`description` | Phase 1 | 既有，L3 回归锚点 |
| #2 `meta.whenToUse` | Phase 1 | 头部输入 + 生成 `whenToUse` |
| #3 `meta.phases[].title` | Phase 1 | 阶段带可显式编辑，空则沿用推导 |
| #4 `meta.phases[].detail` | Phase 1 | 阶段带第二行 |
| #5 `phase(title)` | Phase 1 | 既有，L3 回归锚点 |
| #6 `agent(prompt)` | Phase 1 | 既有，L3 回归锚点 |
| #7 `agent({label})` | Phase 1 | 既有，L3 回归锚点 |
| #8 `agent({phase})` | Phase 7 | 单节点与并行层都发出 |
| #9 `agent({schema})` 根形状 | Phase 2 | 与 `argsSpec.schema` 共用校验单点 |
| #10 `agent({model})` | Phase 7 | 白名单对齐真实模型 id |
| #11 `agent({effort})` | Phase 7 | 五档下拉 → opts |
| #12 `agent({agentType})` | Phase 7 | 枚举下拉 + 自由文本回落 |
| #13 `agent({isolation})` | Phase 7 | 开关 + 成本提示 |
| #14 `parallel(thunks)` | Phase 4 | 既有；显式扇出视觉提示 |
| #15 `pipeline(items, …)` | Phase 4 | `map` 节点 + 级形态判定 |
| #16 `if/else` | Phase 5 | `branch` + `merge` |
| #17 `while` | Phase 6 | `loop` + `maxRounds` + 回边 |
| #18 重试 | Phase 7 | `$retry` 助手（脚本层模式） |
| #19 `log()` | Phase 7 | `log` 节点 |
| #20 `args` 全局 | Phase 2 | args 面板 + 前置校验块 |
| #21 `budget` | Phase 6 | loop 预算守卫（只发形状，不依赖运行期值） |
| #22 `workflow()` 子流 | Phase 8 | `subflow` 节点 + 深度校验 |
| #23 `return` 值 | Phase 1 | 既有，L3 回归锚点 |
| #24 确定性禁令 | Phase 8 | `code` 片段扫描（跳过字符串/注释） |
| #25 禁 `import()` | Phase 8 | `code` 校验 |
| #26 无 fs/Node API | Phase 3 | 边界文案 |
| #27 任意 JS 编排 | Phase 8 | `code` 节点 |
| #28 并发/条目/总数上限 | Phase 6 | 成本条 + 界面写明上限 |
| #29 `resumeFromRunId` | Phase 3 | 恢复命令；Phase 9 实测复核 |
| #30 工具入参 `name`/`script` | Phase 3 | 命令区三形态 |
| #31 审批/权限 | Phase 3 | 预检提示文案 |
| #32 分发 | Phase 3 | `cp` 命令（项目/个人） |
| #33 `Large workflow` 告警 | Phase 6 | 成本条 ≥25 红条 |
| #34 前缀错峰/缓存 TTL | Phase 3 | 帮助文案 |

未映射项：无。PRD §4「不做」清单与 §8 风险清单见 Out of Scope 与 Risk Summary。

---

## Dependency Graph

```
Phase 1 (Skeleton · 草稿 v2 骨架) [HITL]
  ├── Phase 2 (args 契约) ── Phase 4 (map/pipeline) ──┐
  ├── Phase 3 (运行/分发通道)                          │
  ├── Phase 5 (branch/merge) ── Phase 6 (loop+成本条) ─┤
  ├── Phase 7 (agent 选项+retry/log) ──────────────────┤
  └── Phase 8 (code+subflow+校验) ─────────────────────┤
                                                       └── Phase 9 (真机端到端+文档) [HITL]

Critical path: 1 → 2 → 4 → 5 → 6 → 9
可并行组: {3, 4, 5, 7, 8}（均在 Phase 1 后；4 需 2）
```

---

## Risk Summary

| Risk | Severity | Mitigation | Phase |
|---|---|---|---|
| 无栅栏 `pipeline` 与既有"按层 parallel 栅栏"生成模型根本不同，映射错会静默分叉语义 | 🔴 High | 桩替身到达顺序断言 + 官方 `review-changes` 范式同构 | Phase 4 |
| 环 + 区域分析 + 变量作用域叠加，可能"能生成但语义错" | 🔴 High | 结构化区域 + 桩替身两条路径 + 生成物可读预览 | Phase 6 |
| 桩替身绿而真机红（1.2.47 同类） | 🔴 High | 桩替身与真实运行双证据，夹具覆盖全部节点型 | Phase 9 |
| v2 加宽漏改一端拒绝逻辑 → "存了却看不见" | 🟡 Medium | `draft.v` 判定单点 + 双端用例 + 真机回载 | Phase 1 |
| 区域分析（可达集/不相交/同终止点）写错 | 🟡 Medium | 只支持结构化区域、显式报错不猜、最小正反例 | Phase 5 |
| `code` 片段引入幻觉 API（本机已实证一次） | 🟡 Medium | 未知全局警告 + `CODE` 徽章 + 预览高亮 | Phase 8 |
| 代理数估算口径与运行期实际上限脱节 | 🟡 Medium | 估算单点 + 界面写明上限与"估算值" | Phase 6 |

---

## Cross-Cutting Concerns

| Concern | How It's Addressed |
|---|---|
| **版本与提交** | 每相位 `plugin.json` 与 `package.json` 同时 +1（1.2.50→1.2.58），一个相位一个 commit，提交信息含相位号与测试结果 |
| **构建** | 每相位 `python3 frontend/build.py`；`static/index.html` 禁手改；改产物后重启服务 |
| **i18n** | 新增用户可见文案一律走 `T()`；静态壳走 `data-i18n`/`data-i18n-ph`；动态节点卡/下拉/状态行靠 `flowRelang()`（`setLang` 已调用） |
| **黄金零漂移** | 编辑器不在黄金采样区，但主视图必须逐字节一致；故意改文案才 `UPDATE=1` 并注明 |
| **单点纪律（铁律 8）** | 新口径（区域分析 / 代理数估算 / 未知全局扫描 / 桩替身跑器）各自单点；落地时枚举全部消费者一起改 |
| **写边界（铁律 2/3）** | 服务只写 `~/.claude/cc-viewer/`；分发=复制命令；执行/恢复/停止在终端 |
| **只读数据源** | 运行态数据（`wf_*.json`/`journal.jsonl`）只读消费，不新增写路径 |
| **真机冒烟** | `?flowsmoke=1` 每新增节点型加一条断言；交互类（新 handle 拖拽）进 `tests/browser/test_*_real.ts` |
| **性能** | 生成/校验为纯前端纯函数，规模 ≤ 数百节点；不做增量优化（反过度工程） |
| **安全** | 草稿 name/cwd 消毒沿用后端单点；无新增外部输入面；`code` 节点不改变沙箱权限模型 |
| **可访问性** | 沿用既有键盘路径（Enter/Space 建节点、Del 删除、Cmd+S 保存）；新检查器字段保持 Tab 可达 |
| **文档** | README 双语互链、CLAUDE.md 编排器不变量、dev-guide 契约表、lessons-learned（同类问题第二次出现时补） |

---

## Execution Tracking (Post-Approval)

- 每相位：实现 → 三层测试 → 勾选 AC → 版本 +1 → commit（提交信息含相位号与测试结论）。
- 每相位完成后向 `plans/.history/workflow-alignment.progress.md` 追加：完成相位、偏离计划之处、影响后续相位的发现、执行中的决策。
- 上下文丢失（`/clear`、崩溃、压缩）后：先读本计划 + progress 日志，勾选框 + 日志 = 当前位置。
- `[HITL]` 相位（Phase 1、Phase 9）必须停下等人审，不得由 agent 静默完成。
