// 由 Lucid 编排器生成 —— 目标项目: /Users/yanghai/projectDir/cc-viewer
// 用法: cd 目标项目 && Workflow({ scriptPath: '<本文件路径>', args: '<输入>' })
export const meta = {
  name: "all-nodes-child",
  description: "子流:收下父流的结果并回一句",
  whenToUse: "被 all-nodes 内联调用",
  phases: [{ title: "Child" }],
}
phase("Child")
const Q = (typeof args === 'string' && args.trim()) || "父流传来的结果"
const c2 = await agent("用一句话确认收到:{{c1}}", { label: "子流回执", phase: "Child" })
return { child: c2 }
