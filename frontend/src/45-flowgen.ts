// ── 45-flowgen.ts:图 → Workflow 执行件的生成器(纯函数,零 DOM,零 vendor 依赖)──
// 语义映射(§6 验收表,保守可审计;X3 之前不生成 pipeline/循环/条件——宁可少生成,不可错生成):
//   拓扑层(最长路径分层) = 一个 await 点;层内单 agent = 顺序 await,层内多 agent = parallel 栅栏(每个带 opts.phase);
//   {{nX}} 占位符 → 模板字面量 ${nX}(start 节点 → ${Q});phase 序列 = 各 agent 的 phase 首现去重 → meta.phases;
//   schemaText → 顶部 const SCHEMA_vX 字面量 + opts.schema;return.ret 空 → 兜底 { results: [末层变量].filter(Boolean) }。
// 三个口径各住唯一函数:flowValidate(错误清单)/ flowMetaPhases(phase 首现去重)/ flowGenerate(出码)——UI 与测试都只调它们。
const FLOW_MODEL_OK = ['sonnet', 'opus', 'haiku', 'fable', 'mythos'];   // agent(opts.model) 档位白名单;'' = inherit
// ⚠ 共享带 /g 的正则做 .test()/.exec() 会留下 lastIndex 状态(同一正则被两个调用方交错使用即漏判)——
// 因此探测用无 g 的 FLOW_REF_PROBE,枚举用 matchAll(自带独立迭代状态),替换用带 g 的 replace(结束时自复位)。
const FLOW_REF_PROBE = /\{\{(n\d+|start|item|index)\}\}/;
const FLOW_REF_RE = /\{\{(n\d+|start|item|index)\}\}/g;
const FLOW_SANDBOX_BANNED = /Date\.now\(\)|Math\.random\(\)|new Date\(\)/;   // 沙箱禁用且破坏 resume
const FLOW_BUDGET_FLOOR = 50000;       // loop 预算守卫阈值(AD-4):剩余预算低于它就提前收束并 log

