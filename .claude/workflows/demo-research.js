// 由 Lucid 编排器生成 —— 目标项目: /Users/yanghai/projectDir/cc-viewer
// 用法: cd 目标项目 && Workflow({ scriptPath: '<本文件路径>', args: '<输入>' })
export const meta = {
  name: "demo-research",
  description: "三角拆解 → 并行检索 → 交叉验证",
  phases: [{ title: "步骤n2" }],
}
phase("步骤n2")
const Q = (typeof args === 'string' && args.trim()) || "调研选题"
const n1 = await agent("", { label: "步骤n2", agentType: "market-researcher", isolation: "worktree" })
return { results: [n1].filter(Boolean) }
