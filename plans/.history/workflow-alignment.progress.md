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