// ── 邻接表单点(链/区域分析共用;环由 flowValidate 报,这里只给结构)──
function flowAdj(fs: FlowDraft): { out: Map<string, string[]>; inn: Map<string, string[]> } {
  const out = new Map<string, string[]>(), inn = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string): void => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (const e of fs.edges) { push(out, e.source, e.target); push(inn, e.target, e.source); }
  return { out, inn };
}
// ── 结构化走链单点(map 链 / 分支区域共用;Phase 4 起,Phase 5 抽出复用)──────────────
// 从 start 出发沿后继走:每级 = 单个 agent,或"扇出 → 同一 merge"。终止:
//   ① 无后继 → 区域尾(exit = 当前节点,意味着没接 merge/return);
//   ② 后继多入边 / 是 return → 消费者(exit = 它,区域到此为止);
//   ③ 后继非 agent → 报错(嵌套组合请走 code 节点)。
interface FlowWalk { stages: string[][]; inner: Set<string>; exits: string[]; errs: string[] }
// firstIsStage:start 本身算不算一级。map 链传 false(map 是出码者,不是级);分支/循环体传 true。
// stopAt:走到这些节点即停(循环体用它停在 loop 节点上)。
function flowWalkStages(fs: FlowDraft, start: string, where: string, firstIsStage = false, stopAt?: Set<string>): FlowWalk {
  const { out, inn } = flowAdj(fs);
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const stages: string[][] = [], inner = new Set<string>(), exits: string[] = [], errs: string[] = [];
  const seen = new Set<string>([start]);
  const first = byId.get(start);
  if (!first) return { stages, inner, exits, errs: [`${where} 的起点不存在`] };
  // start 本身就是汇合点(如 branch 直接连 merge):空区域,exit = 它
  if (first.type === 'merge' && (inn.get(start) || []).length > 1) return { stages, inner, exits: [start], errs };
  if (firstIsStage) {
    if (first.type === 'return') return { stages, inner, exits: [start], errs };
    if (first.type !== 'agent') { errs.push(`${where} 内只允许 agent 级(遇到 ${first.type});嵌套组合请改用 code 节点`); return { stages, inner, exits, errs }; }
    stages.push([start]); inner.add(start);
  }
  let cur = start;
  for (let guard = 0; guard <= fs.nodes.length + 1; guard++) {
    const succ = (out.get(cur) || []).filter(id => byId.has(id));
    if (!succ.length) { exits.push(cur); break; }
    if (succ.length === 1) {
      const s = succ[0], node = byId.get(s)!;
      if (stopAt && stopAt.has(s)) { exits.push(s); break; }
      if (seen.has(s)) { errs.push(`${where} 出现环`); break; }
      if (node.type === 'return' || (inn.get(s) || []).length > 1) { exits.push(s); break; }
      if (node.type !== 'agent') { errs.push(`${where} 内只允许 agent 级(遇到 ${node.type});嵌套组合请改用 code 节点`); break; }
      stages.push([s]); inner.add(s); seen.add(s); cur = s; continue;
    }
    // 扇出级:所有后继必须各只有一条出边、且汇于同一个 merge(该 merge 的入边恰好就是这些后继)
    const merges = new Set<string>();
    let bad = false;
    for (const s of succ) {
      const so = (out.get(s) || []).filter(id => byId.has(id));
      if (byId.get(s)?.type !== 'agent' || so.length !== 1 || seen.has(s)) { bad = true; break; }
      merges.add(so[0]);
    }
    const m = [...merges][0], mn = m ? byId.get(m) : null;
    if (bad || merges.size !== 1 || !mn || mn.type !== 'merge' || (inn.get(m) || []).length !== succ.length) {
      errs.push(`${where} 的扇出级必须汇于同一个 merge 节点`);
      break;
    }
    for (const s of succ) { inner.add(s); seen.add(s); }
    stages.push(succ); inner.add(m); seen.add(m);
    const mOut = (out.get(m) || []).filter(id => byId.has(id));
    if (stopAt && mOut.length === 1 && stopAt.has(mOut[0])) { exits.push(mOut[0]); break; }   // 扇出级后直接回到 loop
    exits.push(m); break;
  }
  return { stages, inner, exits, errs };
}
// map 链分析单点(Phase 4):级 1 = map 节点**自身**的 prompt/label 模板(PRD §5.1 的草稿形状),
// 下游每级由 flowWalkStages 走。贪心到汇合点为止——map 的语义就是"下游每一级是 pipeline 的一级"(PRD §5.2 规则 4)。
interface MapChain { mapId: string; stages: string[][]; inner: Set<string>; errs: string[] }
function flowMapChain(fs: FlowDraft, mapId: string): MapChain {
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const stages: string[][] = [], inner = new Set<string>(), errs: string[] = [];   // inner 不含 map 自己(它负责出码)
  if (String(byId.get(mapId)?.data.prompt || '').trim()) stages.push([mapId]);
  const w = flowWalkStages(fs, mapId, `节点 ${mapId} 的 map 链`);
  stages.push(...w.stages); w.inner.forEach(id => inner.add(id)); errs.push(...w.errs);
  return { mapId, stages, inner, errs };
}
// 全图 map 链(生成与校验共用;生成时据此跳过链内节点)
function flowMapChains(fs: FlowDraft): Map<string, MapChain> {
  const m = new Map<string, MapChain>();
  for (const n of fs.nodes) if (n.type === 'map') m.set(n.id, flowMapChain(fs, n.id));
  return m;
}
// 分支区域单点(Phase 5,PRD §5.2 规则 2):true/false 各自走一条链,要求
// ① 两条都连且各只有一个后继;② 可达集不相交;③ 终止于同一个 merge(或同一个 return)。
interface BranchRegion { branchId: string; cond: string; tStages: string[][]; fStages: string[][]; inner: Set<string>; merge: string | null; errs: string[] }
function flowBranchRegion(fs: FlowDraft, branchId: string): BranchRegion {
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const errs: string[] = [];
  const outs = (hid: string): string[] => fs.edges.filter(e => e.source === branchId && e.sourceHandle === hid).map(e => e.target);
  const t0 = outs('true'), f0 = outs('false');
  const cond = String(byId.get(branchId)?.data.cond || '').trim();
  if (!cond) errs.push(`节点 ${branchId} 的 branch 缺少 cond 条件表达式`);
  if (t0.length !== 1) errs.push(`节点 ${branchId} 的 true 分支必须连且只连一个后继`);
  if (f0.length !== 1) errs.push(`节点 ${branchId} 的 false 分支必须连且只连一个后继`);
  if (errs.length) return { branchId, cond, tStages: [], fStages: [], inner: new Set(), merge: null, errs };
  const wt = flowWalkStages(fs, t0[0], `节点 ${branchId} 的 true 分支`, true);
  const wf = flowWalkStages(fs, f0[0], `节点 ${branchId} 的 false 分支`, true);
  errs.push(...wt.errs, ...wf.errs);
  const tAll = new Set<string>([t0[0], ...wt.inner]), fAll = new Set<string>([f0[0], ...wf.inner]);
  for (const id of tAll) if (fAll.has(id)) errs.push(`节点 ${branchId} 的两条分支在汇合前相遇(区域必须不相交):${id}`);
  const te = wt.exits, fe = wf.exits;
  const same = te.length === 1 && fe.length === 1 && te[0] === fe[0];
  const ex = same ? byId.get(te[0]) : null;
  let merge: string | null = null;
  if (same && ex?.type === 'merge') merge = te[0];
  else if (!(same && ex?.type === 'return')) errs.push(`节点 ${branchId} 的两条分支必须终止于同一个 merge(或同一个 return)`);
  return { branchId, cond, tStages: wt.stages, fStages: wf.stages, inner: new Set([...tAll, ...fAll]), merge, errs };
}
function flowBranchRegions(fs: FlowDraft): Map<string, BranchRegion> {
  const m = new Map<string, BranchRegion>();
  for (const n of fs.nodes) if (n.type === 'branch') m.set(n.id, flowBranchRegion(fs, n.id));
  return m;
}
// ── 循环区域单点(Phase 6,PRD §5.2 规则 1)────────────────────────────────
// 回边 = 指向 loop 节点、且来源在它体内的边。**环检测必须放行它**(否则合法循环被当成环报错),
// 而"不在任何 loop 体内的环"照旧报错——判定靠 flowBackEdgeIds 一处。
function flowLoopBody(fs: FlowDraft, loopId: string): { entry: string | null; inner: Set<string> } {
  const { out } = flowAdj(fs);
  const be = fs.edges.filter(e => e.source === loopId && e.sourceHandle === 'body');
  const entry = be.length === 1 ? be[0].target : null;
  const inner = new Set<string>();
  if (!entry) return { entry, inner };
  const stack = [entry];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === loopId || inner.has(id)) continue;
    inner.add(id);
    for (const s of out.get(id) || []) if (s !== loopId) stack.push(s);
  }
  return { entry, inner };
}
function flowBackEdgeIds(fs: FlowDraft): Set<string> {
  const back = new Set<string>();
  for (const n of fs.nodes) {
    if (n.type !== 'loop') continue;
    const { inner } = flowLoopBody(fs, n.id);
    for (const e of fs.edges) if (e.target === n.id && inner.has(e.source)) back.add(e.id);
  }
  return back;
}
interface LoopRegion { loopId: string; cond: string; maxRounds: number; budgetGuard: boolean; stages: string[][]; inner: Set<string>; errs: string[] }
function flowLoopRegion(fs: FlowDraft, loopId: string): LoopRegion {
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const d = byId.get(loopId)?.data || {};
  const cond = String(d.cond || '').trim();
  const raw = d.maxRounds;
  const maxRounds = (raw === undefined || raw === null || String(raw).trim() === '') ? 1 : Number(raw);
  const errs: string[] = [];
  if (!cond) errs.push(`节点 ${loopId} 的 loop 缺少 cond 条件表达式`);
  if (!Number.isInteger(maxRounds) || maxRounds < 1) errs.push(`节点 ${loopId} 的 maxRounds 必须是 ≥1 的整数(收到 ${JSON.stringify(raw)})`);
  const { entry } = flowLoopBody(fs, loopId);
  if (!entry) { errs.push(`节点 ${loopId} 的 loop 必须有一条 body 出边(循环体入口)`); return { loopId, cond, maxRounds, budgetGuard: !!d.budgetGuard, stages: [], inner: new Set(), errs }; }
  const { out, inn } = flowAdj(fs);
  const entryIn = (inn.get(entry) || []).filter(id => id !== loopId);
  if (entryIn.length) errs.push(`节点 ${loopId} 的循环体不是单入口(体首 ${entry} 还有来自 ${entryIn.join(', ')} 的入边)`);
  const w = flowWalkStages(fs, entry, `节点 ${loopId} 的循环体`, true, new Set([loopId]));
  errs.push(...w.errs);
  if (!(w.exits.length === 1 && w.exits[0] === loopId)) errs.push(`节点 ${loopId} 的循环体不是单出口(体末必须回到 loop 节点)`);
  for (const id of w.inner) {
    const bad = (out.get(id) || []).filter(x => x !== loopId && !w.inner.has(x));
    if (bad.length) errs.push(`节点 ${loopId} 的循环体不是单出口(${id} 还连到体外的 ${bad.join(', ')})`);
  }
  return { loopId, cond, maxRounds, budgetGuard: !!d.budgetGuard, stages: w.stages, inner: w.inner, errs };
}
function flowLoopRegions(fs: FlowDraft): Map<string, LoopRegion> {
  const m = new Map<string, LoopRegion>();
  for (const n of fs.nodes) if (n.type === 'loop') m.set(n.id, flowLoopRegion(fs, n.id));
  return m;
}
// 代理数估算单点(成本条口径,PRD §5.4 规则 7):每个 agent 计 1 × 它所在**全部** loop 的 maxRounds 之积。
// 这是估算值——并发上限 16、单次运行代理总数上限 1000 由界面写明,不假装精确。
function flowAgentEstimate(fs: FlowDraft): number {
  const loops = flowLoopRegions(fs);
  let total = 0;
  for (const n of fs.nodes) {
    if (n.type !== 'agent') continue;
    let mult = 1;
    for (const lp of loops.values()) if (lp.inner.has(n.id)) mult *= lp.maxRounds;
    total += mult;
  }
  return total;
}
// 区域归属单点(引用校验用):节点 → 它所属的区域(map 链 / 分支区域 / 循环体)。map/loop 自己不入表(它们持有结果)。
function flowRegionOf(chains: Map<string, MapChain>, branches: Map<string, BranchRegion>, loops: Map<string, LoopRegion>): Map<string, { kind: 'map' | 'branch' | 'loop'; id: string }> {
  const m = new Map<string, { kind: 'map' | 'branch' | 'loop'; id: string }>();
  for (const c of chains.values()) for (const id of c.inner) m.set(id, { kind: 'map', id: c.mapId });
  for (const b of branches.values()) for (const id of b.inner) m.set(id, { kind: 'branch', id: b.branchId });
  for (const l of loops.values()) for (const id of l.inner) m.set(id, { kind: 'loop', id: l.loopId });
  return m;
}

