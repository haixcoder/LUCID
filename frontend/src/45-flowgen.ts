// ── 45-flowgen.ts:图 → Workflow 执行件的生成器(纯函数,零 DOM,零 vendor 依赖)──
// 语义映射(§6 验收表,保守可审计;X3 之前不生成 pipeline/循环/条件——宁可少生成,不可错生成):
//   拓扑层(最长路径分层) = 一个 await 点;层内单 agent = 顺序 await,层内多 agent = parallel 栅栏(每个带 opts.phase);
//   {{nX}} 占位符 → 模板字面量 ${nX}(start 节点 → ${Q});phase 序列 = 各 agent 的 phase 首现去重 → meta.phases;
//   schemaText → 顶部 const SCHEMA_vX 字面量 + opts.schema;return.ret 空 → 兜底 { results: [末层变量].filter(Boolean) }。
// 三个口径各住唯一函数:flowValidate(错误清单)/ flowMetaPhases(phase 首现去重)/ flowGenerate(出码)——UI 与测试都只调它们。
const FLOW_MODEL_OK = ['sonnet', 'opus', 'haiku', 'fable', 'mythos'];   // agent(opts.model) 档位白名单;'' = inherit
// model 合法性判定**单点**(agent.data.model 与 meta.phases[].model 共用,1.2.63):返回"不合法的原文"或 ''
// (空 = 合法或没填——空值一律放行,落码时也一律不出键)。报错文案由各调用方拼,判定只此一处。
function flowModelBad(md: unknown): string {
  const m = String(md ?? '').trim();
  return (m && !FLOW_MODEL_OK.includes(m) && !/^claude-[a-z0-9.:-]+$/i.test(m)) ? m : '';
}
// 会产出 `agent()` 调用的节点型(1.2.64):agent 节点 + **map 节点自身**(map 链的级 1 就是它,
// 走同一个 opt()/call())。SCHEMA_ 常量、schema/model/effort/retry 校验、字段芯片三处共用这一个判定——
// 旧实现只认 type==='agent',导致"map 带 schema"会生成引用未定义 SCHEMA_<id> 的脚本。
function flowIsAgentNode(n: FlowNode | undefined): boolean {
  return !!n && (n.type === 'agent' || n.type === 'map');
}
// ⚠ 共享带 /g 的正则做 .test()/.exec() 会留下 lastIndex 状态(同一正则被两个调用方交错使用即漏判)——
// 因此探测用无 g 的 FLOW_REF_PROBE,枚举用 matchAll(自带独立迭代状态),替换用带 g 的 replace(结束时自复位)。
// 1.2.60 起占位符带**可选字段路径**(字段选择):{{n2.title}} / {{n2.tags[0]}} / {{item.name}}。
// 路径段白名单 = 标识符或数字下标 —— 生成物是 JS 源码,白名单即注入防线(别放宽成任意字符)。
// 三件套同一形状:PROBE(无 g,探测)、RE(带 g,枚举/替换)、FULL(整串判定合规);LIKE 抓"形似引用"。
// ⚠ 路径必须**捕获**(m[2]):`((?:…)*)` 的括号在重复组外层——写成 (?:…) 会让 m[2] 恒为 undefined,
// 三个字段引用会被当成同一个"整节点引用"(1.2.60 实现期实际踩到,报错信息里路径整段消失)。
const FLOW_REF_PATH = '((?:\\.[A-Za-z_$][\\w$]*|\\[\\d+\\])*)';
const FLOW_REF_PROBE = new RegExp('\\{\\{(n\\d+|start|item|index)' + FLOW_REF_PATH + '\\}\\}');
const FLOW_REF_RE = new RegExp('\\{\\{(n\\d+|start|item|index)' + FLOW_REF_PATH + '\\}\\}', 'g');
const FLOW_REF_FULL = new RegExp('^\\{\\{(n\\d+|start|item|index)' + FLOW_REF_PATH + '\\}\\}$');
const FLOW_REF_LIKE = /\{\{(n\d+|start|item|index)[^}]*\}\}/g;   // 形似引用(含不合规的):用 FULL 判合规,不合规必须报错——不许再静默当字面量
const FLOW_SANDBOX_BANNED = /Date\.now\(\)|Math\.random\(\)|new Date\(\)/;   // 沙箱禁用且破坏 resume
const FLOW_BUDGET_FLOOR = 50000;
const FLOW_EFFORT_OK = ['low', 'medium', 'high', 'xhigh', 'max'];   // agent(opts.effort) 五档(官方技能)
const FLOW_RETRY_BASE = 1000;          // 退避基数默认值(ms)       // loop 预算守卫阈值(AD-4):剩余预算低于它就提前收束并 log

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
      // merge 一律是区域终点(哪怕只有 1 条入边)——它是用户"显式结束本区域"的把手
      if (node.type === 'return' || node.type === 'merge' || (inn.get(s) || []).length > 1) { exits.push(s); break; }
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
interface MapChain { mapId: string; stages: string[][]; inner: Set<string>; exitMerge: string | null; errs: string[] }
function flowMapChain(fs: FlowDraft, mapId: string): MapChain {
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const stages: string[][] = [], inner = new Set<string>(), errs: string[] = [];   // inner 不含 map 自己(它负责出码)
  if (String(byId.get(mapId)?.data.prompt || '').trim()) stages.push([mapId]);
  const w = flowWalkStages(fs, mapId, `节点 ${mapId} 的 map 链`);
  stages.push(...w.stages); w.inner.forEach(id => inner.add(id)); errs.push(...w.errs);
  // 链止于 merge(用户显式结束区域的把手):把 merge 别名成 pipeline 的结果,下游 {{merge}} 才拿得到
  const exit = w.exits.length === 1 ? w.exits[0] : null;
  const exitMerge = exit && byId.get(exit)?.type === 'merge' ? exit : null;
  return { mapId, stages, inner, exitMerge, errs };
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
  const branches = flowBranchRegions(fs);
  const mult = (id: string): number => { let m = 1; for (const lp of loops.values()) if (lp.inner.has(id)) m *= lp.maxRounds; return m; };
  const armSum = (stages: string[][]): number => {
    let s = 0;
    for (const st of stages) for (const id of st) { const n = fs.nodes.find(x => x.id === id); if (n?.type === 'agent') s += mult(id); }
    return s;
  };
  // 分支区域按臂取 max(1.2.64):if/else 只跑一条臂,求和会系统高估
  const inBranch = new Set<string>();
  let total = 0;
  for (const b of branches.values()) { b.inner.forEach(id => inBranch.add(id)); total += Math.max(armSum(b.tStages), armSum(b.fStages)); }
  for (const n of fs.nodes) { if (n.type !== 'agent' || inBranch.has(n.id)) continue; total += mult(n.id); }
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

// ── code 片段扫描(Phase 8)────────────────────────────────────────────────
// 把字符串/注释换成等长空白(保留偏移,便于按原样报错)。正则字面量**不识别**——那正是"无法判定"的来源:
// 命中但扫描器说它在字面量里 → 降级为警告(宁可漏报,不可误杀合法片段)。
function flowStripLiterals(src: string): string {
  const s = String(src || '');
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') {
      out += '  '; i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; }
      if (i < s.length) { out += '  '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += ' '; i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') { out += ' '; i++; if (i < s.length) { out += s[i] === '\n' ? '\n' : ' '; i++; } continue; }
        out += s[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < s.length) { out += ' '; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}
// 脚本沙箱的全局白名单(技能原文 + JS 内建)。**不是**穷举——未知全局只警告不拦。
const FLOW_GLOBALS = new Set(['agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', 'args',
  'console', 'setTimeout', 'clearTimeout', 'Promise', 'JSON', 'Math', 'Array', 'Object', 'String', 'Number',
  'Boolean', 'Set', 'Map', 'WeakMap', 'RegExp', 'Symbol', 'BigInt', 'Error', 'TypeError', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'undefined', 'null', 'true', 'false', 'NaN', 'Infinity']);
const FLOW_KEYWORDS = new Set(['return', 'const', 'let', 'var', 'function', 'if', 'else', 'for', 'while', 'do', 'break',
  'continue', 'new', 'typeof', 'instanceof', 'in', 'of', 'this', 'await', 'async', 'try', 'catch', 'finally', 'throw',
  'class', 'extends', 'super', 'switch', 'case', 'default', 'delete', 'void', 'yield', 'static', 'get', 'set', 'import', 'export']);
// 确定性/导入禁令:只对**去掉字符串与注释**的片段判定(命中在字面量里 → 降级警告)
function flowCodeErrs(id: string, code: string): string[] {
  const raw = String(code || '');
  const clean = flowStripLiterals(raw);
  const errs: string[] = [];
  if (!raw.trim()) errs.push(`节点 ${id} 的 code 片段为空`);
  if (/import\s*\(/.test(clean)) errs.push(`节点 ${id} 的 code 片段含 import( —— 沙箱禁动态导入,运行前就会失败`);
  if (FLOW_SANDBOX_BANNED.test(clean)) errs.push(`节点 ${id} 的 code 片段含沙箱禁用调用(Date.now()/Math.random()/new Date())——会破坏 resume 可重放`);
  return errs;
}
function flowCodeWarns(fs: FlowDraft, id: string, code: string): string[] {
  const raw = String(code || ''), clean = flowStripLiterals(raw), warns: string[] = [];
  if (!FLOW_SANDBOX_BANNED.test(clean) && FLOW_SANDBOX_BANNED.test(raw)) {
    warns.push(`节点 ${id} 的 code 片段里出现确定性禁用调用,但可能在字符串/注释里——无法判定,仅提示`);
  }
  const declared = new Set<string>(fs.nodes.map(n => n.id));
  for (const m of clean.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of clean.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]);
  for (const m of clean.matchAll(/(?:function\s*[A-Za-z_$]?[\w$]*\s*)?\(([^)]*)\)\s*(?:=>|\{)/g)) {
    for (const p of m[1].split(',')) { const t = p.trim().replace(/=.*$/, '').trim(); if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t); }
  }
  const unknown = new Set<string>();
  for (const m of clean.matchAll(/([A-Za-z_$][\w$]*)/g)) {
    const w = m[1], at = m.index || 0;
    if (FLOW_GLOBALS.has(w) || FLOW_KEYWORDS.has(w) || declared.has(w)) continue;
    if (at > 0 && clean[at - 1] === '.') continue;                 // 属性访问
    if (clean[at + w.length] === ':') continue;                    // 对象键
    unknown.add(w);
  }
  for (const w of unknown) warns.push(`节点 ${id} 的 code 片段用了未知全局「${w}」——不在脚本白名单/内建/本片段声明内;若是上游节点的结果请写 {{nX}}`);
  return warns;
}
// 警告单点(与 flowValidate 同一次调用并列的第二类结果:错误拦生成,警告只提示)。
// 两类来源:code 片段的未知全局 + 引用诊断里的"疑似取不到值"(flowRefIssues 同一次扫描产出)。
function flowWarnings(fs: FlowDraft): string[] {
  const out: string[] = [];
  for (const n of fs.nodes) if (n.type === 'code') out.push(...flowCodeWarns(fs, n.id, String(n.data.code || '')));
  out.push(...flowRefIssues(fs, flowMapChains(fs), flowBranchRegions(fs), flowLoopRegions(fs)).warns);
  out.push(...flowPhaseBandWarns(fs));                       // 1.2.64:阶段带与 phase() 失配
  return out;
}
// subflow 引用校验(Phase 8):ref 必填;按名引用时查草稿列表 + 嵌套深度;路径引用不做存在性检查。
function flowSubflowErrs(fs: FlowDraft, ctx?: FlowCtx): string[] {
  const errs: string[] = [];
  for (const n of fs.nodes) {
    if (n.type !== 'subflow') continue;
    const ref = String(n.data.ref || '').trim();
    if (!ref) { errs.push(`节点 ${n.id} 的 subflow 缺少 ref(已保存的工作流名或脚本路径)`); continue; }
    if (/^[./~]/.test(ref) || /\.js$/.test(ref)) continue;
    if (!ctx || !ctx.drafts) continue;
    const hit = ctx.drafts.find(x => x.name === ref);
    if (!hit) { errs.push(`节点 ${n.id} 引用的工作流「${ref}」不存在(当前项目已保存的草稿里没有它)`); continue; }
    if (hit.nested) errs.push(`节点 ${n.id} 引用的「${ref}」内部还有 subflow:子流只允许一层(运行期会抛)`);
  }
  return errs;
}

// 字段路径 → JS 访问表达式(单点):{{n2.a.b}} → ?.a?.b,{{n2.list[0]}} → ?.list?.[0]。
// 全程可选链:上游 agent 被跳过 / 终止性 API 错误时返回 null(官方语义),取字段不该把整张图炸掉
// (代价是拿到 "undefined" —— 比 ReferenceError 好,也比 [object Object] 诚实)。
function flowPathExpr(path: string): string {
  return String(path || '').replace(/\.([A-Za-z_$][\w$]*)/g, '?.$1').replace(/\[(\d+)\]/g, '?.[$1]');
}
// 上游可达集(单点:占位符引用与"汇聚等待"判定都靠它)。
// ⚠ 不能用"带 trail 的递归 + memo":trail 会在遇到回边时截断探索,而截断结果被 memo 缓存后
// 会污染后续查询(1.2.58 全节点夹具实测:循环体节点 n10 查上游 n8 被缓存成空集 → 误报"不是它的上游")。
// 改为按节点独立做可达性(visited 集自带环保护),规模 ≤ 数百节点,代价可忽略。
function flowUpstream(fs: FlowDraft): Map<string, Set<string>> {
  const { inn } = flowAdj(fs);
  const out = new Map<string, Set<string>>();
  for (const n of fs.nodes) {
    const acc = new Set<string>(), stack = [...(inn.get(n.id) || [])];
    while (stack.length) {
      const p = stack.pop()!;
      if (p === n.id || acc.has(p)) continue;   // 自身不算上游;acc 兼作环保护
      acc.add(p);
      for (const q of inn.get(p) || []) stack.push(q);
    }
    out.set(n.id, acc);
  }
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

// 引用诊断单点(1.2.60 起同时产出**错误与警告**,铁律 8:同一口径只此一处)。
// 扫的模板字段 = 真正会过 flowLiteral 的那几个:agent/map 的 prompt 与 label、log 的 text。
// 字段选择(1.2.60)新增四类判定:
//   ① 形似引用但不合规({{n2.1bad}} / {{n2 .t}})→ 错误(旧实现原样当字面量喂给子代理,静默坏);
//   ② {{nX}} 指向声明了 schema 的节点 → 错误(模板字符串会把对象变成 [object Object],静默坏);
//   ③ start/index 取字段 → 错误(它们不是对象);④ 取字段但上游没有 schema / 字段名不在 properties → 警告。
function flowRefIssues(fs: FlowDraft, chains: Map<string, MapChain>, branches: Map<string, BranchRegion>, loops: Map<string, LoopRegion>): { errs: string[]; warns: string[] } {
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const up = flowUpstream(fs);
  const startId = fs.nodes.find(n => n.type === 'start')?.id;
  const regionOf = flowRegionOf(chains, branches, loops);
  const errs: string[] = [], warns: string[] = [];
  for (const n of fs.nodes) {
    const texts = n.type === 'log' ? [String(n.data.text || '')]
      : (n.type === 'agent' || n.type === 'map') ? [String(n.data.prompt || ''), String(n.data.label || '')] : [];
    if (!texts.length) continue;
    const own = regionOf.get(n.id);
    const chain = n.type === 'map' ? (chains.get(n.id) || null) : (own?.kind === 'map' ? chains.get(own.id)! : null);
    for (const text of texts) {
      for (const m of text.matchAll(FLOW_REF_LIKE)) {                // ① 形似引用但不合规:必须报错,不许静默
        if (!FLOW_REF_FULL.test(m[0])) errs.push(`节点 ${n.id} 的占位符 ${m[0]} 无法识别(只支持 {{nX}} / {{nX.字段}} / {{item.字段}} / {{index}} / {{start}})`);
      }
      const seen = new Set<string>();
      for (const m of text.matchAll(FLOW_REF_RE)) {
        const ref = m[1], path = m[2] || '';
        if (seen.has(m[0])) continue;                                 // 同一文本里重复出现只报一次
        seen.add(m[0]);
        if (ref === 'item' || ref === 'index') {                      // 只在 map 链的级里有意义
          if (!chain) { errs.push(`节点 ${n.id} 的 {{${ref}${path}}} 只能在 map 链内使用`); continue; }
          if (path && ref === 'index') errs.push(`节点 ${n.id} 的 {{index${path}}} 不合法:index 是数字,没有字段`);
          continue;
        }
        const target = ref === 'start' ? startId : ref;
        if (!target || !byId.has(target)) { errs.push(`节点 ${n.id} 引用了不存在的节点 {{${ref}${path}}}`); continue; }
        if (target === n.id) { errs.push(`节点 ${n.id} 引用了自身 {{${ref}${path}}}`); continue; }
        let bad = false;
        if (chain && chain.mapId !== n.id) {                          // map 链内:只有"上一级"的结果拿得到(回调的 prev)
          const si = chain.stages.findIndex(lv => lv.indexOf(n.id) >= 0);
          const prevLv = si > 0 ? chain.stages[si - 1] : [];
          const tgtRegion = regionOf.get(target);
          if (tgtRegion || target === chain.mapId) {                  // 链内节点(含 map 自身)只许当"上一级"用
            if (prevLv.indexOf(target) < 0) { errs.push(`节点 ${n.id} 在 ${chain.mapId} 的 map 链内,只能引用上一级的结果 {{${ref}${path}}}`); bad = true; }
          } else if (!(up.get(n.id)?.has(target))) { errs.push(`节点 ${n.id} 的 {{${ref}${path}}} 不是它的上游(连不到 = 拿不到结果)`); bad = true; }
        } else {
          const tgtRegion = regionOf.get(target);
          if (tgtRegion && (!own || own.kind !== tgtRegion.kind || own.id !== tgtRegion.id)) {
            // 区域外引用:map 链内变量只活在回调闭包,pipeline 自身的结果也要等它算完
            errs.push(tgtRegion.kind === 'map'
              ? `节点 ${n.id} 引用了 map 链内的节点 {{${ref}${path}}}(链内变量只在 pipeline 回调里存在)`
              : tgtRegion.kind === 'loop'
                ? `节点 ${n.id} 引用了循环体内的节点 {{${ref}${path}}}(循环体变量在循环外不可见,请引用 loop 节点自身)`
                : `节点 ${n.id} 引用了分支区域内的节点 {{${ref}${path}}}(块作用域变量在分支外不可见,请用 merge 汇合)`);
            bad = true;
          } else if (!(up.get(n.id)?.has(target))) { errs.push(`节点 ${n.id} 的 {{${ref}${path}}} 不是它的上游(连不到 = 拿不到结果)`); bad = true; }
        }
        if (bad) continue;
        // ②③④ 字段规则(仅在引用本身合法时判,免得在一条错误上再叠三条噪音)
        const tgt = byId.get(target)!;
        if (path && tgt.type === 'start') { errs.push(`节点 ${n.id} 的 {{${ref}${path}}} 不合法:Start 是文本入口,没有字段`); continue; }
        if (tgt.type !== 'agent') continue;
        const props = flowSchemaProps(String(tgt.data.schemaText || ''));
        if (!path) {
          if (props) errs.push(`节点 ${n.id} 的 {{${ref}}} 指向声明了 schema 的节点 ${ref}(返回对象):模板里只会得到 [object Object],请改用 {{${ref}.字段}} 选择字段`);
          continue;
        }
        if (!props) { warns.push(`节点 ${n.id} 的 {{${ref}${path}}} 取了字段,但节点 ${ref} 没有声明 schema(返回文本)——可能拿不到值`); continue; }
        const first = /^\.([A-Za-z_$][\w$]*)/.exec(path)?.[1] || '';
        if (first && !Object.prototype.hasOwnProperty.call(props, first)) {
          warns.push(`节点 ${n.id} 的 {{${ref}${path}}} 字段「${first}」不在节点 ${ref} 的 schema properties 内(可能拼错;嵌套字段不查)`);
        }
      }
    }
  }
  return { errs, warns };
}

// args 契约读取单点(缺省 = 全空,不猜不塞)——生成器、校验器、UI 都从这里取
function flowArgsSpec(fs: FlowDraft): FlowArgsSpec {
  const a = fs.argsSpec || ({} as Partial<FlowArgsSpec>);
  return { schemaText: String(a.schemaText ?? ''), exampleText: String(a.exampleText ?? ''), required: !!a.required };
}
// schema.properties 单点(字段校验的警告与编辑器「字段选择」芯片共用):不可解析/无 properties → null
// (null ≠ "没有字段"——只是"判定不了",所以调用方一律降级为不提示,不假装知道)。
function flowSchemaProps(text: string): Record<string, unknown> | null {
  const t = String(text || '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as { properties?: unknown };
    const p = j && typeof j === 'object' && !Array.isArray(j) ? j.properties : null;
    return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : null;
  } catch { return null; }
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
function flowValidate(fs: FlowDraft, ctx?: FlowCtx): string[] {
  const errs: string[] = [];
  const starts = fs.nodes.filter(n => n.type === 'start'), terms = fs.nodes.filter(n => n.type === 'return');
  const agents = fs.nodes.filter(n => n.type === 'agent');
  if (!starts.length) errs.push('缺 Start 节点(生成脚本的 args 入口)');
  if (!terms.length) errs.push('缺 Return 节点(生成脚本的产出)');
  // "执行步骤" = 会真的产生调用的节点型;纯 start/return/log 的图没有意义(1.2.57 起含 code/subflow)
  if (!fs.nodes.some(n => n.type === 'agent' || n.type === 'map' || n.type === 'code' || n.type === 'subflow'))
    errs.push('至少需要一个执行步骤(Agent / Map / Code / Subflow)');
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
  errs.push(...flowRefIssues(fs, chains, branches, loops).errs);
  // ── 载荷:code / subflow(Phase 8)──
  for (const n of fs.nodes) if (n.type === 'code') errs.push(...flowCodeErrs(n.id, String(n.data.code || '')));
  errs.push(...flowSubflowErrs(fs, ctx));
  for (const n of fs.nodes) if (flowIsAgentNode(n)) errs.push(...flowSchemaErrs(`节点 ${n.id} 的 schema`, String(n.data.schemaText || '')));
  const aspec = flowArgsSpec(fs);
  errs.push(...flowSchemaErrs('args 的 schema', aspec.schemaText));
  const ex = aspec.exampleText.trim();
  if (ex) {
    try { JSON.parse(ex); }
    catch (e) { errs.push(`args 示例不是合法 JSON:${String((e as Error).message || '')}`); }
  }
  // meta.phases[].model(1.2.63):阶段元数据,但写错同样会误导——与 agent.model 同一白名单、同一判定单点
  for (const p of (Array.isArray(fs.phases) ? fs.phases : [])) {
    const bad = flowModelBad(p?.model);
    if (bad) errs.push(`阶段「${String(p?.title ?? '').trim() || '未命名'}」的 model「${bad}」不在白名单`);
  }
  for (const n of fs.nodes.filter(flowIsAgentNode)) {         // 1.2.64:map 的级 1 也是 agent 调用,选项同样受校验
    const md = flowModelBad(n.data.model);
    if (md) errs.push(`节点 ${n.id} 的 model「${md}」不在白名单`);
    const ef = String(n.data.effort || '');
    if (ef && !FLOW_EFFORT_OK.includes(ef)) errs.push(`节点 ${n.id} 的 effort「${ef}」不在白名单(${FLOW_EFFORT_OK.join('/')})`);
    for (const [k, v, min] of [['retryN', n.data.retryN, 0], ['retryMs', n.data.retryMs, 0]] as [string, unknown, number][]) {
      if (v === undefined || v === null || String(v).trim() === '') continue;
      if (!Number.isInteger(Number(v)) || Number(v) < min) errs.push(`节点 ${n.id} 的 ${k} 必须是 ≥${min} 的整数(收到 ${JSON.stringify(v)})`);
    }
  }
  return errs;
}

// 生成物里**实际会出现的进度组名**(单点,1.2.64;阶段带推导与"阶段带失配"警告共用):
// ① 每个含 agent 的层发一条 phase(<该层首个 agent 的 phase||label>)——生成器的 phase() 就是这么发的;
// ② agent/map 的显式 opts.phase **恒发**(1.2.56,不依赖全局 phase() 状态),故每个显式 phase 也算一组
//    (map 节点的级 1 是 agent 调用,它的 phase 同样成立——旧实现只数 type==='agent',会漏掉 map 的组)。
// 顺序 = 层序 → 层内序,与生成物里 phase 首次出现的顺序一致(阶段带留空时的推导顺序依赖它)。
function flowPhaseGroups(fs: FlowDraft): string[] {
  const { groups } = flowLevels(fs);
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const seen: string[] = [];
  const add = (s: unknown): void => { const t = String(s ?? '').trim(); if (t && !seen.includes(t)) seen.push(t); };
  for (const g of groups) {
    const ags = g.map(id => byId.get(id)).filter((n): n is FlowNode => !!n && n.type === 'agent');
    if (ags.length) add(ags[0].data.phase || ags[0].data.label);
    for (const id of g) { const n = byId.get(id); if (n && (n.type === 'agent' || n.type === 'map')) add(n.data.phase); }
  }
  return seen;
}
// 推导口径(阶段带留空时用它):= 生成物会出现的组名(1.2.43 起不变;1.2.64 起住 flowPhaseGroups 单点)
function flowDerivedPhases(fs: FlowDraft): FlowPhase[] {
  return flowPhaseGroups(fs).map(title => ({ title }));
}
// 阶段带 ↔ phase() 同名性(1.2.64):phase()/opts.phase 由 agent 的 phase||label 推导,而 meta.phases 来自
// 阶段带——两边不同名时,运行期会多出一个空进度组(官方语义:声明了的 title 照样出组,不匹配的 phase() 自成一组)。
// 只对**显式**阶段带判定(推导清单天然同名);双向各一条,不拦生成(阶段带本来就允许先行命名)。
function flowPhaseBandWarns(fs: FlowDraft): string[] {
  if (!fs.phases || !fs.phases.length) return [];
  const titles = fs.phases.map(p => String(p?.title ?? '').trim()).filter(Boolean);
  const groups = flowPhaseGroups(fs);
  const warns: string[] = [];
  for (const t of titles) if (!groups.includes(t)) warns.push(`阶段带标题「${t}」没有任何 agent/map 的 phase 与它同名——运行期会多出一个空进度组`);
  for (const g of groups) if (!titles.includes(g)) warns.push(`agent/map 的 phase「${g}」不在阶段带里——运行期会多出一个阶段组`);
  return warns;
}
// 阶段带的**显示**清单(唯一实现):显式则原样(含正在编辑的空标题行——行不能边打字边消失),否则推导。
// 与 flowMetaPhases 的差别只是"编辑中"与"落码":后者过滤空标题、全空则回落推导。
function flowBandPhases(fs: FlowDraft): FlowPhase[] {
  const norm = (p: FlowPhase | undefined): FlowPhase => ({ title: String(p?.title ?? ''), detail: String(p?.detail ?? ''), model: String(p?.model ?? '') });
  return fs.phases && fs.phases.length ? fs.phases.map(norm) : flowDerivedPhases(fs).map(norm);
}
// 阶段条目的**存储形态**单点(1.2.63):空 model 不落盘(与"空字段不落码"同一条原则——
// 打开旧草稿再保存不该平白多出 `"model":""`;草稿 JSON 是用户可见产物,加宽要可 diff)。
// 显示形态归 flowBandPhases(它一律补空串,输入框才拿得到 value),两者分工固定。
function flowPhaseRow(p: FlowPhase | undefined): FlowPhase {
  const o: FlowPhase = { title: String(p?.title ?? ''), detail: String(p?.detail ?? '') };
  const md = String(p?.model ?? '').trim();
  if (md) o.model = md;
  return o;
}
// meta.phases 单点(生成与 UI 阶段带共用):**显式阶段带优先,空/全空标题 → 回落推导**。
// 显式 = 用户在阶段带上写过的标题(顺序即用户顺序);推导 = 上面的 flowDerivedPhases。
// detail/model 逐字保留(空则不出该键——空字段落码会让 v1 草稿产物漂移,零 diff 断言钉死)。
// 键序固定 title → detail → model(生成物可 diff;`detail` 空而 `model` 非空时不许把 model 吞掉)。
function flowMetaPhases(fs: FlowDraft): FlowPhase[] {
  const out: FlowPhase[] = [];
  for (const p of flowBandPhases(fs)) {
    if (!p.title.trim()) continue;
    const e: FlowPhase = { title: p.title };
    if (String(p.detail ?? '').trim()) e.detail = p.detail;
    if (String(p.model ?? '').trim()) e.model = p.model;
    out.push(e);
  }
  return out.length ? out : flowDerivedPhases(fs);
}

// ── 运行/分发命令拼装单点(1.2.52,Phase 3)────────────────────────────────────
// 三种形态共用这一处,UI 与测试都只调它。写边界(铁律 2/3):分发只给**用户手动的 cp**——
// 服务从不写 .claude/workflows/;执行、恢复、停止永远在用户终端(/workflows)。
type FlowCmds = { first: string; resume: string; dist: string };
const flowSq = (s: string): string => "'" + String(s).replace(/'/g, "'\\''") + "'";
// projectWritten=true 时项目那份已由服务在保存时写好(1.2.59),分发行只留个人位置的 cp。
function flowCommands(jsPath: string, name: string, cwd: string, example: string, projectWritten = false): FlowCmds {
  const p = String(jsPath || '');
  const nm = String(name || '').trim() || 'untitled';
  const ex = String(example || '').trim() || "'<输入>'";            // 没写示例就留占位,不假装知道参数
  const common = `scriptPath: ${flowSq(p)}, args: ${ex}`;
  const proj = String(cwd || '').replace(/\/+$/, '') + '/.claude/workflows/' + nm + '.js';
  return {
    first: `Workflow({ ${common} })`,
    resume: `Workflow({ ${common}, resumeFromRunId: 'wf_…' })`,
    // 个人位置必须用 "$HOME/…":单引号里的 ~ 不会被 shell 展开(项目位置是绝对路径,单引号即可)
    dist: projectWritten
      ? `cp ${flowSq(p)} "$HOME/.claude/workflows/${nm}.js"`
      : `cp ${flowSq(p)} ${flowSq(proj)}\ncp ${flowSq(p)} "$HOME/.claude/workflows/${nm}.js"`,
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
    .replace(FLOW_REF_RE, (_m: string, id: string, path: string) => {
      // 字段路径(1.2.60):{{n2.title}} → ${n2?.title}。整节点引用(path='')逐字节不变(黄金钉死)。
      const px = flowPathExpr(path || '');
      if (id === 'item') return '${item' + px + '}';
      if (id === 'index') return '${i' + px + '}';
      if (ctx?.prev?.has(id)) return '${prev' + px + '}';
      return '${' + (id === 'start' || id === startId ? 'Q' : id) + px + '}';
    });
  return '`' + body + '`';
}

// 前置条件:flowValidate(fs) 为空。抛 Error 仅限内部 bug(常规错误走 flowValidate)。
function flowGenerate(fs: FlowDraft, ctx?: FlowCtx): string {
  const errs = flowValidate(fs, ctx);
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
  // meta.title(1.2.64):二进制归一化函数 E() 实证 meta 读 5 键 {name,description,title,whenToUse,phases}——
  // title 与 whenToUse 同规矩"有才出"(空字段落码 = v1 草稿产物漂移,零 diff 断言钉死)。
  const ttl = String(fs.title ?? '');
  if (ttl.trim()) lines.push(`  title: ${JSON.stringify(ttl)},`);
  // whenToUse 与 detail 都是"有才出"(空字段落码 = v1 草稿产物漂移,零 diff 断言钉死)
  const wtu = String(fs.whenToUse ?? '');
  if (wtu.trim()) lines.push(`  whenToUse: ${JSON.stringify(wtu)},`);
  // 键序固定 title → detail → model;空键不落码(1.2.63:model 是阶段元数据,detail 空而 model 非空时也照落)
  lines.push(`  phases: [${metaPhases.map(p => `{ ${[`title: ${JSON.stringify(p.title)}`]
    .concat(p.detail ? [`detail: ${JSON.stringify(p.detail)}`] : [])
    .concat(p.model ? [`model: ${JSON.stringify(p.model)}`] : []).join(', ')} }`).join(', ')}],`);
  lines.push('}');
  for (const id of groups.flat()) {
    const n = byId(id);
    if (flowIsAgentNode(n) && String(n!.data.schemaText || '').trim()) lines.push(`const SCHEMA_${id} = ${String(n!.data.schemaText).trim()}`);
  }
  // $retry 助手(全图只生成一次;形状与官方 scan.js 同构:失败 → log 旁白 → 指数退避 → 再试)
  if (fs.nodes.some(n => Number(n.data.retryN || 0) > 0)) {
    lines.push('async function $retry(prompt, opts, n, backoffMs) {');
    lines.push('  let r = await agent(prompt, opts)');
    lines.push('  for (let k = 0; k < n && !r; k++) {');
    lines.push("    const label = (opts.label || 'agent') + ':retry' + (k + 1)");
    lines.push('    log(`${label} 失败,${backoffMs * 2 ** k}ms 后重试`)');
    lines.push('    await new Promise(res => setTimeout(res, backoffMs * 2 ** k))');
    lines.push('    r = await agent(prompt, { ...opts, label })');
    lines.push('  }');
    lines.push('  return r');
    lines.push('}');
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
    if (n.data.effort) o.push(`effort: ${JSON.stringify(String(n.data.effort))}`);
    if (n.data.agentType) o.push(`agentType: ${JSON.stringify(String(n.data.agentType))}`);
    if (n.data.isolation) o.push(`isolation: "worktree"`);      // 官方只有这一个合法值
    if (String(n.data.schemaText || '').trim()) o.push(`schema: SCHEMA_${n.id}`);
    return `{ ${o.join(', ')} }`;
  };
  const call = (n: FlowNode, usePhase: boolean, ctx?: { prev?: Set<string> }): string => {
    const args = `${flowLiteral(fs, String(n.data.prompt || ''), ctx)}, ${opt(n, usePhase, ctx)}`;
    const rn = Number(n.data.retryN || 0);
    if (!(rn > 0)) return `agent(${args})`;
    return `$retry(${args}, ${rn}, ${Number(n.data.retryMs === undefined || n.data.retryMs === '' ? FLOW_RETRY_BASE : n.data.retryMs)})`;
  };
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
    for (const id of live) if (byId(id)?.type === 'map') {
      const c = chains.get(id)!;
      lines.push(`const ${id} = await ${pipeExpr(c)}`);
      if (c.exitMerge) lines.push(`const ${c.exitMerge} = ${id};`);     // 汇合点 = 整条 pipeline 的结果
    }
    for (const id of live) if (byId(id)?.type === 'log') lines.push(`log(${flowLiteral(fs, String(byId(id)!.data.text || ''))})`);
    for (const id of live) if (byId(id)?.type === 'code') {          // 片段原文插入,返回值绑定节点 id
      lines.push(`const ${id} = await (async () => {`);
      lines.push(String(byId(id)!.data.code || ''));
      lines.push('})()');
    }
    for (const id of live) if (byId(id)?.type === 'subflow') {       // 子流:按名或按路径,仅一层
      const ref = String(byId(id)!.data.ref || '').trim();
      const isPath = /^[.\/~]/.test(ref) || /\.js$/.test(ref);
      const refExpr = isPath ? `{ scriptPath: ${JSON.stringify(ref)} }` : JSON.stringify(ref);
      const a = String(byId(id)!.data.argsExpr || '').trim();
      lines.push(`const ${id} = await workflow(${refExpr}${a ? ', ' + a : ''})`);
    }
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
    if (ags.length === 1) lines.push(`const ${ags[0].id} = await ${call(ags[0], true)}`);   // phase 恒发(1.2.56)
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
  // 只对**去掉字符串/注释**的产物判定:code 片段里的 'Date.now()' 是数据不是调用(1.2.57)
  if (FLOW_SANDBOX_BANNED.test(flowStripLiterals(js))) throw new Error('生成结果含沙箱禁用调用(内部 bug)');
  return js;
}

// ═══ 内嵌图 + 反解(1.2.71):让「之前已经构建的工作流」回到画布 ═══════════════════════
// 两条通路,优先级固定:
//   ① 内嵌图——保存草稿时把图 JSON 以注释形式附加在执行件尾部(注释对 Workflow 沙箱是惰性的);
//      项目分发件 / cp 到个人目录 / 跑过的运行副本都带着它,打开即无损还原(含坐标与 args 示例)。
//   ② 反解——更早的脚本没有内嵌,按**生成器文法**反解,再用 flowGenerate(还原图) === 原文 逐字节复核;
//      复核不过一律 null(宁可不还原、只读展示,也不给一张与脚本对不上的假图)。
// 内嵌不放进 flowGenerate:"产物逐字节不变"是黄金快照钉死的不变量,预览里也不该混入 base64 噪音——
// 附加只发生在**保存**这一步(调用方:script = flowGenerate(...) + flowEmbed(draft))。
const FLOW_EMBED_RE = /^\/\/ lucid-graph:(\d+):([A-Za-z0-9+/=]+)[ \t]*$/m;

function flowB64Enc(s: string): string {
  const b = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)) as number[]);
  return btoa(bin);
}
function flowB64Dec(s: string): string {
  const bin = atob(s), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(b);
}
// 保存时附加的注释行(以 \n 结尾)。base64 字母表不含 `*`,不会破坏任何注释形态
function flowEmbed(d: FlowDraft): string {
  return '// lucid-graph:1:' + flowB64Enc(JSON.stringify(d)) + '\n';
}
// 读内嵌图:没有/坏了/版本不认识 → null(版本白名单与 loadFlowDrafts 同一口径,不猜)
function flowDecodeGraph(script: string): FlowDraft | null {
  const m = FLOW_EMBED_RE.exec(String(script || ''));
  if (!m) return null;
  try {
    const j = JSON.parse(flowB64Dec(m[2])) as FlowDraft;
    if (!j || typeof j !== 'object' || (j.v !== 1 && j.v !== 2) || !Array.isArray(j.nodes) || !Array.isArray(j.edges)) return null;
    return j;
  } catch { return null; }
}
// 反解图的自动布局(脚本里没有坐标):复用 flowLevels 分层——层序 → x,层内序 → y。
function flowAutoLayout(d: FlowDraft): void {
  const { groups } = flowLevels(d);
  const placed = new Set<string>();
  groups.forEach((g, gi) => (g || []).forEach((id, k) => {
    const n = d.nodes.find(x => x.id === id);
    if (!n) return;
    placed.add(id);
    n.position = { x: 80 + gi * 300, y: 110 + k * 170 };
  }));
  let y = 110;
  for (const n of d.nodes) if (!placed.has(n.id)) { y += 170; n.position = { x: 80, y }; }
}
// 复核单点:反解图必须能**逐字节重新生成**同一份脚本(忽略尾部空白)才认账。
// 先按真实上下文复核(子流按名引用可见);失败再按宽松上下文(不带草稿表)试一次——
// 宽松通过 = 只是引用的子流不在当前项目,允许载入但由调用方给出警告(编辑器会立刻把错误亮出来)。
function flowParseVerified(script: string, ctx?: FlowCtx): { draft: FlowDraft; foreignSubflow: boolean } | null {
  const d = flowParse(script);
  if (!d) return null;
  const want = String(script).trimEnd();
  const ok = (c?: FlowCtx): boolean => { try { return flowGenerate(d, c).trimEnd() === want; } catch { return false; } };
  if (ok(ctx)) return { draft: d, foreignSubflow: false };
  if (ctx && ok(undefined)) return { draft: d, foreignSubflow: true };
  return null;
}
// ── flowParse:生成器文法的最小反解器(纯文本 → 图;不认识的结构 → null)──────────────────
// 锚 = 生成器首行注释(顺带还原 cwd——载入切上下文要用它)。语句按出现顺序成组、组间全连接(源→汇);
// map 链 / 分支两臂 / 循环体按结构显式重建。正确性不靠"读起来对":调用方 flowParseVerified 逐字节对账。
// 内部用 FlowParseFail 抛"不认识",这里统一兜成 null —— 反解失败是**预期路径**(老脚本/别人的脚本),不是异常。
class FlowParseFail extends Error {}
let flowParseDbg = '';      // 最近一次反解失败的原因(诊断用;成功即清空)
function flowParse(script: string): FlowDraft | null {
  flowParseDbg = '';
  try { return flowParseInner(script); }
  catch (e) {
    if (e instanceof FlowParseFail) { flowParseDbg = String((e as Error).message || ''); return null; }
    throw e;
  }
}
function flowParseInner(script: string): FlowDraft | null {
  const src = String(script || '');
  const head = /^\/\/ 由 Lucid 编排器生成 —— 目标项目: (.*)\n\/\/ 用法: [^\n]*\n/.exec(src);
  if (!head) return null;
  const cwd = head[1] === '(未填)' ? '' : head[1];
  let i = head[0].length;
  // ⚠ 必须给**变量**显式函数类型标注:TS 的 never-返回控制流收窄只认"变量带显式类型"的 const
  // (只给箭头函数标返回类型不够)——否则后面每个 `if (!x) fail(...)` 都不会收窄。
  const fail: (why: string) => never = (why) => { throw new FlowParseFail(why); };

  // —— 扫描原语(字符串/模板/注释感知)——
  const eol = (f: number): number => { const k = src.indexOf('\n', f); return k < 0 ? src.length : k; };
  const curLine = (): string => src.slice(i, eol(i));
  const trim = (): string => curLine().trim();
  const nextLine = (): void => { i = eol(i) + 1; };
  const strEnd = (s: string, k: number): number => {
    const q = s[k]; let j = k + 1;
    while (j < s.length) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === q) return j + 1;
      if (s[j] === '\n' && q !== '`') return j;
      j++;
    }
    return j;
  };
  const tmplEnd = (s: string, k: number): number => {
    let j = k + 1;
    while (j < s.length) {
      const c = s[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') return j + 1;
      if (c === '$' && s[j + 1] === '{') { const e2 = matchBracket(s, j + 1, '{', '}'); if (e2 < 0) return s.length; j = e2 + 1; continue; }
      j++;
    }
    return s.length;
  };
  const matchBracket = (s: string, k: number, open: string, close: string): number => {
    let depth = 1, j = k + 1;
    while (j < s.length) {
      const c = s[j];
      if (c === '"' || c === "'") { j = strEnd(s, j); continue; }
      if (c === '`') { j = tmplEnd(s, j); continue; }
      if (c === '/' && s[j + 1] === '/') { while (j < s.length && s[j] !== '\n') j++; continue; }
      if (c === '/' && s[j + 1] === '*') { const e2 = s.indexOf('*/', j + 2); j = e2 < 0 ? s.length : e2 + 2; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (!depth) return j; }
      j++;
    }
    return -1;
  };
  // 顶层分隔符定位:diameter 0 的 sep 或 depth 0 的闭合符(后者 = "表达式到此为止")
  const findSep = (s: string, from: number, seps: string): number => {
    let depth = 0, j = from;
    while (j < s.length) {
      const c = s[j];
      if (c === '"' || c === "'") { j = strEnd(s, j); continue; }
      if (c === '`') { j = tmplEnd(s, j); continue; }
      if (c === '/' && s[j + 1] === '/') { while (j < s.length && s[j] !== '\n') j++; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (!depth) return j; depth--; }
      else if (!depth && seps.indexOf(c) >= 0) return j;
      j++;
    }
    return s.length;
  };
  const splitTop = (s: string): string[] => {
    const out: string[] = []; let p = 0;
    for (;;) {
      const e2 = findSep(s, p, ',');
      out.push(s.slice(p, e2).trim());
      if (e2 >= s.length) break;
      p = e2 + 1;
    }
    return out;
  };

  // —— 状态 ——
  const nodes: FlowNode[] = [], edges: FlowEdge[] = [];
  const used = new Set<string>();
  let ne = 0, nx = 0, startId = '';
  const edge = (s: string, t: string, sh = 'out', th = 'in'): void => { edges.push({ id: 'e' + (++ne), source: s, sourceHandle: sh, target: t, targetHandle: th }); };
  const mknode = (id: string, type: FlowKind, data: FlowNodeData): string => {
    if (!id || used.has(id)) fail('节点 id 重复或为空:' + id);
    used.add(id);
    nodes.push({ id, type, position: { x: 0, y: 0 }, data });
    return id;
  };
  const fresh = (): string => { let id = ''; do { id = 'x' + (++nx); } while (used.has(id)); return id; };
  const schemaMap = new Map<string, string>();

  // —— 字面量 → 草稿文本(flowLiteral 的逆)——
  const unSub = (e: string, prevIds: string[] | null): string | null => {
    const m = /^(Q|[A-Za-z_$][\w$]*)((?:\?\.\w+|\?\.\[\d+\])*)$/.exec(e.trim());
    if (!m) return null;
    const base = m[1];
    let p2 = m[2] || '', path = '';
    while (p2) {
      let m2 = /^\?\.([A-Za-z_$][\w$]*)/.exec(p2);
      if (m2) { path += '.' + m2[1]; p2 = p2.slice(m2[0].length); continue; }
      m2 = /^\?\.\[(\d+)\]/.exec(p2);
      if (m2) { path += '[' + m2[1] + ']'; p2 = p2.slice(m2[0].length); continue; }
      return null;
    }
    if (base === 'Q') return path ? null : '{{start}}';
    if (base === 'item') return '{{item' + path + '}}';
    if (base === 'i') return path ? null : '{{index}}';
    if (base === 'prev') return prevIds && prevIds.length === 1 ? '{{' + prevIds[0] + path + '}}' : null;
    return '{{' + base + path + '}}';
  };
  const unlit = (expr: string, prevIds: string[] | null): string | null => {
    const s = expr.trim();
    if (s.startsWith('"')) { try { const v: unknown = JSON.parse(s); return typeof v === 'string' ? v : null; } catch { return null; } }
    if (!s.startsWith('`') || !s.endsWith('`') || s.length < 2) return null;
    const body = s.slice(1, -1);
    let out = '', k = 0;
    while (k < body.length) {
      const c = body[k];
      if (c === '\\') {
        const d = body[k + 1];
        if (d === '\\') { out += '\\'; k += 2; continue; }
        if (d === '`') { out += '`'; k += 2; continue; }
        if (d === '$' && body[k + 2] === '{') { out += '${'; k += 3; continue; }
        return null;                                  // 生成器只转义这三样;别的转义 = 非本生成器产物
      }
      if (c === '$' && body[k + 1] === '{') {
        const end = matchBracket(body, k + 1, '{', '}');
        if (end < 0) return null;
        const ref = unSub(body.slice(k + 2, end), prevIds);
        if (ref === null) return null;
        out += ref; k = end + 1; continue;
      }
      out += c; k++;
    }
    return out;
  };
  const strLit = (v: string): string => {
    const x = unlit(v, null);
    if (x === null) fail('字符串字面量解析失败:' + v.slice(0, 40));
    return x;
  };
  const textsOf = (d: FlowNodeData): string[] =>
    [d.prompt, d.label, d.text].filter((x): x is string => typeof x === 'string' && x.length > 0);

  // —— 调用表达式解析 ——
  const parseOpts = (text: string, prevIds: string[] | null): { label: string; phase: string; model: string; effort: string; agentType: string; isolation: boolean; schemaText: string } => {
    const t2 = text.trim();
    if (!t2.startsWith('{')) fail('opts 不是对象');
    const close = matchBracket(t2, 0, '{', '}');
    if (close < 0) fail('opts 未闭合');
    const out = { label: '', phase: '', model: '', effort: '', agentType: '', isolation: false, schemaText: '' };
    for (const e of splitTop(t2.slice(1, close))) {
      const k = /^([\w$]+): ([\s\S]*)$/.exec(e);
      if (!k) fail('opts 条目不认识:' + e.slice(0, 40));
      const key = k[1], val = k[2].trim();
      if (key === 'label') { const v = unlit(val, prevIds); if (v === null) fail('label 解析失败'); out.label = v; }
      else if (key === 'phase' || key === 'model' || key === 'effort' || key === 'agentType') out[key] = strLit(val);
      else if (key === 'isolation') { if (val !== '"worktree"') fail('isolation 值不认识'); out.isolation = true; }
      else if (key === 'schema') {
        const sm = /^SCHEMA_([\w$]+)$/.exec(val);
        if (!sm || !schemaMap.has(sm[1])) fail('schema 引用不认识:' + val);
        out.schemaText = schemaMap.get(sm[1]) as string;
      } else fail('opts 未知键:' + key);
    }
    return out;
  };
  const parseCallInner = (inner: string, isRetry: boolean, prevIds: string[] | null): FlowNodeData => {
    const segs = splitTop(inner);
    if (segs.length < 2) fail('调用参数不足');
    const prompt = unlit(segs[0], prevIds);
    if (prompt === null) fail('prompt 字面量解析失败');
    const o = parseOpts(segs[1], prevIds);
    const data: FlowNodeData = { label: o.label, phase: o.phase, prompt, model: o.model, schemaText: o.schemaText };
    if (o.effort) data.effort = o.effort;
    if (o.agentType) data.agentType = o.agentType;
    if (o.isolation) data.isolation = true;
    if (isRetry) {
      if (segs.length !== 4) fail('$retry 参数个数不对');
      const rn = Number(segs[2]), rms = Number(segs[3]);
      if (!Number.isInteger(rn) || !Number.isInteger(rms)) fail('$retry 数字不合法');
      data.retryN = rn; data.retryMs = rms;
    }
    return data;
  };
  // text 必须是完整调用表达式(已 trim);返回节点 data
  const parseCallExpr = (text: string, prevIds: string[] | null): FlowNodeData => {
    const t2 = text.trim();
    const m = /^(agent|\$retry)\(/.exec(t2);
    if (!m) fail('调用形状不认识:' + t2.slice(0, 40));
    const close = matchBracket(t2, m[0].length - 1, '(', ')');
    if (close < 0 || t2.slice(close + 1).trim() !== '') fail('调用未闭合或尾部有杂质');
    return parseCallInner(t2.slice(m[0].length, close), m[1] === '$retry', prevIds);
  };
  // parallel thunk 行:'  () => <call>,' —— 消费到 '])'。
  // names = 脚本里的真实变量名(顶层/区域内非末级的 parallel 成员是有名的,可能被后续占位符引用);
  // 末级赋值/扇出的成员在脚本里匿名 → null(发明 id,永不落码)。
  const parseThunks = (from: number, prevIds: string[] | null, names: string[] | null): string[] => {
    const ids: string[] = [];
    i = from;
    while (trim() !== '])') {
      if (i >= src.length) fail('parallel 未闭合');
      const line = curLine();
      const q = i + line.length - line.trimStart().length;
      const mm = /^\(\) => /.exec(src.slice(q));
      if (!mm) fail('parallel 元素形状不认识');
      const cs = q + mm[0].length;
      const ce = findSep(src, cs, ',');
      if (src[ce] !== ',') fail('parallel 元素未以逗号收尾');
      const data = parseCallExpr(src.slice(cs, ce), prevIds);
      const id = mknode(names ? names[ids.length] : fresh(), 'agent', data);
      for (const t2 of textsOf(data)) refs.push({ id, text: t2 });
      ids.push(id);
      i = eol(ce) + 1;
    }
    nextLine();                                       // 消费 '])'
    return ids;
  };
  const parseCallbackLevel = (seg: string, prevIds: string[] | null): string[] => {
    const m = /^\(prev, item, i\) => /.exec(seg);
    if (!m) fail('pipeline 回调形状不认识');
    const expr = seg.slice(m[0].length).trim();
    if (/^parallel\(\[/.test(expr)) {
      const open = expr.indexOf('[');
      const close = matchBracket(expr, open, '[', ']');
      if (close < 0 || expr.slice(close + 1).trim() !== '') fail('pipeline 扇出级未闭合');
      const ids: string[] = [];
      for (const th of splitTop(expr.slice(open + 1, close))) {
        const tm = /^\(\) => /.exec(th);
        if (!tm) fail('pipeline 扇出元素形状不认识');
        const data = parseCallExpr(th.slice(tm[0].length), prevIds);
        const id = mknode(fresh(), 'agent', data);
        for (const t2 of textsOf(data)) refs.push({ id, text: t2 });
        ids.push(id);
      }
      if (!ids.length) fail('pipeline 扇出级为空');
      return ids;
    }
    const data = parseCallExpr(expr, prevIds);
    const id = mknode(fresh(), 'agent', data);
    for (const t2 of textsOf(data)) refs.push({ id, text: t2 });
    return [id];
  };

  // —— 头部:meta / SCHEMA_ / $retry 助手 / ARGS 块 / phase 前置 / Q ——
  const meta = { name: 'untitled', desc: '', title: '', whenToUse: '', phases: [] as FlowPhase[] };
  const reqKeys: string[] = [];
  let hasArgs = false, argsRequired = false, note = '';
  const parseMetaBlock = (): void => {
    nextLine();
    let m: RegExpExecArray | null;
    while (i < src.length && trim() !== '}') {
      const line = curLine();
      const p = i + line.length - line.trimStart().length;
      if ((m = /^name: (".*"),$/.exec(line.trim()))) meta.name = strLit(m[1]);
      else if ((m = /^description: (".*"),$/.exec(line.trim()))) meta.desc = strLit(m[1]);
      else if ((m = /^title: (".*"),$/.exec(line.trim()))) meta.title = strLit(m[1]);
      else if ((m = /^whenToUse: (".*"),$/.exec(line.trim()))) meta.whenToUse = strLit(m[1]);
      else if (/^phases: \[/.test(line.trim())) {
        const open = src.indexOf('[', p);
        const close = matchBracket(src, open, '[', ']');
        if (close < 0) fail('meta.phases 未闭合');
        for (const ent of splitTop(src.slice(open + 1, close))) {
          if (!ent) continue;
          if (!ent.startsWith('{')) fail('phases 条目不是对象');
          const ce = matchBracket(ent, 0, '{', '}');
          if (ce < 0) fail('phases 条目未闭合');
          const ph: FlowPhase = { title: '' };
          for (const kv of splitTop(ent.slice(1, ce))) {
            const km = /^(title|detail|model): (".*")$/.exec(kv);
            if (!km) fail('phases 字段不认识:' + kv.slice(0, 30));
            if (km[1] === 'title') ph.title = strLit(km[2]);
            else if (km[1] === 'detail') ph.detail = strLit(km[2]);
            else ph.model = strLit(km[2]);
          }
          meta.phases.push(ph);
        }
        i = eol(close) + 1;
        continue;
      } else fail('meta 字段不认识:' + line.trim().slice(0, 40));
      nextLine();
    }
    if (i >= src.length) fail('meta 块未闭合');
    nextLine();                                       // 消费 '}'
  };
  for (;;) {
    const t = trim();
    if (!t) { if (i >= src.length) return null; nextLine(); continue; }
    if (t.startsWith('export const meta = {')) { parseMetaBlock(); continue; }
    if (t.startsWith('const SCHEMA_')) {
      const m = /^const (SCHEMA_[\w$]+) = /.exec(t);
      if (!m) fail('SCHEMA 行不认识');
      const open = src.indexOf('{', i);
      const close = matchBracket(src, open, '{', '}');
      if (close < 0) fail('SCHEMA 未闭合');
      schemaMap.set(m[1].slice('SCHEMA_'.length), src.slice(open, close + 1).trim());
      i = eol(close) + 1;
      continue;
    }
    if (t.startsWith('async function $retry(')) {
      nextLine();
      // 助手体里有缩进的 `}`(for 循环收尾)——只有**顶格**的 `}` 才是助手结束(生成器固定列 0)
      while (i < src.length && src.slice(i, eol(i)).trimEnd() !== '}') nextLine();
      if (i >= src.length) fail('$retry 助手未闭合');
      nextLine();
      continue;
    }
    if (t.startsWith('const ARGS = ')) { hasArgs = true; nextLine(); continue; }
    if (t.startsWith('if (!ARGS')) { argsRequired = true; nextLine(); continue; }
    if (t.startsWith('if (typeof ARGS')) {
      const m1 = /^if \(typeof ARGS\.([A-Za-z_$][\w$]*) === 'undefined'\)/.exec(t);
      const m2 = /^if \(typeof ARGS\[("(?:[^"\\]|\\.)*")\] === 'undefined'\)/.exec(t);
      if (m1) reqKeys.push(m1[1]);
      else if (m2) reqKeys.push(strLit(m2[1]));
      else fail('ARGS 校验行不认识');
      nextLine();
      continue;
    }
    if (t.startsWith('phase(')) { nextLine(); continue; }
    if (t.startsWith('const Q = ')) {
      const m = /^const Q = \(typeof (?:ARGS|args) === 'string' && (?:ARGS|args)\.trim\(\)\) \|\| (.*)$/.exec(t);
      if (!m) fail('Q 行不认识');
      note = strLit(m[1]);
      nextLine();
      continue;
    }
    break;
  }
  startId = mknode(fresh(), 'start', { note });

  // —— 占位符引用边(解析后统一挂:目标必须已存在)——
  const refs: { id: string; text: string }[] = [];
  const refEdges = (): void => {
    // ⚠ 只在目标**还不可达**时补边:结构边往往已经提供可达性(占位符只是校验通过,不需要再多一条),
    // 而重复/多余的边会改变区域走链形态(如 loop 体首多一条来自 start 的入边 → "循环体不是单入口"),
    // 把"本可还原"的图否决掉。可达性口径与 flowRefIssues 的 upstream 判定一致:target 能走到 r.id。
    const adj = new Map<string, string[]>();
    for (const e of edges) { const a = adj.get(e.source); if (a) a.push(e.target); else adj.set(e.source, [e.target]); }
    const hasEdge = new Set(edges.map(e => e.source + ' ' + e.target));
    const reaches = (from: string, to: string): boolean => {
      const seen = new Set<string>([from]);
      const st = [from];
      while (st.length) {
        const x = st.pop() as string;
        for (const y of adj.get(x) || []) {
          if (y === to) return true;
          if (!seen.has(y)) { seen.add(y); st.push(y); }
        }
      }
      return false;
    };
    for (const r of refs) {
      for (const m of r.text.matchAll(FLOW_REF_RE)) {
        const name = m[1], path = m[2] || '';
        if (name === 'item' || name === 'index') continue;
        const target = name === 'start' ? startId : name;
        if (!used.has(target)) fail('占位符引用了不存在的节点 {{' + name + path + '}}');
        if (reaches(target, r.id)) continue;
        const key = target + ' ' + r.id;
        if (hasEdge.has(key)) continue;
        hasEdge.add(key);
        const a = adj.get(target); if (a) a.push(r.id); else adj.set(target, [r.id]);
        edge(target, r.id);
      }
    }
  };
  const pendingReturnTails: string[] = [];
  const regionTargets: string[] = [];

  // —— 语句解析 ——
  interface St { ins: string[]; outs: string[] }
  const chain = (sts: St[]): void => {
    for (let k = 0; k + 1 < sts.length; k++)
      for (const a of sts[k].outs) for (const b of sts[k + 1].ins) edge(a, b);
  };
  const parseStmts = (stop: () => boolean): St[] => {
    const sts: St[] = [];
    for (;;) {
      if (i >= src.length) break;
      if (stop()) break;
      const t = trim();
      if (!t) { nextLine(); continue; }
      if (t.startsWith('phase(')) { nextLine(); continue; }
      sts.push(parseStmt());
    }
    chain(sts);
    return sts;
  };
  // 循环体 / 分支臂 / 顶层共用的单条语句解析(消费到该语句结束的下一行行首)
  const parseStmt = (): St => {
    const line = curLine();
    const p = i + line.length - line.trimStart().length;
    const rest = line.trimStart();                // 语句判定只看**本行**($ 才能当行尾锚用);绝对扫描用 p
    let m: RegExpExecArray | null;
    if (/^return\b/.test(rest)) fail('语句顺序异常:return 提前出现');
    // 单 agent / $retry
    if ((m = /^const ([\w$]+) = await (agent|\$retry)\(/.exec(rest))) {
      const close = matchBracket(src, p + m[0].length - 1, '(', ')');
      if (close < 0) fail('agent 调用未闭合');
      const data = parseCallInner(src.slice(p + m[0].length, close), m[2] === '$retry', null);
      const id = mknode(m[1], 'agent', data);
      for (const t2 of textsOf(data)) refs.push({ id, text: t2 });
      i = eol(close) + 1;
      return { ins: [id], outs: [id] };
    }
    // parallel 组(成员是脚本里的真实变量名,可能被后续占位符引用)
    if ((m = /^const \[([^\]]*)\] = await parallel\(\[$/.exec(rest))) {
      const ids = m[1].split(',').map(x => x.trim()).filter(Boolean);
      if (!ids.length) fail('parallel 组为空');
      const got = parseThunks(eol(i) + 1, null, ids);
      if (got.length !== ids.length) fail('parallel 元素数与变量数不匹配');
      return { ins: ids.slice(), outs: ids.slice() };
    }
    // map(级 1 = map 自身;pipeline 回调其余各级)
    if ((m = /^const ([\w$]+) = await pipeline\(/.exec(rest))) {
      const mapId = m[1];
      const open = p + m[0].length - 1;
      const close = matchBracket(src, open, '(', ')');
      if (close < 0) fail('pipeline 未闭合');
      const segs = splitTop(src.slice(open + 1, close));
      if (segs.length < 2) fail('pipeline 至少需要一个回调级');
      const cb1 = ((): FlowNodeData => {
        const cm = /^\(prev, item, i\) => /.exec(segs[1]);
        if (!cm) fail('pipeline 首级回调形状不认识');
        return parseCallExpr(segs[1].slice(cm[0].length), null);
      })();
      const data: FlowNodeData = { label: cb1.label, phase: cb1.phase, prompt: cb1.prompt, model: cb1.model, schemaText: cb1.schemaText, items: segs[0] };
      if (cb1.effort) data.effort = cb1.effort;
      if (cb1.agentType) data.agentType = cb1.agentType;
      if (cb1.isolation) data.isolation = true;
      if (cb1.retryN !== undefined) { data.retryN = cb1.retryN; data.retryMs = cb1.retryMs; }
      const id = mknode(mapId, 'map', data);
      for (const t2 of textsOf(data)) refs.push({ id, text: t2 });
      let prev = [mapId];
      for (let k = 2; k < segs.length; k++) {
        const lv = parseCallbackLevel(segs[k], prev);
        for (const a of prev) for (const b of lv) edge(a, b);
        prev = lv;
      }
      i = eol(close) + 1;
      const am = /^const ([\w$]+) = ([\w$]+);$/.exec(trim());
      if (am && am[2] === mapId) {                 // 链尾汇合点别名:const E = map;
        const e2 = mknode(am[1], 'merge', {});
        for (const a of prev) edge(a, e2);
        nextLine();
        return { ins: [mapId], outs: [e2] };
      }
      pendingReturnTails.push(...prev);            // 链尾无汇合点:收尾接 return(对不上由复核否决)
      return { ins: [mapId], outs: [mapId] };
    }
    // log
    if (/^log\(/.test(rest)) {
      const close = matchBracket(src, p + 3, '(', ')');
      if (close < 0) fail('log 未闭合');
      const text = unlit(src.slice(p + 4, close), null);
      if (text === null) fail('log 文本解析失败');
      const id = mknode(fresh(), 'log', { text });
      refs.push({ id, text });
      i = eol(close) + 1;
      return { ins: [id], outs: [id] };
    }
    // code 片段(原文插入,以单独一行 '})()' 收尾)
    if ((m = /^const ([\w$]+) = await \(async \(\) => \{$/.exec(rest))) {
      const openEnd = eol(i) + 1;
      let j = openEnd, closeStart = -1;
      while (j < src.length) {
        const le = eol(j);
        if (src.slice(j, le).trim() === '})()') { closeStart = j; break; }
        j = le + 1;
      }
      if (closeStart < 0) fail('code 片段未闭合');
      const code = src.slice(openEnd, Math.max(openEnd, closeStart - 1));
      const id = mknode(m[1], 'code', { code });
      i = eol(closeStart) + 1;
      return { ins: [id], outs: [id] };
    }
    // subflow
    if ((m = /^const ([\w$]+) = await workflow\(/.exec(rest))) {
      const close = matchBracket(src, p + m[0].length - 1, '(', ')');
      if (close < 0) fail('workflow 未闭合');
      const segs = splitTop(src.slice(p + m[0].length, close));
      const r0 = segs[0] || '';
      let ref = '';
      if (r0.startsWith('"')) ref = strLit(r0);
      else {
        const om = /^\{ scriptPath: (".*") \}$/.exec(r0);
        if (!om) fail('workflow 引用形状不认识');
        ref = strLit(om[1]);
      }
      const argsExpr = segs.length > 1 ? segs.slice(1).join(', ') : '';
      const id = mknode(m[1], 'subflow', { ref, argsExpr });
      i = eol(close) + 1;
      return { ins: [id], outs: [id] };
    }
    // let X; → 循环 or 分支(带汇合点)
    if ((m = /^let ([\w$]+);$/.exec(rest))) {
      const first = eol(i) + 1;
      const t1 = src.slice(first, eol(first)).trim();
      if (t1 === '{') return parseLoop(m[1], first);
      if (/^if \(/.test(t1)) return parseBranch(m[1], first);
      fail('let 语句后既不是循环也不是分支');
    }
    // 无汇合点的分支:双臂直接收于 return,脚本里没有 let 行,以 if 开头
    if (/^if \(/.test(rest)) return parseBranch('', p);
    // 区域末级赋值(<target> = await ...; / <target> = null;)——只允许落在区域目标上。
    // 末级成员在脚本里匿名(整个数组赋给 merge/loop 变量)→ 发明 id;空臂 = 'null;' 标记。
    if ((m = /^([\w$]+) = ([\s\S]+)$/.exec(rest))) {
      const target = m[1];
      if (!regionTargets.length || regionTargets[regionTargets.length - 1] !== target) fail('赋值目标不在区域上下文里:' + target);
      const rhs = m[2];
      if (rhs.trim() === 'null;') { i = eol(i) + 1; return { ins: [], outs: [] }; }
      // 生成器在这里一律走 `target = await <call>;`(emitRegion 的 decl + await)
      const aw = /^await ([\s\S]+)$/.exec(rhs.trim());
      if (!aw) fail('赋值右侧不是 await:' + rhs.trim().slice(0, 40));
      const expr = aw[1].trim();
      const cs = p + m[0].length - m[2].length + rhs.trim().indexOf('await ') + 'await '.length;   // expr 的绝对起点
      if (/^(agent|\$retry)\(/.test(expr)) {
        const cm = /^(agent|\$retry)\(/.exec(expr) as RegExpExecArray;
        const close = matchBracket(src, cs + cm[0].length - 1, '(', ')');
        if (close < 0) fail('赋值右侧调用未闭合');
        if (src.slice(close + 1, eol(close)).trim() !== '') fail('赋值右侧调用尾部有杂质');   // emitRegion 不带分号
        const data = parseCallInner(src.slice(cs + cm[0].length, close), cm[1] === '$retry', null);
        const id = mknode(fresh(), 'agent', data);
        for (const t2 of textsOf(data)) refs.push({ id, text: t2 });
        i = eol(close) + 1;
        return { ins: [id], outs: [id] };
      }
      if (/^parallel\(\[/.test(expr)) {
        const open = cs + 'parallel('.length;
        if (matchBracket(src, open, '(', ')') < 0) fail('赋值右侧 parallel 未闭合');
        const got = parseThunks(eol(open) + 1, null, null);
        // 循环体末级扇出:walk 要求"扇出必须汇于同一个 merge",而 loop 不是 merge ——
        // 原图里这里有个 merge(脚本里不可见,名字不出现在任何一行)→ 发明一个,回环经它。
        const tgt = nodes.find(x => x.id === target);
        if (tgt && tgt.type === 'loop') {
          const mx = mknode(fresh(), 'merge', {});
          for (const a of got) edge(a, mx);
          return { ins: got.slice(), outs: [mx] };
        }
        return { ins: got.slice(), outs: got.slice() };
      }
      fail('赋值右侧不认识:' + expr.slice(0, 40));
    }
    fail('无法识别的语句:' + rest.slice(0, 60));
  };
  const parseLoop = (id: string, at: number): St => {
    i = at;
    if (trim() !== '{') fail('循环块未开始');
    nextLine();
    if (trim() !== 'let round = 0;') fail('循环缺少 round 计数行');
    nextLine();
    const line = curLine();
    const p = i + line.length - line.trimStart().length;
    if (!/^while \(\(/.test(src.slice(p))) fail('循环缺少 while 行');
    const open = p + 'while ('.length - 1;          // 外层 '('
    const close = matchBracket(src, open, '(', ')');
    if (close < 0) fail('while 条件未闭合');
    const whole = src.slice(open + 1, close);        // `(<cond>) && round < N`
    if (!whole.startsWith('(')) fail('while 条件形状不认识');
    const k = matchBracket(whole, 0, '(', ')');
    if (k < 0) fail('while 条件形状不认识');
    const cond = whole.slice(1, k);
    const nm = /^ && round < (\d+)$/.exec(whole.slice(k + 1));
    if (!nm) fail('while 上界形状不认识');
    const maxRounds = Number(nm[1]);
    if (src.slice(close + 1, eol(close)).trim() !== '{') fail('while 行尾不是块开始');
    i = eol(close) + 1;
    let guard = false;
    if (/^if \(budget\.total && budget\.remaining\(\) < \d+\) \{ log\('预算将尽,提前收束'\); break \}$/.test(trim())) { guard = true; nextLine(); }
    if (trim() !== 'round++;') fail('循环缺少 round++ 行');
    nextLine();
    // loop 节点先入表:体末级扇出要靠它的类型决定要不要发明中间 merge(臂/循环的收束形态不同)
    const lp = mknode(id, 'loop', { label: '', cond, maxRounds, budgetGuard: guard });
    regionTargets.push(id);
    const body = parseStmts(() => trim() === '}');
    regionTargets.pop();
    if (trim() !== '}') fail('循环体未闭合');
    nextLine();
    if (trim() !== '}') fail('循环块未闭合');
    nextLine();
    if (body.length) {
      const entry = body[0].ins[0];
      if (!entry) fail('循环体入口找不到');
      edge(lp, entry, 'body', 'in');
      for (const a of body[body.length - 1].outs) edge(a, lp);
    }
    return { ins: [lp], outs: [lp] };
  };
  const parseBranch = (mergeId: string, at: number): St => {
    i = at;
    const line = curLine();
    const p = i + line.length - line.trimStart().length;
    if (!/^if \(/.test(src.slice(p))) fail('分支缺少 if 行');
    const open = p + 'if ('.length - 1;
    const close = matchBracket(src, open, '(', ')');
    if (close < 0) fail('if 条件未闭合');
    const cond = src.slice(open + 1, close);
    if (src.slice(close + 1, eol(close)).trim() !== '{') fail('if 行尾不是块开始');
    i = eol(close) + 1;
    // 有汇合点(let 声明)才建 merge 节点;臂末级赋值会把结果并进它,类型查询也依赖它先入表
    const M = mergeId ? mknode(mergeId, 'merge', {}) : '';
    regionTargets.push(mergeId);
    const tArm = parseStmts(() => trim() === '} else {');
    if (trim() !== '} else {') fail('true 分支未闭合');
    nextLine();
    const fArm = parseStmts(() => trim() === '}');
    regionTargets.pop();
    if (trim() !== '}') fail('false 分支未闭合');
    nextLine();
    const br = mknode(fresh(), 'branch', { label: '', cond });
    const arm = (sts: St[], handle: string): void => {
      const empty = !sts.length || (sts.length === 1 && !sts[0].ins.length && !sts[0].outs.length);
      if (empty) { if (M) edge(br, M, handle, 'in'); else fail('空臂且无汇合点'); return; }
      edge(br, sts[0].ins[0], handle, 'in');
      const tails = sts[sts.length - 1].outs;
      if (M) for (const a of tails) edge(a, M);
      else pendingReturnTails.push(...tails);     // 无汇合点 = 双臂终止于同一个 return(收尾统一连)
    };
    arm(tArm, 'true');
    arm(fArm, 'false');
    return { ins: [br], outs: M ? [M] : [] };
  };

  // —— 顶层语句 + return 收尾 ——
  const top = parseStmts(() => /^return\b/.test(trim()));
  if (!/^return\b/.test(trim())) fail('缺少 return');
  let ret = src.slice(i + 'return '.length).replace(/\n\/\/ lucid-graph:[\s\S]*$/, '').replace(/\s+$/, '');
  const returnId = mknode(fresh(), 'return', { ret });
  if (top.length) for (const b of top[0].ins) edge(startId, b);
  if (top.length) for (const a of top[top.length - 1].outs) edge(a, returnId);
  for (const a of pendingReturnTails) edge(a, returnId);
  refEdges();
  const d: FlowDraft = {
    v: 2, name: meta.name, desc: meta.desc, title: meta.title, whenToUse: meta.whenToUse,
    cwd, phases: meta.phases,
    argsSpec: hasArgs
      ? { schemaText: argsRequired && reqKeys.length
          ? JSON.stringify({ type: 'object', properties: reqKeys.reduce<Record<string, unknown>>((o, k2) => (o[k2] = {}, o), {}), required: reqKeys })
          : '', exampleText: '', required: argsRequired }
      : { schemaText: '', exampleText: '', required: false },
    nodes, edges, next: 1, view: { x: 20, y: 10, zoom: 1 },
  };
  flowAutoLayout(d);
  return d;
}
