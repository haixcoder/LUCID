# Progress — workflow-alignment（执行日志）

> 计划：`plans/workflow-alignment.md` ｜ 每相位一条：完成相位 / 偏离 / 影响后续的发现 / 执行中的决策。
> 上下文丢失后：读计划 + 本文件 = 当前位置。

## Phase 1 · 草稿 v2 骨架与 meta 扩展 — 完成（1.2.49 → 1.2.50）

**结果：** `python3 tests/run_all.py` GREEN 32/32（新增 `test_flowgen_meta.ts` 18 断言；`test_flow_editor.ts` 132→148 断言；`test_draft_api.py` +11；`test_web_api.py` 49→50）；`?flowsmoke=1` = SMOKE OK 十二项（新增 `✓meta-v2`）；黄金零漂移（编辑器不在采样区）。

**实现（全部先 RED 后 GREEN）：**
- 后端 `web.draft_ver_ok` + `DRAFT_VERS=(1,2)`：`save_draft` 接受 v∈{1,2}，拒绝 `v=3/'2'/2.0/true/null/缺失` 且零落盘（bool 是 int 子类，显式排除）。
- 前端 `FlowDraft.v: 1|2` + `whenToUse` + `phases[{title,detail}]`；`flowDraft()` 出 v2；`flowApply` v1 缺省空；载入守卫 `v!==1 && v!==2` 拒绝（v=3 提示不猜）。
- 生成器：`meta.whenToUse` / `phases[].detail` **有才出**（空字段落码会让 v1 产物漂移）——`tests/frontend/golden/flowgen_demo.js` 逐字节钉死。
- 单点：`flowDerivedPhases`（推导）/ `flowBandPhases`（阶段带显示清单：显式原样含空标题行，否则推导）/ `flowMetaPhases`（出码清单：过滤空标题、全空回落推导）。
- UI：头部 `#fWhen`；阶段带由只读芯片改为 `input.ph-t` + `input.ph-d`，编辑即物化（推导→显式）并 autosave；重绘按**内容签名**跳过，逐键不丢焦点。
- 测试基建：`harness.runFlowScript`（AD-6 桩替身沙箱单点）——`meta/phases/logs/calls/workflows/order/ret` 全记录。

**偏离计划：**
- 计划把 `runFlowScript` 抽取排在 AD-6 泛述里，实际在 Phase 1 落地（本相位就要用它做沙箱断言），`test_flow_editor.ts` 的局部 `runJs` 尚未替换为共享件（其断言全绿，替换留到 Phase 4 首次复用 pipeline 时一并做，避免无谓改动边界）。
- 计划 AC 第 6 条写"`phase()` 序列与阶段带顺序一致"：**仅在阶段带留空（推导）时成立**；显式阶段带只改 `meta.phases`，`phase()` 仍由 `agent.phase` 驱动（否则脚本语义错）。已用两条断言分别钉住，并让前置 `phase()` 取**推导**首项而非阶段带首项（用阶段带首项会凭空多一个空进度组）。

**影响后续相位的发现：**
- 显式阶段带与 `agent.phase` 可能不一致（用户在阶段带改名而节点 phase 没改）→ 运行期会多出进度组。**Phase 7 落 agent 选项时应考虑在检查器里联动/提示**；Phase 9 真机验收要覆盖这条。
- `flowDraft()` 现在恒出 `whenToUse:''` / `phases:[]` 两个键（v1 语义靠"空字段不落码"保持），后续新增 v2 字段照此办理。
- 版本判定两端镜像 + 三处用例的清单已写入 CLAUDE.md，Phase 2 加 `argsSpec` 时**不再动版本号**（仍是 v2 加宽，v1 兼容由"缺省空"保证）。

## Phase 2 · args 契约与 JSON Schema 根形状预校验 — 完成（1.2.50 → 1.2.51）

**结果：** run_all GREEN 33/33（新增 `test_flowgen_args.ts` 23 断言；`test_flow_editor.ts` 148→160；`test_draft_api.py` +1）。

**实现：**
- 草稿 `argsSpec{schemaText, exampleText, required}`（v2 加宽，缺省空 = 不出码）。
- 生成器：有声明才出 `const ARGS = (typeof args === 'string') ? JSON.parse(args) : args`；勾必填才出前置校验块（`args 缺少字段:<名>`，标识符键写 `ARGS.x`）；**有 ARGS 时 Q 从 ARGS 派生**——对象 args 与字符串化 JSON args 落到同一入口（沙箱断言钉死）。
- 校验器：`flowSchemaErrs(where, text)` 单点（agent.schemaText 与 argsSpec.schemaText 共用），根形状 `{type:'object',properties}` + `required ⊆ properties`；`argsSpec.exampleText` 非法 JSON → 报错且不出码。
- UI：`.flow-args` 面板（schema 文本 / 示例 JSON / 必填开关）紧挨 `#fErr`；编辑即刷脚本 + autosave。