// 上游可达集(单点:占位符引用与"汇聚等待"判定都靠它)
function flowUpstream(fs: FlowDraft): Map<string, Set<string>> {
  const bySrc = new Map<string, string[]>();
  for (const e of fs.edges) {
    const a = bySrc.get(e.target); if (a) a.push(e.source); else bySrc.set(e.target, [e.source]);
  }
  const memo = new Map<string, Set<string>>();
  const walk = (id: string, trail: Set<string>): Set<string> => {
    const hit = memo.get(id); if (hit) return hit;
    const acc = new Set<string>();
    for (const p of bySrc.get(id) || []) {
      if (trail.has(p)) continue;                  // 环由 flowValidate 报，这里只防死递归
      acc.add(p); trail.add(p);
      for (const q of walk(p, trail)) acc.add(q);
      trail.delete(p);
    }
    memo.set(id, acc); return acc;
  };
  const out = new Map<string, Set<string>>();
  for (const n of fs.nodes) out.set(n.id, walk(n.id, new Set([n.id])));
  return out;
}

// 拓扑分层 + 结构诊断(环 / 自环 / 孤立 / Start 空转)。groups=每层的节点 id;诊断非空时调用方不得出码。
function flowLevels(fs: FlowDraft): { groups: string[][]; orphan: string[]; cycle: string[]; dangling: string[]; selfEdge: string[] } {
  const ids = fs.nodes.map(n => n.id), known = new Set(ids);
  const back = flowBackEdgeIds(fs);        // 回边不参与分层:合法循环不该被当成环
  const es = fs.edges.filter(e => known.has(e.source) && known.has(e.target) && e.source !== e.target && !back.has(e.id));
  const indeg = new Map<string, number>(ids.map(i => [i, 0]));
  const out = new Map<string, string[]>(ids.map(i => [i, []]));
  const deg = new Map<string, number>(ids.map(i => [i, 0]));
  for (const e of es) { indeg.set(e.target, (indeg.get(e.target) || 0) + 1); deg.set(e.target, (deg.get(e.target) || 0) + 1); out.get(e.source)!.push(e.target); }
  const level = new Map<string, number>();
  const queue = ids.filter(i => (indeg.get(i) || 0) === 0);
  queue.forEach(i => level.set(i, 0));
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    for (const v of out.get(u) || []) {
      level.set(v, Math.max(level.get(v) ?? 0, (level.get(u) ?? 0) + 1));
      deg.set(v, (deg.get(v) || 0) - 1);
      if ((deg.get(v) || 0) === 0) queue.push(v);
    }
  }
  // 环上的判定必须看"是否被消化过",不能看有没有 level:最长路径分层会给**带非环父节点的成环节点**
  // 提前发层号(n2 因 n1→n2 拿到 level 1),用 level.has() 会把这类环漏报成"只剩下游"(实测)。
  const resolved = new Set(queue);
  const cycle = ids.filter(i => !resolved.has(i));                     // Kahn 未消化 = 落在环上(含环的下游)
  const lv = [...level.entries()].sort((a, b) => a[1] - b[1]);
  const groups: string[][] = [];
  for (const [id, l] of lv) { if (!groups[l]) groups[l] = []; groups[l].push(id); }
  const hasIn = new Set<string>(), hasOut = new Set<string>();
  for (const e of es) { hasIn.add(e.target); hasOut.add(e.source); }
  // 孤立 = 完全没连线(与"多个入度 0 的并行起点"是两回事:后者合法,§6 首行)
  const orphan = fs.nodes.length > 1 ? ids.filter(i => !hasIn.has(i) && !hasOut.has(i)) : [];
  const dangling = fs.nodes.filter(n => n.type === 'start' && fs.nodes.length > 1 && !hasOut.has(n.id)).map(n => n.id);
  const selfEdge = fs.edges.filter(e => e.source === e.target).map(e => e.source);
  return { groups, orphan, cycle, dangling, selfEdge };
}

