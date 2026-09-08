// 由 Lucid 编排器生成 —— 目标项目: (未填)
// 用法: cd 目标项目 && Workflow({ scriptPath: '<本文件路径>', args: '<输入>' })
export const meta = {
  name: "demo-research",
  description: "三角拆解 → 并行检索 → 交叉验证",
  phases: [{ title: "Scope" }, { title: "Search" }, { title: "Verify" }],
}
phase("Scope")
const Q = (typeof args === 'string' && args.trim()) || "调研选题"
const n2 = await agent(`把选题 ${Q} 拆成 3 个互补的调研角度,每角度一行。`, { label: "拆解", phase: "Scope" })
phase("Search")
const [n3, n4, n5] = await parallel([
  () => agent(`角度1:${n2} —— 检索并汇总要点。`, { label: "检索A", phase: "Search" }),
  () => agent(`角度2:${n2} —— 检索并汇总要点。`, { label: "检索B", phase: "Search" }),
  () => agent(`角度3:${n2} —— 检索并汇总要点。`, { label: "检索C", phase: "Search" }),
])
phase("Verify")
const n6 = await agent(`对 ${n3} / ${n4} / ${n5} 交叉核对,标注矛盾点。`, { label: "交叉验证", phase: "Verify" })
return { report: n6, angles: [n3, n4, n5] }