**偏离计划：**
- AD-1 写 `argsSpec: { schema, example, required }`（schema/example 为**对象**）；实际存 `schemaText`/`exampleText`（**JSON 原文**）。理由：与既有 `agent.schemaText` 同一约定；若存对象，用户在面板里敲到一半的非法 JSON 会在 autosave/回载时丢失。语义（schema + 示例 + 必填三件）不变，后续相位不受影响。
- AC 第 5 条"两者走同一根形状校验单点"用 `flowSchemaErrs(where, text)` 实现（只换前缀），测试断言两处错误形状一致。

**影响后续相位的发现：**
- `flowValidate` 现在对 `agent.schemaText` 强制根形状——**既有草稿若写了 `{"type":"object"}` 而缺 `properties` 会开始报错**（PRD §5.4 规则 3 的要求，且运行期本就只接受该形状）。真机升级后如遇用户草稿报错，属预期。
- `flowArgsSpec` 是 argsSpec 的唯一读取口，Phase 4 的 `map.items` 若要引 `ARGS.x` 从这里取，不要另读 `fs.argsSpec`。

## Phase 3 · 运行与分发通道（命令区 + 边界文案）— 完成（1.2.51 → 1.2.52）

**结果：** run_all GREEN 33/33（`test_flow_editor.ts` 160→169）；`?flowsmoke=1` = SMOKE OK 十二项。

**实现：**
- `flowCommands(jsPath, name, cwd, example)` 单点（`45-flowgen.ts` 纯函数）：首次 / 恢复（`resumeFromRunId: 'wf_…'`）/ 分发（项目 + 个人两条 `cp`）。
- 命令区三行 + 边界说明（`#fRunNote`），三条各自复制按钮（复用 `copyText`）；`renderRunBox()` 由保存成功与 `flowRelang()` 调用。
- 边界文案两条：服务只写 `~/.claude/cc-viewer/`、执行/恢复/停止在终端 `/workflows`；恢复仅同会话且先停旧 run。

**偏离计划：** 无。

**执行中的决策：**
- 个人分发目标写 `"$HOME/.claude/workflows/<name>.js"` 而**不是** `'~/...'`：单引号会掐掉 `~` 展开，用户粘进终端会拷到字面量目录。
- 命令区在重开编辑器时清空（`fRunPath=''`）——命令必须对应"刚保存过的那份草稿",不跨会话悬空。

**影响后续相位的发现：**
- `#fRun` 现在依赖 `FS.argsSpec.exampleText` 作示例参数；Phase 4+ 若给 map 加 `items` 示例，仍从 argsSpec 取（示例只有一份）。
- 测试基建新增 `harness.clipboard`（navigator.clipboard 桩）+ `El.onclick` 声明——后续复制类断言直接用。

## Phase 4 · map 节点 = pipeline（含扇出级）— 完成（1.2.52 → 1.2.53）

**结果：** run_all GREEN 34/34（新增 `test_flowgen_pipeline.ts` 19 断言；`test_flow_editor.ts` +5 DOM 契约）；`?flowsmoke=1` = SMOKE OK 十三项（新增 `map-gen`）；黄金零漂移。

**实现：**
- 类型:`FlowKind` 增 `map`/`merge`;`FlowNodeData.items`。
- `flowMapChain` 单点:级 1 = **map 节点自身的 prompt/label 模板**(PRD §5.1 草稿形状),下游每级 = 单 agent 或"扇出→同一 merge";终止于 return / 多入边汇合 / 扇出级 merge(其后是消费者)。`flowMapChains`/`flowChainStageOf` 配套。
- 生成:链内节点不再出顶层 `const`,由 `pipeExpr` 在回调里消化;签名统一 `(prev, item, i)`;`{{item}}`→item、`{{index}}`→i、`{{上一级任一节点}}`→prev;级内 agent 恒带 phase opts。
- 校验:items 非空、至少一级、扇出必须汇于同一 merge、链内只许 agent(嵌套 map → 指向 code 节点)、`{{item}}/{{index}}` 链外报错、链内只能引用上一级、map 独占一层。
- UI:palette 加 Map/Merge;map 卡片带 items 输入 + 回调模板 + 语义提示;merge 卡片只作汇合点。