function flowRefErrs(fs: FlowDraft, chains: Map<string, MapChain>, branches: Map<string, BranchRegion>, loops: Map<string, LoopRegion>): string[] {
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const up = flowUpstream(fs);
  const startId = fs.nodes.find(n => n.type === 'start')?.id;
  const regionOf = flowRegionOf(chains, branches, loops);
  const errs: string[] = [];
  for (const n of fs.nodes) {
    if (n.type !== 'agent' && n.type !== 'map') continue;
    const own = regionOf.get(n.id);
    const chain = n.type === 'map' ? (chains.get(n.id) || null) : (own?.kind === 'map' ? chains.get(own.id)! : null);
    const seen = new Set<string>();
    for (const m of String(n.data.prompt || '').matchAll(FLOW_REF_RE)) seen.add(m[1]);
    for (const ref of seen) {
      if (ref === 'item' || ref === 'index') {                       // 只在 map 链的级里有意义
        if (!chain) errs.push(`节点 ${n.id} 的 {{${ref}}} 只能在 map 链内使用`);
        continue;
      }
      const target = ref === 'start' ? startId : ref;
      if (!target || !byId.has(target)) { errs.push(`节点 ${n.id} 引用了不存在的节点 {{${ref}}}`); continue; }
      if (target === n.id) { errs.push(`节点 ${n.id} 引用了自身 {{${ref}}}`); continue; }
      if (chain && chain.mapId !== n.id) {                           // map 链内:只有"上一级"的结果拿得到(回调的 prev)
        const si = chain.stages.findIndex(lv => lv.indexOf(n.id) >= 0);
        const prevLv = si > 0 ? chain.stages[si - 1] : [];
        const tgtRegion = regionOf.get(target);
        if (tgtRegion || target === chain.mapId) {                   // 链内节点(含 map 自身)只许当"上一级"用
          if (prevLv.indexOf(target) < 0) errs.push(`节点 ${n.id} 在 ${chain.mapId} 的 map 链内,只能引用上一级的结果 {{${ref}}}`);
          continue;
        }
        if (!(up.get(n.id)?.has(target))) errs.push(`节点 ${n.id} 的 {{${ref}}} 不是它的上游(连不到 = 拿不到结果)`);
        continue;
      }
      const tgtRegion = regionOf.get(target);
      if (tgtRegion && (!own || own.kind !== tgtRegion.kind || own.id !== tgtRegion.id)) {
        // 区域外引用:map 链内变量只活在回调闭包,pipeline 自身的结果也要等它算完
        errs.push(tgtRegion.kind === 'map'
          ? `节点 ${n.id} 引用了 map 链内的节点 {{${ref}}}(链内变量只在 pipeline 回调里存在)`
          : tgtRegion.kind === 'loop'
            ? `节点 ${n.id} 引用了循环体内的节点 {{${ref}}}(循环体变量在循环外不可见,请引用 loop 节点自身)`
            : `节点 ${n.id} 引用了分支区域内的节点 {{${ref}}}(块作用域变量在分支外不可见,请用 merge 汇合)`);
        continue;
      }
      if (!(up.get(n.id)?.has(target))) errs.push(`节点 ${n.id} 的 {{${ref}}} 不是它的上游(连不到 = 拿不到结果)`);
    }
  }
  return errs;
}

