// 生成器 loop 契约(1.2.55 · Phase 6):单入口单出口区域校验 + while 上界 + budget 守卫两条执行路径
// + 代理数估算单点(成本条口径)。执行断言走沙箱真跑:跑满 maxRounds 与"预算不足提前 break"各一条。
import { load, makeCk, runFlowScript } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + ')') as string;
const V = (d: unknown): string[] => env.get('flowValidate(' + JSON.stringify(d) + ')') as string[];
const EST = (d: unknown): number => env.get('flowAgentEstimate(' + JSON.stringify(d) + ')') as number;
const N = (id: string, type: string, x: number, y: number, data: any = {}): any => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string, sh = 'out', th = 'in'): any => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th });
const dft = (nodes: any[], edges: any[], extra: any = {}): any =>
  ({ v: 2, name: 'demo', desc: 'd', cwd: '/work/fix', nodes, edges, next: 99, view: { x: 0, y: 0, zoom: 1 }, ...extra });
const ok = (d: any): boolean => { try { G(d); return true; } catch { return false; } };

// start → loop(n2) → body:n3 → 回边 n3→n2;loop.out → return(n4)
const LOOP = {
  nodes: [N('n1', 'start', 0, 0, { note: 'q' }),
    N('n2', 'loop', 200, 0, { cond: 'true', maxRounds: 3, budgetGuard: true }),
    N('n3', 'agent', 400, 0, { label: '迭代', phase: 'R', prompt: '迭代' }),
    N('n4', 'return', 600, 0, { ret: '{ v: n2 }' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3', 'body'), E('e3', 'n3', 'n2'), E('e4', 'n2', 'n4', 'out')],
};

(async () => {
  // ── 出码形状 ──
  const js = G(dft(LOOP.nodes, LOOP.edges));
  ck('生成/while 上界 = cond && round < maxRounds', /while \(\(true\) && round < 3\) \{/.test(js), js.split('\n').slice(-8).join(' | '));
  ck('生成/budget 守卫在循环体开头(先看预算再干活)',
     /if \(budget\.total && budget\.remaining\(\) < \d+\) \{ log\('预算将尽,提前收束'\); break \}/.test(js), js.split('\n').slice(-8).join(' | '));
  ck('生成/循环变量在循环外声明(循环后可见),体末结果赋给它',
     /let n2;/.test(js) && /n2 = await agent\(/.test(js) && /\nreturn \{ v: n2 \}/.test(js), js.split('\n').slice(-9).join(' | '));
  ck('生成/体末不重复出顶层 const(体节点被 while 块消化)', !/const n3 = await/.test(js), js.split('\n').slice(-8).join(' | '));
  const jsNoGuard = G(dft(LOOP.nodes.map(n => n.id === 'n2' ? { ...n, data: { ...n.data, budgetGuard: false } } : n), LOOP.edges));
  ck('生成/没勾预算守卫就不出守卫(不替用户做没勾的事)', !/budget\.remaining/.test(jsNoGuard), jsNoGuard.split('\n').slice(-6).join(' | '));

  // ── 沙箱真跑:跑满 / 预算不足提前 break ──
  const rFull = await runFlowScript(js, undefined, { budget: { total: 1e9, remaining: () => 1e9 } });
  ck('sandbox/跑满 maxRounds 后退出(3 轮 → 3 次调用)', rFull.calls.length === 3, JSON.stringify(rFull.calls.length));
  ck('sandbox/循环变量拿到最后一轮的值', rFull.ret && rFull.ret.v === 'R(迭代)', JSON.stringify(rFull.ret));
  const rBreak = await runFlowScript(js, undefined, { budget: { total: 100000, remaining: () => 0 } });
  ck('sandbox/预算不足 → 第一轮就 break(0 次调用)', rBreak.calls.length === 0, JSON.stringify(rBreak.calls.length));
  ck('sandbox/提前收束要留 log 旁白(不静默截断)', rBreak.logs.some(l => /预算将尽/.test(l)), JSON.stringify(rBreak.logs));
  ck('sandbox/无 budget 全局(total=null)时守卫短路,循环照常跑满',
     (await runFlowScript(js, undefined, { budget: { total: null, remaining: () => 0 } })).calls.length === 3);

  // ── 区域规则 1(单入口单出口)正反例 ──
  ck('校验/合法循环图零错误', V(dft(LOOP.nodes, LOOP.edges)).length === 0, JSON.stringify(V(dft(LOOP.nodes, LOOP.edges))));
  const multiIn = { nodes: LOOP.nodes, edges: LOOP.edges.concat([E('e9', 'n1', 'n3')]) };   // 体首多一个外部入口
  ck('校验/循环体多入口 → 报错', /单入口|入口/.test(V(dft(multiIn.nodes, multiIn.edges)).join('|')), JSON.stringify(V(dft(multiIn.nodes, multiIn.edges))));
  const multiOut = {
    nodes: LOOP.nodes.concat([N('n9', 'agent', 400, 200, { label: 'X', prompt: 'x' })]),
    edges: LOOP.edges.concat([E('e9', 'n3', 'n9')]),                                        // 体末还有一条出口
  };
  ck('校验/循环体多出口 → 报错', /单出口|出口/.test(V(dft(multiOut.nodes, multiOut.edges)).join('|')), JSON.stringify(V(dft(multiOut.nodes, multiOut.edges))));
  const plainCycle = {
    nodes: [N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'agent', 200, 0, { label: 'A', prompt: 'a' }),
      N('n3', 'agent', 400, 0, { label: 'B', prompt: 'b' }), N('n4', 'return', 600, 0, { ret: '' })],
    edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n2'), E('e4', 'n3', 'n4')],
  };
  ck('校验/非 loop 回边构成的环仍报错(既有环检测不放松)',
     /环/.test(V(dft(plainCycle.nodes, plainCycle.edges)).join('|')) && !ok(dft(plainCycle.nodes, plainCycle.edges)),
     JSON.stringify(V(dft(plainCycle.nodes, plainCycle.edges))));
  const badRounds = { nodes: LOOP.nodes.map(n => n.id === 'n2' ? { ...n, data: { ...n.data, maxRounds: 0 } } : n), edges: LOOP.edges };
  ck('校验/maxRounds < 1 → 报错', /maxRounds/.test(V(dft(badRounds.nodes, badRounds.edges)).join('|')), JSON.stringify(V(dft(badRounds.nodes, badRounds.edges))));
  const noCond = { nodes: LOOP.nodes.map(n => n.id === 'n2' ? { ...n, data: { ...n.data, cond: '' } } : n), edges: LOOP.edges };
  ck('校验/cond 为空 → 报错', /cond|条件/.test(V(dft(noCond.nodes, noCond.edges)).join('|')), JSON.stringify(V(dft(noCond.nodes, noCond.edges))));
  const leak = {
    nodes: LOOP.nodes.concat([N('n9', 'agent', 400, 200, { label: 'X', prompt: '用 {{n3}}' })]),
    edges: LOOP.edges.concat([E('e9', 'n2', 'n9'), E('e10', 'n9', 'n4')]),
  };
  ck('校验/循环体内变量泄漏到循环外 → 报错', /循环|区域|不可见/.test(V(dft(leak.nodes, leak.edges)).join('|')), JSON.stringify(V(dft(leak.nodes, leak.edges))));

  // ── 代理数估算单点(成本条口径)──
  ck('估算/agent 数 × 所在 loop 的 maxRounds', EST(dft(LOOP.nodes, LOOP.edges)) === 3, String(EST(dft(LOOP.nodes, LOOP.edges))));
  const twoLoops = {
    nodes: LOOP.nodes.concat([N('n5', 'loop', 600, 200, { cond: 'true', maxRounds: 2, budgetGuard: false }), N('n6', 'agent', 800, 200, { label: 'Y', prompt: 'y' })]),
    edges: LOOP.edges.filter(e => e.id !== 'e4').concat([E('e5', 'n2', 'n5', 'out'), E('e6', 'n5', 'n6', 'body'), E('e7', 'n6', 'n5'), E('e8', 'n5', 'n4', 'out')]),
  };
  ck('估算/循环外的 agent 算 1、循环内的按上界乘(3 + 2 = 5)', EST(dft(twoLoops.nodes, twoLoops.edges)) === 5, String(EST(dft(twoLoops.nodes, twoLoops.edges))));

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