**偏离计划:**
- AD-3 规则 4 只说"map 的下游链每级生成一个回调";PRD §5.1 的草稿形状把 `prompt` 放在 map 节点上 → 定为"级 1 = map 自身模板"。两种读法都自洽,选了与草稿形状一致的那种,并让"map 无 prompt 时下游第一级即级 1"。
- 新增两条计划未列的校验(链内只能引用上一级 / 链内变量不得外泄):不写就会生成 ReferenceError 的脚本,属"宁可少生成,不可错生成"。

**影响后续相位的发现:**
- `flowAdj`(邻接表单点)已抽出,Phase 5/6 的区域分析复用它,别再各建一份。
- 扇出级用 `merge` 作汇合标记;Phase 5 的 branch 也要 `merge`——**merge 的语义统一为"汇合点,自身不执行"**,分支版只是入度 2。
- `{{item}}`/`{{index}}` 已被 FLOW_REF_RE 收录:任何新增的"占位符解析"入口都必须显式处理这两个 token(否则会被当成节点 id)。

## Phase 5 · branch + merge — 完成（1.2.53 → 1.2.54）

**结果：** run_all GREEN 36/36（新增 `test_flowgen_branch.ts` 17 断言、`tests/browser/test_branch_real.ts` 4 断言真实输入）；`?flowsmoke=1` = SMOKE OK 十四项（新增 `branch-gen`）。

**实现：**
- 走链器抽成 `flowWalkStages`（map 链与分支区域共用，`firstIsStage` 区分"起点是出码者"还是"起点是一级"）；`flowBranchRegion` 单点做区域规则 2（都连 / 不相交 / 同终止点）。
- 生成 `let <merge>; if (cond) { … } else { … }`；区域末级结果直接赋给 merge；块内引用同区域更早节点用真实变量名。
- 引用校验改用 `flowRegionOf` 单点（map/branch 区域统一）：区域外引用 = 报错（块作用域/pipeline 闭包都不可能在外部可见）。
- UI：branch 卡片（label + cond + 提示）、`handleHTML` 支持 hid/pos 覆盖（true/false 双出把、merge 的 in/in2 双入把，CSS 上下错位）；palette 加 Branch。

**偏离计划：**
- AD-4 的 branch 示例写 `let n6; if (…) { n6 = await agent(…) }`（无中间变量），照此实现——比"先 const 再赋值"少一层噪音。
- 新增"区域外引用 = 报错"与"branch 独占一层"两条校验（计划未列，但不写就会生成 ReferenceError 或语义错的脚本）。

**影响后续相位的发现：**
- `flowWalkStages` 现在有三个调用点（map 链 ×1、branch ×2）；Phase 6 的 loop 区域（单入口单出口）应复用同一走链器，别再写第四份。
- `merge` 的语义已统一：**汇合点，自身不执行**；map 扇出级、branch 汇合、Phase 6 loop 出口都可用它（入把 in/in2，允许 1 入 = 显式"区域结束"标记）。

## Phase 6 · loop + budget 守卫 + 成本/上限预估条 — 完成（1.2.54 → 1.2.55）

**结果：** run_all GREEN 38/38（新增 `test_flowgen_loop.ts` 16 断言、`tests/browser/test_loop_real.ts` 4 断言真实输入）；`?flowsmoke=1` = SMOKE OK 十五项（新增 `loop-gen`）。

**实现：**
- 回边 = 指向 loop 节点、来源在其体内的边（不新增 handle，用户把体末连回 loop 即得）；`flowBackEdgeIds` 让 `flowLevels` 忽略回边 → 合法循环不再被当环报错，非 loop 环照旧报错。
- `flowLoopRegion` 单点：单入口（体首入边只许来自 loop）、单出口（体末必须且只能回到 loop）、cond 非空、maxRounds 为 ≥1 整数（空=1）。
- 生成 `let <loop>; { let round = 0; while ((cond) && round < N) { [预算守卫] round++; 体 } }`；预算守卫阈值 `FLOW_BUDGET_FLOOR=50000`。
- `flowAgentEstimate` 单点 + `#fCost` 成本条（`◆N · 并发≤16 · 循环上界≤M · 预算守卫`，≥25 变红并挂 title 说明"估算值/上限"）。
- UI：loop 卡片（label/cond/maxRounds/预算守卫开关/语义提示）、body+out 双出把（CSS 上下错位）、palette 加 Loop。