// args 契约读取单点(缺省 = 全空,不猜不塞)——生成器、校验器、UI 都从这里取
function flowArgsSpec(fs: FlowDraft): FlowArgsSpec {
  const a = fs.argsSpec || ({} as Partial<FlowArgsSpec>);
  return { schemaText: String(a.schemaText ?? ''), exampleText: String(a.exampleText ?? ''), required: !!a.required };
}
// JSON Schema 根形状校验单点:**agent.schemaText 与 argsSpec.schemaText 共用**(PRD §5.4 规则 3——
// 运行期 agent() 只接受 {type:'object',properties:{…}} 且 required ⊆ properties,不可满足的 schema 在那里就抛)。
// where = 报错前缀(「节点 n2 的 schema」/「args 的 schema」),错误形状两处一致。
function flowSchemaErrs(where: string, text: string): string[] {
  const t = String(text || '').trim();
  if (!t) return [];
  let j: unknown;
  try { j = JSON.parse(t); }
  catch (e) { return [`${where} 不是合法 JSON:${String((e as Error).message || '')}`]; }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return [`${where} 需为 JSON 对象`];
  const o = j as { type?: unknown; properties?: unknown; required?: unknown };
  const props = o.properties && typeof o.properties === 'object' && !Array.isArray(o.properties) ? (o.properties as Record<string, unknown>) : null;
  if (o.type !== 'object' || !props) return [`${where} 根须为 {type:'object', properties:{…}}(运行期只接受这个形状)`];
  const req = (Array.isArray(o.required) ? o.required : []).filter((k): k is string => typeof k === 'string');
  const miss = req.filter(k => !Object.prototype.hasOwnProperty.call(props, k));
  return miss.length ? [`${where} 的 required 不在 properties 内:${miss.join(', ')}`] : [];
}

// 校验清单(空 = 可生成)。顺序固定:结构 → 区域(map 链)→ 引用 → 载荷,便于 UI 红条稳定不跳。
function flowValidate(fs: FlowDraft): string[] {
  const errs: string[] = [];
  const starts = fs.nodes.filter(n => n.type === 'start'), terms = fs.nodes.filter(n => n.type === 'return');
  const agents = fs.nodes.filter(n => n.type === 'agent');
  if (!starts.length) errs.push('缺 Start 节点(生成脚本的 args 入口)');
  if (!terms.length) errs.push('缺 Return 节点(生成脚本的产出)');
  if (!agents.length) errs.push('至少需要一个 Agent 步骤');
  const { groups, orphan, cycle, dangling, selfEdge } = flowLevels(fs);
  if (cycle.length) errs.push('图中存在环,请调整连线:' + cycle.join(', '));
  if (selfEdge.length) errs.push('存在自环连线:' + selfEdge.map(i => i + ' → ' + i).join(', '));
  if (orphan.length) errs.push('孤立/未连线节点:' + orphan.join(', '));
  // Start 没连任何步骤 = args 入口空转(生出来的 Q 没人用),多半是漏连线而非有意
  if (dangling.length) errs.push('Start 节点未连到任何步骤(args 入口没被用到):' + dangling.join(', '));
  if (terms.length > 1 || starts.length > 1) errs.push('一个草稿至多一个 Start 与一个 Return');
  // ── 区域:map 链(结构约束,先于引用校验)──
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const chains = flowMapChains(fs);
  for (const c of chains.values()) {
    errs.push(...c.errs);
    if (!String(byId.get(c.mapId)?.data.items || '').trim()) errs.push(`节点 ${c.mapId} 的 map 缺少 items 表达式`);
    if (!c.stages.length) errs.push(`节点 ${c.mapId} 的 map 至少要接一级 agent(它自身是 pipeline 入口,不是级)`);
  }
  // ── 区域:分支(Phase 5)+ 循环(Phase 6)──
  const branches = flowBranchRegions(fs);
  for (const b of branches.values()) errs.push(...b.errs);
  const loops = flowLoopRegions(fs);
  for (const l of loops.values()) errs.push(...l.errs);
  // map / branch / loop 会独占一个 await 点(if/else、pipeline、while 都不能塞进 parallel thunk):与别的步骤同层没法表达
  for (const g of groups) {
    if (!g) continue;
    const solo = g.filter(id => { const t = byId.get(id)?.type; return t === 'map' || t === 'branch' || t === 'loop'; });
    if (solo.length && g.length > 1) errs.push(`节点 ${solo.join(', ')}(map/branch/loop)不能与其他步骤同层(它会独占一个 await 点)`);
  }
  errs.push(...flowRefErrs(fs, chains, branches, loops));
  for (const n of fs.nodes) if (n.type === 'agent') errs.push(...flowSchemaErrs(`节点 ${n.id} 的 schema`, String(n.data.schemaText || '')));
  const aspec = flowArgsSpec(fs);
  errs.push(...flowSchemaErrs('args 的 schema', aspec.schemaText));
  const ex = aspec.exampleText.trim();
  if (ex) {
    try { JSON.parse(ex); }
    catch (e) { errs.push(`args 示例不是合法 JSON:${String((e as Error).message || '')}`); }
  }
  for (const n of agents) {
    const md = String(n.data.model || '');
    if (md && !FLOW_MODEL_OK.includes(md) && !/^claude-[a-z0-9.:-]+$/i.test(md)) errs.push(`节点 ${n.id} 的 model「${md}」不在白名单`);
  }
  return errs;
}

