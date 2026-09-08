// 全节点型端到端夹具(1.2.58 · Phase 9):一张图用上 start/map/agent/branch/merge/loop/log/code/subflow/return,
// 生成脚本后**在沙箱里真跑一遍**,断言每种节点型都按语义被执行到。这是 Phase 9 真机验收的"桩侧半边":
// 真机那半(终端 Workflow 调用 + /workflows 阶段树)需要用户终端,不在这里假装。
import { load, makeCk, runFlowScript } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown, ctx?: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + (ctx ? ', ' + JSON.stringify(ctx) : '') + ')') as string;
const V = (d: unknown, ctx?: unknown): string[] => env.get('flowValidate(' + JSON.stringify(d) + (ctx ? ', ' + JSON.stringify(ctx) : '') + ')') as string[];
const W = (d: unknown): string[] => env.get('flowWarnings(' + JSON.stringify(d) + ')') as string[];
const N = (id: string, type: string, x: number, y: number, data: any = {}): any => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string, sh = 'out', th = 'in'): any => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th });

// 一张图覆盖全部节点型:map 链(2 级)→ 分支(汇于 merge)→ 循环(2 轮)→ code → subflow → log → return
const ALL = {
  v: 2, name: 'all-nodes', desc: '全节点型验收夹具', cwd: '/work/fix',
  whenToUse: '当需要一次跑通全部节点型时',
  argsSpec: { schemaText: '{"type":"object","properties":{"paths":{"type":"array"}},"required":["paths"]}', exampleText: '{"paths":["a.ts"]}', required: true },
  phases: [{ title: 'Scan', detail: '逐条目审计' }, { title: 'Judge' }, { title: 'Iterate' }],
  nodes: [
    N('n1', 'start', 0, 0, { note: 'q' }),
    N('n2', 'map', 200, 0, { items: 'ARGS.paths', prompt: '审计 {{item}} #{{index}}', label: 'audit:{{item}}', phase: 'Scan' }),
    N('n3', 'agent', 400, 0, { label: '汇总', phase: 'Scan', prompt: '汇总 {{n2}}' }),
    N('n4', 'merge', 600, 0, {}),
    N('n5', 'branch', 800, 0, { label: 'Judge', cond: 'args.flag' }),
    N('n6', 'agent', 1000, -80, { label: '是', phase: 'Judge', prompt: '是 {{n4}}' }),
    N('n7', 'agent', 1000, 80, { label: '否', phase: 'Judge', prompt: '否 {{n4}}' }),
    N('n8', 'merge', 1200, 0, {}),
    N('n9', 'loop', 1400, 0, { label: 'Iterate', cond: 'true', maxRounds: 2, budgetGuard: true }),
    N('n10', 'agent', 1600, 0, { label: '迭代', phase: 'Iterate', prompt: '迭代 {{n8}}' }),
    N('n11', 'code', 1800, 0, { code: 'return String(n9).length' }),
    N('n12', 'subflow', 2000, 0, { ref: '/abs/triage.js', argsExpr: '{ v: n11 }' }),
    N('n13', 'log', 2200, 0, { text: '完成 {{n12}}' }),
    N('n14', 'return', 2400, 0, { ret: '{ v: n12 }' }),
  ],
  edges: [
    E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4'), E('e4', 'n4', 'n5'),
    E('e5', 'n5', 'n6', 'true'), E('e6', 'n5', 'n7', 'false'),
    E('e7', 'n6', 'n8'), E('e8', 'n7', 'n8'), E('e9', 'n8', 'n9'),
    E('e10', 'n9', 'n10', 'body'), E('e11', 'n10', 'n9'), E('e12', 'n9', 'n11', 'out'),
    E('e13', 'n11', 'n12'), E('e14', 'n12', 'n13'), E('e15', 'n13', 'n14'),
  ],
  next: 99, view: { x: 0, y: 0, zoom: 1 },
};

(async () => {
  ck('夹具/全节点型图校验零错误(区域规则全过)', V(ALL).length === 0, JSON.stringify(V(ALL)));
  ck('夹具/无警告(code 片段干净)', W(ALL).length === 0, JSON.stringify(W(ALL)));
  const js = G(ALL);
  ck('出码/meta 的 phases 与显式阶段带逐字一致',
     /phases: \[\{ title: "Scan", detail: "逐条目审计" \}, \{ title: "Judge" \}, \{ title: "Iterate" \}\]/.test(js), js.slice(0, 300));
  ck('出码/产物不含沙箱禁用调用', !/Date\.now\(\)|Math\.random\(\)/.test(js));
  ck('出码/成本条口径 = 代理数 × 循环上界(map 链 2 + 分支 1 + 循环 1×2 = 5)',
     (env.get('flowAgentEstimate(' + JSON.stringify(ALL) + ')') as number) === 5, String(env.get('flowAgentEstimate(' + JSON.stringify(ALL) + ')')));

  // ── 沙箱真跑:每种节点型都被执行到 ──
  const order: string[] = [];
  const rec = await runFlowScript(js, { paths: ['a.ts', 'b.ts'], flag: true }, {
    agent: async (prompt: string, opts: any) => { order.push(String(opts.label)); return 'R:' + String(opts.label); },
  });
  ck('sandbox/map 逐条目跑(2 条目 × 2 级 = audit ×2 + 汇总 ×2)+ 分支 true 支 + 循环 2 轮',
     order.filter(x => x.indexOf('audit:') === 0).length === 2 && order.filter(x => x === '汇总').length === 2
     && order.includes('是') && !order.includes('否') && order.filter(x => x === '迭代').length === 2, JSON.stringify(order));
  ck('sandbox/code 片段真的执行了(拿到循环结果的长度)', rec.ret && typeof rec.ret.v === 'object', JSON.stringify(rec.ret));
  const wf0 = (rec.workflows[0] || {}) as { ref?: any; args?: any };
  ck('sandbox/subflow 被调用一次且参数正确(路径引用 → { scriptPath })',
     rec.workflows.length === 1 && wf0.ref && wf0.ref.scriptPath === '/abs/triage.js'
     && wf0.args && typeof wf0.args.v === 'number', JSON.stringify(rec.workflows));
  ck('sandbox/log 写出运行期旁白(含 subflow 结果)', rec.logs.some(l => /完成/.test(l)), JSON.stringify(rec.logs));
  // 区域内的 agent 靠 opts.phase 归组(全局 phase() 在 pipeline/parallel 内有竞态,技能明训):
  // 断言"每次 agent 调用都带了正确档位",而不是"phase() 调用序列"——后者对区域图本就不完整。
  ck('sandbox/每个 agent 都带 phase opts,且档位覆盖阶段带全部三档',
     new Set(rec.calls.map(c => c.opts.phase)).size === 3
     && ['Scan', 'Judge', 'Iterate'].every(p => rec.calls.some(c => c.opts.phase === p)),
     JSON.stringify(rec.calls.map(c => [c.opts.label, c.opts.phase])));

  // 分支走 false 支:同样跑通(证明 cond 真的在起作用)
  const rec2 = await runFlowScript(js, { paths: ['a.ts'], flag: false }, {
    agent: async (_p: string, opts: any) => { order.push('F:' + String(opts.label)); return 'X'; },
  });
  ck('sandbox/cond=false 时走否支(且不跑是支)', order.filter(x => x === 'F:否').length === 1 && !order.includes('F:是'), JSON.stringify(order.slice(-6)));

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
