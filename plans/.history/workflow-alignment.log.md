# Planning Log — workflow-alignment

## 2026-09-08 · 初版计划

**输入:** `docs/workflow-alignment-research.md`（v1.0，证据基座 CC 2.1.263）
**模式:** Feature Planning（契约级）——用户确认保留 schema 形状/节点语义/生成物形状/校验规则顺序等跨相位契约
**基线:** 1.2.49（计划相位落到 1.2.50–1.2.58）

**决策（用户确认）:**
1. 详细度 = 契约级（本 PRD 为技术设计文档，删契约即不可执行）
2. 范围 = X6–X12 对应九相位，L2 运行面查看器不扩（已由 D20–D51 覆盖）
3. 粒度 = 保持 9 个相位（不合并、不拆 code/subflow）
4. HITL/AFK = 首尾两个 HITL（Phase 1 骨架、Phase 9 真机端到端），其余 AFK

**相对 PRD §6 的再切片（偏离记录）:**
- PRD 的 X6 一张卡含 schema v2 + args 面板 + 成本条 + 恢复命令，超出"骨架必须 S"约束 → 拆为 Phase 1（骨架）、Phase 2（args 契约）、Phase 3（运行/分发通道）。
- 成本条（PRD #28/#33）从 X6 移入 Phase 6：估算口径 = `agent` 数 × 所在 loop 的 `maxRounds`，依赖 loop 落地。
- PRD 的 X10 保持整卡（agent 选项 + retry + log）= Phase 7。
- PRD 的 X11 保持整卡（code + subflow + 校验）= Phase 8（Size L，已说明不拆理由）。

**代码地图发现（写进计划的事实）:**
- 后端 `scripts/ccviewer/web.py:71` 与前端 `frontend/src/40-flow.ts:350` 各自硬拒 `draft.v !== 1` → schema v2 是贯穿"持久化+载入"两层的最小切片。
- `tests/frontend/test_flow_editor.ts:495-541` 已存在"桩替身真跑生成脚本"跑器 → 计划将其收敛为共享单点，不新起测试链。
- `tests/browser/harness.ts` 已有 CDP 真实输入脚手架 → 新 handle（`true`/`false`/`body`/`back`）的拖拽测试直接沿用。
- 工具链：node 22.23.1（≥22.18，原生 type-stripping 可用）、Chrome 在位、`plans/` 目录此前不存在。

**待复核（执行期）:**
- `budget` 是否为稳定公开 API（PRD §10 标"有但未文档化"）——Phase 6 只发形状、不做依赖。
- `agentType` 枚举来源跨本机与插件 agents，空/重复/命名空间前缀处理（Phase 7 风险项）。