// 推导口径(阶段带留空时用它):agent 的 phase||label 按分层顺序首现去重(1.2.43 起不变)
function flowDerivedPhases(fs: FlowDraft): FlowPhase[] {
  const { groups } = flowLevels(fs);
  const seen: string[] = [];
  for (const g of groups) for (const id of g) {
    const n = fs.nodes.find(x => x.id === id); if (!n) continue;
    const ph = (n.type === 'agent' && (n.data.phase || n.data.label)) || '';
    if (ph && !seen.includes(ph)) seen.push(ph);
  }
  return seen.map(title => ({ title }));
}
// 阶段带的**显示**清单(唯一实现):显式则原样(含正在编辑的空标题行——行不能边打字边消失),否则推导。
// 与 flowMetaPhases 的差别只是"编辑中"与"落码":后者过滤空标题、全空则回落推导。
function flowBandPhases(fs: FlowDraft): FlowPhase[] {
  const norm = (p: FlowPhase | undefined): FlowPhase => ({ title: String(p?.title ?? ''), detail: String(p?.detail ?? '') });
  return fs.phases && fs.phases.length ? fs.phases.map(norm) : flowDerivedPhases(fs).map(norm);
}
// meta.phases 单点(生成与 UI 阶段带共用):**显式阶段带优先,空/全空标题 → 回落推导**。
// 显式 = 用户在阶段带上写过的标题(顺序即用户顺序);推导 = 上面的 flowDerivedPhases。
// detail 逐字保留(空则不出该键——空字段落码会让 v1 草稿产物漂移,零 diff 断言钉死)。
function flowMetaPhases(fs: FlowDraft): FlowPhase[] {
  const out: FlowPhase[] = [];
  for (const p of flowBandPhases(fs)) {
    if (!p.title.trim()) continue;
    out.push(String(p.detail ?? '').trim() ? p : { title: p.title });
  }
  return out.length ? out : flowDerivedPhases(fs);
}

