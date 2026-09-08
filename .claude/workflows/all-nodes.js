// 由 Lucid 编排器生成 —— 目标项目: /Users/yanghai/projectDir/cc-viewer
// 用法: cd 目标项目 && Workflow({ scriptPath: '<本文件路径>', args: '<输入>' })
export const meta = {
  name: "all-nodes",
  description: "全节点型验收夹具",
  whenToUse: "当需要一次跑通全部节点型时",
  phases: [{ title: "Scan", detail: "逐条目审计" }, { title: "Judge" }, { title: "Iterate" }],
}
const ARGS = (typeof args === 'string') ? JSON.parse(args) : args
if (!ARGS || typeof ARGS !== 'object') throw new Error("缺少 args(需要对象)")
if (typeof ARGS.paths === 'undefined') throw new Error("args 缺少字段:paths")
phase("Scan")
const Q = (typeof ARGS === 'string' && ARGS.trim()) || "全节点型验收"
const n2 = await pipeline(ARGS.paths, (prev, item, i) => agent(`审计 ${item}(第 ${i} 个),一句话结论。`, { label: `audit:${item}`, phase: "Scan" }), (prev, item, i) => agent(`把这些审计结论合成三行以内:${prev}`, { label: "汇总", phase: "Scan" }))
const n4 = n2;
let n8;
if (ARGS.flag) {
  n8 = await agent(`用一句话肯定这份结论:${n4}`, { label: "是", phase: "Judge" })
} else {
  n8 = await agent(`用一句话指出风险:${n4}`, { label: "否", phase: "Judge" })
}
let n9;
{
  let round = 0;
  while ((true) && round < 2) {
    if (budget.total && budget.remaining() < 50000) { log('预算将尽,提前收束'); break }
    round++;
    n9 = await agent(`再给一条补充建议(第几次不重要):${n8}`, { label: "迭代", phase: "Iterate", effort: "low" })
  }
}
const n11 = await (async () => {
return { rounds: n9 ? 2 : 0, len: String(n9).length }
})()
const n12 = await workflow("all-nodes-child", { v: n11 })
log(`夹具完成,subflow 结果 ${n12}`)
return { v: n12, code: n11 }