**偏离计划：**
- 计划/AD-1 的草稿示例把回边写成 `sourceHandle:'back'`；实际**不新增 handle**——回边靠"目标 = loop 节点"判定。理由：让用户多记一个把手不值当，且 `handleHTML` 的 data-id 契约不必扩。
- AD-4 的 loop 示例用 `let n7 = [], round = 0, dry = 0`（用户自管累积变量）；实际只发 `let <loop>` + 块内 `round`，cond 由用户写原生 JS（引用外层变量/loop 结果）。这样不会凭空发明用户没写过的变量。

**影响后续相位的发现：**
- `flowWalkStages` 现有 4 个调用点（map ×1、branch ×2、loop ×1）；Phase 7/8 若再加区域（不该有）必须先想清楚是否复用。
- 成本条是"视图口径"：`flowAgentEstimate` 只此一处，Phase 9 真机验收要对照 `/workflows` 实际代理数（估算是上界，不是承诺）。

## Phase 7 · agent 选项 + retry + log — 完成（1.2.55 → 1.2.56）

**结果：** run_all GREEN 39/39（新增 `test_flowgen_retry.ts` 21 断言；`test_flow_editor.ts` +6；`test_draft_api.py` +5）；`?flowsmoke=1` = SMOKE OK 十五项；**`flowgen_demo.js` 黄金按口径变更重录**（仅 2 行:`phase` 恒发）。

**实现：**
- `opt()` 增 effort/agentType/isolation；`phase` 恒发（单节点层也发）——这是计划 AC 明列的口径变更，重录黄金并注明。
- `retryN>0` → `$retry(prompt, opts, n, backoffMs)`；助手全图一次；退避 100/200 由沙箱断言钉死；耗尽返回 null。
- `log` 节点出 `log(\`…\`)`；`{{nX}}` 走同一 `flowLiteral`。
- 校验：effort 五档白名单、retryN/retryMs ≥0 整数。
- 后端 `GET /api/agents` = `list_agent_types()`（本机 + 插件 agents，带 `<plugin>:` 前缀，去重，cap 200，纯读取）；前端 `<datalist>` + 自由文本。

**偏离计划：** 无（agentType 枚举按 AC 落成后端只读路由）。

**影响后续相位的发现：**
- `phase` 恒发后，`phase()` 全局调用与 opts.phase 并存——运行期以后者为准；阶段带与 agent.phase 不一致的老问题（Phase 1 记录）现在多了一层冗余信息，Phase 9 真机验收要观察 `/workflows` 分组是否如预期。
- `/api/agents` 是**新增只读路由**（铁律 2 只约束写盘；已加"CONF_DIR 之外一字未改"的反向断言）。

## Phase 8 · code + subflow + 载荷/引用校验 — 完成（1.2.56 → 1.2.57）

**结果：** run_all GREEN 41/41（新增 `test_flowgen_code.ts` 17 断言、`test_flowgen_subflow.ts` 12 断言；`test_flow_editor.ts` +7 DOM/警告）；`?flowsmoke=1` = SMOKE OK 十六项（新增 `code-gen`）。

**实现：**
- `flowStripLiterals`（字符串/注释 → 等长空白，正则字面量不识别 = "无法判定"来源）+ `flowCodeErrs`（import/确定性禁令，只判去字面量后的片段）+ `flowWarnings`（第二类结果:未知全局等,只提示不拦）。
- `flowSubflowErrs(fs, ctx)`:ref 必填、按名引用的存在性 + 一层嵌套;路径引用免检。`flowCtx()` 单点从 `fDrafts` 生成上下文。
- 生成:`code` → `const nX = await (async () => { 片段原文 })()`;`subflow` → `workflow("名"/{scriptPath}, args?)`。
- 产物沙箱禁令改为**去字面量后**判定(code 片段里的 `'Date.now()'` 是数据不是调用)。
- "至少一个 Agent 步骤"放宽为"至少一个执行步骤(Agent/Map/Code/Subflow)"——纯 subflow 图合法。
- UI:code 卡片(CODE 徽章 + 红条"不参与可视化语义" + 等宽编辑区)、subflow 卡片(ref 带草稿 datalist + args 表达式)、`#fWarn` 警告区(与 #fErr 分开)。

**偏离计划：** 无。

**影响后续相位的发现：**
- `flowValidate/flowGenerate` 现在有可选的第二参 `ctx`(草稿列表);**新增"需要外部知识的校验"请走 FlowCtx**,别把 IO 塞进纯函数。
- 警告通道已建(#fWarn + flowWarnings):后续若要加"建议类"提示,别再塞进 errors(会拦住保存)。