// ── 运行/分发命令拼装单点(1.2.52,Phase 3)────────────────────────────────────
// 三种形态共用这一处,UI 与测试都只调它。写边界(铁律 2/3):分发只给**用户手动的 cp**——
// 服务从不写 .claude/workflows/;执行、恢复、停止永远在用户终端(/workflows)。
type FlowCmds = { first: string; resume: string; dist: string };
const flowSq = (s: string): string => "'" + String(s).replace(/'/g, "'\\''") + "'";
function flowCommands(jsPath: string, name: string, cwd: string, example: string): FlowCmds {
  const p = String(jsPath || '');
  const nm = String(name || '').trim() || 'untitled';
  const ex = String(example || '').trim() || "'<输入>'";            // 没写示例就留占位,不假装知道参数
  const common = `scriptPath: ${flowSq(p)}, args: ${ex}`;
  const proj = String(cwd || '').replace(/\/+$/, '') + '/.claude/workflows/' + nm + '.js';
  return {
    first: `Workflow({ ${common} })`,
    resume: `Workflow({ ${common}, resumeFromRunId: 'wf_…' })`,
    // 个人位置必须用 "$HOME/…":单引号里的 ~ 不会被 shell 展开(项目位置是绝对路径,单引号即可)
    dist: `cp ${flowSq(p)} ${flowSq(proj)}\ncp ${flowSq(p)} "$HOME/.claude/workflows/${nm}.js"`,
  };
}

// 字符串 → 沙箱安全的 JS 字面量。转义集 = \ ` ${ 三件全覆盖(不变式,单测钉死);
// 无占位符且单行 → JSON 字符串(免模板字面量噪音);含 {{nX}} 或换行 → 模板字面量。
// ctx.prev = 上一级(单节点级)的节点 id:在 map 链里引用它 = 回调的 prevResult。
// item/index 是 map 链专有变量(回调签名 (prevResult, originalItem, index)),链外由 flowValidate 拦下。
function flowLiteral(fs: FlowDraft, text: string, ctx?: { prev?: Set<string> }): string {
  const startId = fs.nodes.find(n => n.type === 'start')?.id;
  const s = String(text ?? '');
  if (!FLOW_REF_PROBE.test(s) && !s.includes('\n')) return JSON.stringify(s);
  const body = s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
    .replace(FLOW_REF_RE, (_m: string, id: string) => {
      if (id === 'item') return '${item}';
      if (id === 'index') return '${i}';
      if (ctx?.prev?.has(id)) return '${prev}';
      return '${' + (id === 'start' || id === startId ? 'Q' : id) + '}';
    });
  return '`' + body + '`';
}

// 前置条件:flowValidate(fs) 为空。抛 Error 仅限内部 bug(常规错误走 flowValidate)。
function flowGenerate(fs: FlowDraft): string {
  const errs = flowValidate(fs);
  if (errs.length) throw new Error(errs.join('\n'));
  const { groups } = flowLevels(fs);
  const byId = (id: string): FlowNode | undefined => fs.nodes.find(n => n.id === id);
  const starts = fs.nodes.filter(n => n.type === 'start'), terms = fs.nodes.filter(n => n.type === 'return');
  const metaPhases = flowMetaPhases(fs);
  // map 链 / 分支区域:区域内节点由 pipeline 回调或 if/else 块内部消化,不再作为顶层语句出现
  const chains = flowMapChains(fs);
  const branches = flowBranchRegions(fs);
  const loops = flowLoopRegions(fs);
  const innerAll = new Set<string>();
  for (const c of chains.values()) c.inner.forEach(id => innerAll.add(id));
  for (const b of branches.values()) b.inner.forEach(id => innerAll.add(id));
  for (const l of loops.values()) l.inner.forEach(id => innerAll.add(id));
  const lines: string[] = [];
  lines.push(`// 由 Lucid 编排器生成 —— 目标项目: ${fs.cwd || '(未填)'}`);
  lines.push(`// 用法: cd 目标项目 && Workflow({ scriptPath: '<本文件路径>', args: '<输入>' })`);
  lines.push('export const meta = {');
  lines.push(`  name: ${JSON.stringify(fs.name || 'untitled')},`);
  lines.push(`  description: ${JSON.stringify(fs.desc || '')},`);
  // whenToUse 与 detail 都是"有才出"(空字段落码 = v1 草稿产物漂移,零 diff 断言钉死)
  const wtu = String(fs.whenToUse ?? '');
  if (wtu.trim()) lines.push(`  whenToUse: ${JSON.stringify(wtu)},`);
  lines.push(`  phases: [${metaPhases.map(p => (p.detail ? `{ title: ${JSON.stringify(p.title)}, detail: ${JSON.stringify(p.detail)} }` : `{ title: ${JSON.stringify(p.title)} }`)).join(', ')}],`);
  lines.push('}');
  for (const id of groups.flat()) {
    const n = byId(id);
    if (n?.type === 'agent' && String(n.data.schemaText || '').trim()) lines.push(`const SCHEMA_${id} = ${String(n.data.schemaText).trim()}`);
  }
  // args 契约(PRD §5.3):有声明才出解析块;勾了必填才出前置校验。**解析块必须早于任何 agent 调用**
  // (参数不合法就别开始烧 token)。Q 从 ARGS 派生 → 对象 args 与字符串化 JSON args 落到同一个入口。
  const aspec = flowArgsSpec(fs);
  const hasArgs = !!(aspec.schemaText.trim() || aspec.required);
  if (hasArgs) {
    lines.push(`const ARGS = (typeof args === 'string') ? JSON.parse(args) : args`);
    if (aspec.required) {
      lines.push(`if (!ARGS || typeof ARGS !== 'object') throw new Error(${JSON.stringify('缺少 args(需要对象)')})`);
      const sch = aspec.schemaText.trim() ? JSON.parse(aspec.schemaText) as { required?: unknown } : null;
      const req = (Array.isArray(sch?.required) ? sch!.required as unknown[] : []).filter((k): k is string => typeof k === 'string');
      // 标识符键写 ARGS.x(生成物给人读),其余走 ARGS["a-b"](不假设键名合法)
      for (const k of req) {
        const ref = /^[A-Za-z_$][\w$]*$/.test(k) ? `ARGS.${k}` : `ARGS[${JSON.stringify(k)}]`;
        lines.push(`if (typeof ${ref} === 'undefined') throw new Error(${JSON.stringify('args 缺少字段:' + k)})`);
      }
    }
  }
  // 前置 phase() 用**推导**首项,不是阶段带首项:它声明的是"其后 agent 归入哪组",必须与 agent.phase 同名;
  // 用阶段带标题会凭空多出一个空进度组(阶段带是 meta.phases 的元数据,不改变执行语义)。
  const prelude = flowDerivedPhases(fs)[0]?.title || '';
  lines.push(`phase(${JSON.stringify(prelude)})`);
  lines.push(`const Q = ${hasArgs ? "(typeof ARGS === 'string' && ARGS.trim()) || " : "(typeof args === 'string' && args.trim()) || "}${starts[0]?.data.note ? JSON.stringify(String(starts[0].data.note)) : "''"}`);
  let curPhase = prelude;
  // opts 拼装单点(label/phase/model/schema);map 链的级一律 usePhase=true(pipeline 内不许靠全局 phase() 状态)
  const opt = (n: FlowNode, usePhase: boolean, ctx?: { prev?: Set<string> }): string => {
    const o = [`label: ${flowLiteral(fs, String(n.data.label || n.id), ctx)}`];
    if (usePhase && n.data.phase) o.push(`phase: ${JSON.stringify(n.data.phase)}`);
    if (n.data.model) o.push(`model: ${JSON.stringify(String(n.data.model))}`);
    if (String(n.data.schemaText || '').trim()) o.push(`schema: SCHEMA_${n.id}`);
    return `{ ${o.join(', ')} }`;
  };
  const call = (n: FlowNode, usePhase: boolean, ctx?: { prev?: Set<string> }): string =>
    `agent(${flowLiteral(fs, String(n.data.prompt || ''), ctx)}, ${opt(n, usePhase, ctx)})`;
  // pipeline 表达式(官方范式):每级一个回调,签名统一 (prev, item, i);扇出级返回 parallel([…])
  const pipeExpr = (c: MapChain): string => {
    const parts = c.stages.map((lv, i) => {
      const ctx = { prev: new Set(i > 0 ? c.stages[i - 1] : []) };
      if (lv.length === 1) return `(prev, item, i) => ${call(byId(lv[0])!, true, ctx)}`;
      return `(prev, item, i) => parallel([${lv.map(id => `() => ${call(byId(id)!, true, ctx)}`).join(', ')}])`;
    });
    return `pipeline(${String(byId(c.mapId)!.data.items || '').trim()}, ${parts.join(', ')})`;
  };
  // 分支区域出码:区域内的级在块里跑,末级结果赋给 merge 变量(无 merge 则留给块外 return)
  const emitRegion = (levels: string[][], target: string | null, indent: string): void => {
    if (!levels.length) { if (target) lines.push(`${indent}${target} = null;`); return; }   // 空区域(分支直接汇合)
    levels.forEach((lv, i) => {
      const last = i === levels.length - 1;
      // 分支区域是**块作用域**:引用同区域内更早的节点用真实变量名(不是 pipeline 回调的 prev)
      const decl = last && target ? `${target} = ` : (lv.length === 1 ? `const ${lv[0]} = ` : `const [${lv.join(', ')}] = `);
      if (lv.length === 1) lines.push(`${indent}${decl}await ${call(byId(lv[0])!, true)}`);
      else {
        lines.push(`${indent}${decl}await parallel([`);
        lines.push(...lv.map(id => `${indent}  () => ${call(byId(id)!, true)},`));
        lines.push(`${indent}])`);
      }
    });
  };
  for (const g of groups) {
    if (!g) continue;
    const live = g.filter(id => !innerAll.has(id));
    if (!live.length) continue;
    for (const id of live) if (byId(id)?.type === 'map') lines.push(`const ${id} = await ${pipeExpr(chains.get(id)!)}`);
    for (const id of live) {
      const lp = loops.get(id);
      if (!lp) continue;
      lines.push(`let ${id};`);
      lines.push('{');                                        // 块作用域:多个循环各自的 round 不打架
      lines.push('  let round = 0;');
      lines.push(`  while ((${lp.cond}) && round < ${lp.maxRounds}) {`);
      if (lp.budgetGuard) lines.push(`    if (budget.total && budget.remaining() < ${FLOW_BUDGET_FLOOR}) { log('预算将尽,提前收束'); break }`);
      lines.push('    round++;');
      emitRegion(lp.stages, id, '    ');
      lines.push('  }');
      lines.push('}');
    }
    for (const id of live) {
      const b = branches.get(id);
      if (!b) continue;
      if (b.merge) lines.push(`let ${b.merge};`);
      lines.push(`if (${b.cond}) {`);
      emitRegion(b.tStages, b.merge, '  ');
      lines.push('} else {');
      emitRegion(b.fStages, b.merge, '  ');
      lines.push('}');
    }
    const ags = live.map(byId).filter((n): n is FlowNode => !!n && n.type === 'agent');
    if (!ags.length) continue;                                        // start / return / map 层不再出 agent 代码
    const ph = ags[0].data.phase || ags[0].data.label || '';
    if (ph && ph !== curPhase) { lines.push(`phase(${JSON.stringify(ph)})`); curPhase = ph; }
    if (ags.length === 1) lines.push(`const ${ags[0].id} = await ${call(ags[0], false)}`);
    else {
      lines.push(`const [${ags.map(n => n.id).join(', ')}] = await parallel([`);
      lines.push(...ags.map(n => `  () => ${call(n, true)},`));
      lines.push('])');
    }
  }
  // 兜底 return 取"最后一个**含 agent** 的层"——末层通常就是 Return 节点本身,直接取它会生成
  // `results: []`(空返回,用户以为产物丢了)。PoC 同款踩坑,由本条断言钉住。
  const lastAgentGroup = [...groups].reverse().find(g => (g || []).some(id => byId(id)?.type === 'agent')) || [];
  const lastVars = lastAgentGroup.filter(id => byId(id)?.type === 'agent');
  const ret = String(terms[0]?.data.ret || '').trim() || `{ results: [${lastVars.join(', ')}].filter(Boolean) }`;
  lines.push(`return ${ret}`);
  const js = lines.join('\n') + '\n';
  if (FLOW_SANDBOX_BANNED.test(js)) throw new Error('生成结果含沙箱禁用调用(内部 bug)');
  return js;
}
