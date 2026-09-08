// ── 45-flowgen.ts:图 → Workflow 执行件的生成器(纯函数,零 DOM,零 vendor 依赖)──
// 语义映射(§6 验收表,保守可审计;X3 之前不生成 pipeline/循环/条件——宁可少生成,不可错生成):
//   拓扑层(最长路径分层) = 一个 await 点;层内单 agent = 顺序 await,层内多 agent = parallel 栅栏(每个带 opts.phase);
//   {{nX}} 占位符 → 模板字面量 ${nX}(start 节点 → ${Q});phase 序列 = 各 agent 的 phase 首现去重 → meta.phases;
//   schemaText → 顶部 const SCHEMA_vX 字面量 + opts.schema;return.ret 空 → 兜底 { results: [末层变量].filter(Boolean) }。
// 三个口径各住唯一函数:flowValidate(错误清单)/ flowMetaPhases(phase 首现去重)/ flowGenerate(出码)——UI 与测试都只调它们。
const FLOW_MODEL_OK = ['sonnet', 'opus', 'haiku', 'fable', 'mythos'];   // agent(opts.model) 档位白名单;'' = inherit
// ⚠ 共享带 /g 的正则做 .test()/.exec() 会留下 lastIndex 状态(同一正则被两个调用方交错使用即漏判)——
// 因此探测用无 g 的 FLOW_REF_PROBE,枚举用 matchAll(自带独立迭代状态),替换用带 g 的 replace(结束时自复位)。
const FLOW_REF_PROBE = /\{\{(n\d+|start)\}\}/;
const FLOW_REF_RE = /\{\{(n\d+|start)\}\}/g;
const FLOW_SANDBOX_BANNED = /Date\.now\(\)|Math\.random\(\)|new Date\(\)/;   // 沙箱禁用且破坏 resume

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
  const es = fs.edges.filter(e => known.has(e.source) && known.has(e.target) && e.source !== e.target);
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

function flowRefErrs(fs: FlowDraft): string[] {
  const byId = new Map(fs.nodes.map(n => [n.id, n]));
  const up = flowUpstream(fs);
  const startId = fs.nodes.find(n => n.type === 'start')?.id;
  const errs: string[] = [];
  for (const n of fs.nodes) {
    if (n.type !== 'agent') continue;
    const seen = new Set<string>();
    for (const m of String(n.data.prompt || '').matchAll(FLOW_REF_RE)) seen.add(m[1]);
    for (const ref of seen) {
      const target = ref === 'start' ? startId : ref;
      if (!target || !byId.has(target)) { errs.push(`节点 ${n.id} 引用了不存在的节点 {{${ref}}}`); continue; }
      if (target === n.id) { errs.push(`节点 ${n.id} 引用了自身 {{${ref}}}`); continue; }
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

// 校验清单(空 = 可生成)。顺序固定:结构 → 引用 → 载荷,便于 UI 红条稳定不跳。
function flowValidate(fs: FlowDraft): string[] {
  const errs: string[] = [];
  const starts = fs.nodes.filter(n => n.type === 'start'), terms = fs.nodes.filter(n => n.type === 'return');
  const agents = fs.nodes.filter(n => n.type === 'agent');
  if (!starts.length) errs.push('缺 Start 节点(生成脚本的 args 入口)');
  if (!terms.length) errs.push('缺 Return 节点(生成脚本的产出)');
  if (!agents.length) errs.push('至少需要一个 Agent 步骤');
  const { orphan, cycle, dangling, selfEdge } = flowLevels(fs);
  if (cycle.length) errs.push('图中存在环,请调整连线:' + cycle.join(', '));
  if (selfEdge.length) errs.push('存在自环连线:' + selfEdge.map(i => i + ' → ' + i).join(', '));
  if (orphan.length) errs.push('孤立/未连线节点:' + orphan.join(', '));
  // Start 没连任何步骤 = args 入口空转(生出来的 Q 没人用),多半是漏连线而非有意
  if (dangling.length) errs.push('Start 节点未连到任何步骤(args 入口没被用到):' + dangling.join(', '));
  if (terms.length > 1 || starts.length > 1) errs.push('一个草稿至多一个 Start 与一个 Return');
  errs.push(...flowRefErrs(fs));
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
function flowLiteral(fs: FlowDraft, text: string): string {
  const startId = fs.nodes.find(n => n.type === 'start')?.id;
  const s = String(text ?? '');
  if (!FLOW_REF_PROBE.test(s) && !s.includes('\n')) return JSON.stringify(s);
  const body = s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
    .replace(FLOW_REF_RE, (_m: string, id: string) => '${' + (id === 'start' ? 'Q' : id === startId ? 'Q' : id) + '}');
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
  for (const g of groups) {
    if (!g) continue;
    const ags = g.map(byId).filter((n): n is FlowNode => !!n && n.type === 'agent');
    if (!ags.length) continue;                                        // start / return 层不出代码
    const ph = ags[0].data.phase || ags[0].data.label || '';
    if (ph && ph !== curPhase) { lines.push(`phase(${JSON.stringify(ph)})`); curPhase = ph; }
    const opt = (n: FlowNode, usePhase: boolean): string => {
      const o = [`label: ${JSON.stringify(n.data.label || n.id)}`];
      if (usePhase && n.data.phase) o.push(`phase: ${JSON.stringify(n.data.phase)}`);
      if (n.data.model) o.push(`model: ${JSON.stringify(String(n.data.model))}`);
      if (String(n.data.schemaText || '').trim()) o.push(`schema: SCHEMA_${n.id}`);
      return `{ ${o.join(', ')} }`;
    };
    const call = (n: FlowNode, usePhase: boolean): string => `agent(${flowLiteral(fs, String(n.data.prompt || ''))}, ${opt(n, usePhase)})`;
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
