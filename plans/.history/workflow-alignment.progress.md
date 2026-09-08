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
