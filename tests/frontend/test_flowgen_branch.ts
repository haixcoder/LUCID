// 生成器 branch/merge 契约(1.2.54 · Phase 5):区域规则(可达集不相交 + 同终止点)的正反例 +
// 沙箱真跑"条件真/假各跑一次,只调用对应分支的代理,merge 处变量可见"。
import { load, makeCk, runFlowScript } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + ')') as string;
const V = (d: unknown): string[] => env.get('flowValidate(' + JSON.stringify(d) + ')') as string[];
const N = (id: string, type: string, x: number, y: number, data: any = {}): any => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string, sh = 'out', th = 'in'): any => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th });
const dft = (nodes: any[], edges: any[], extra: any = {}): any =>
  ({ v: 2, name: 'demo', desc: 'd', cwd: '/work/fix', nodes, edges, next: 99, view: { x: 0, y: 0, zoom: 1 }, ...extra });
const ok = (d: any): boolean => { try { G(d); return true; } catch { return false; } };

// 汇合式:start → branch → true:n3 / false:n4 → merge n5 → return n6
const BR = {
  nodes: [N('n1', 'start', 0, 0, { note: 'q' }),
    N('n2', 'branch', 200, 0, { cond: "args === 'yes'" }),
    N('n3', 'agent', 400, -80, { label: '是', phase: 'A', prompt: '是 {{n1}}' }),
    N('n4', 'agent', 400, 80, { label: '否', phase: 'B', prompt: '否 {{n1}}' }),
    N('n5', 'merge', 600, 0, {}),
    N('n6', 'return', 800, 0, { ret: '{ m: n5 }' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3', 'true'), E('e3', 'n2', 'n4', 'false'),
    E('e4', 'n3', 'n5'), E('e5', 'n4', 'n5'), E('e6', 'n5', 'n6')],
};
// 各自到 return(无 merge):两分支都终止于同一个 Return
const BRT = {
  nodes: [N('n1', 'start', 0, 0, { note: 'q' }),
    N('n2', 'branch', 200, 0, { cond: "args === 'yes'" }),
    N('n3', 'agent', 400, -80, { label: '是', phase: 'A', prompt: '是' }),
    N('n4', 'agent', 400, 80, { label: '否', phase: 'B', prompt: '否' }),
    N('n5', 'return', 600, 0, { ret: '{ ok: true }' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3', 'true'), E('e3', 'n2', 'n4', 'false'), E('e4', 'n3', 'n5'), E('e5', 'n4', 'n5')],
};

(async () => {
  // ── 出码形状 ──
  const js = G(dft(BR.nodes, BR.edges));
  ck('生成/汇合式 = let <merge>; if (cond) {…} else {…}', /let n5;\s*\nif \(args === 'yes'\) \{/.test(js), js.split('\n').slice(-10).join(' | '));
  ck('生成/两条分支各自 await,末级结果直接赋给 merge 变量(省一层中间变量)',
     /n5 = await agent\(`是 \$\{Q\}`/.test(js) && /n5 = await agent\(`否 \$\{Q\}`/.test(js), js.split('\n').slice(-10).join(' | '));
  ck('生成/分支节点自身不出码(它的 cond 就是 if 的条件)', !/const n2 = await/.test(js));
  ck('生成/分支内节点不再是顶层变量(块作用域)', !/^\s*const n3 = await/m.test(js.split('if (')[0]));
  const jt = G(dft(BRT.nodes, BRT.edges));
  ck('生成/无 merge(各自到 return):if/else 后仍是顶层 return,无 let',
     /if \(args === 'yes'\) \{/.test(jt) && /\nreturn \{ ok: true \}/.test(jt) && !/let n5;/.test(jt), jt.split('\n').slice(-8).join(' | '));

  // ── 沙箱真跑:cond 真/假各一次,只调用对应分支;merge 变量可见 ──
  const rTrue = await runFlowScript(js, 'yes');
  const rFalse = await runFlowScript(js, 'no');
  ck('sandbox/cond 真 → 只调用 true 分支的代理', rTrue.calls.length === 1 && rTrue.calls[0].opts.label === '是', JSON.stringify(rTrue.calls.map(c => c.opts.label)));
  ck('sandbox/cond 假 → 只调用 false 分支的代理', rFalse.calls.length === 1 && rFalse.calls[0].opts.label === '否', JSON.stringify(rFalse.calls.map(c => c.opts.label)));
  ck('sandbox/merge 变量在分支外可见(return 拿到分支结果)',
     rTrue.ret && rTrue.ret.m === 'R(是)' && rFalse.ret && rFalse.ret.m === 'R(否)', JSON.stringify([rTrue.ret, rFalse.ret]));
  const rt = await runFlowScript(jt, 'yes');
  ck('sandbox/无 merge 时 return 照常拿到结果', rt.ret && rt.ret.ok === true && rt.calls.length === 1, JSON.stringify([rt.ret, rt.calls.length]));

  // ── 区域规则正反例 ──
  ck('校验/合法汇合图零错误', V(dft(BR.nodes, BR.edges)).length === 0, JSON.stringify(V(dft(BR.nodes, BR.edges))));
  ck('校验/各自到 return 的合法形态被接受', V(dft(BRT.nodes, BRT.edges)).length === 0, JSON.stringify(V(dft(BRT.nodes, BRT.edges))));
  const noFalse = { nodes: BR.nodes, edges: BR.edges.filter(e => e.id !== 'e3') };
  ck('校验/false 分支没连 → 报错', /false/.test(V(dft(noFalse.nodes, noFalse.edges)).join('|')), JSON.stringify(V(dft(noFalse.nodes, noFalse.edges))));
  const noCond = { nodes: BR.nodes.map(n => n.id === 'n2' ? { ...n, data: { cond: '' } } : n), edges: BR.edges };
  ck('校验/cond 为空 → 报错', /cond|条件/.test(V(dft(noCond.nodes, noCond.edges)).join('|')), JSON.stringify(V(dft(noCond.nodes, noCond.edges))));
  // 区域相交:n3 与 n4 都连到同一个中间节点 n7(还没到 merge)
  const cross = {
    nodes: BR.nodes.concat([N('n7', 'agent', 500, 0, { label: 'C', prompt: 'c' })]),
    edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3', 'true'), E('e3', 'n2', 'n4', 'false'),
      E('e4', 'n3', 'n7'), E('e5', 'n4', 'n7'), E('e6', 'n7', 'n5'), E('e7', 'n5', 'n6')],
  };
  ck('校验/两条分支在汇合前相遇(区域相交)→ 报错',
     /分支|区域/.test(V(dft(cross.nodes, cross.edges)).join('|')) && !ok(dft(cross.nodes, cross.edges)),
     JSON.stringify(V(dft(cross.nodes, cross.edges))));
  // 终止点不同:n3 直接到 return n6,n4 到 merge n5
  const diffEnd = {
    nodes: BR.nodes,
    edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3', 'true'), E('e3', 'n2', 'n4', 'false'),
      E('e4', 'n3', 'n6'), E('e5', 'n4', 'n5'), E('e6', 'n5', 'n6')],
  };
  ck('校验/两条分支终止点不同 → 报错', /终止|merge/.test(V(dft(diffEnd.nodes, diffEnd.edges)).join('|')), JSON.stringify(V(dft(diffEnd.nodes, diffEnd.edges))));
  // 嵌套:分支区域内再放一个 branch
  const nest = {
    nodes: BR.nodes.concat([N('n7', 'branch', 500, -160, { cond: 'true' }), N('n8', 'agent', 600, -160, { label: 'D', prompt: 'd' })]),
    edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3', 'true'), E('e3', 'n2', 'n4', 'false'),
      E('e4', 'n3', 'n7'), E('e5', 'n7', 'n8', 'true'), E('e6', 'n7', 'n8', 'false'), E('e7', 'n8', 'n5'), E('e8', 'n4', 'n5'), E('e9', 'n5', 'n6')],
  };
  ck('校验/分支区域内嵌套 branch → 报错并指向 code 节点',
     /嵌套|code 节点/.test(V(dft(nest.nodes, nest.edges)).join('|')) && !ok(dft(nest.nodes, nest.edges)),
     JSON.stringify(V(dft(nest.nodes, nest.edges))));
  const leak = {
    nodes: BR.nodes.concat([N('n7', 'agent', 400, 200, { label: 'X', prompt: '用 {{n3}}' })]),
    edges: BR.edges.concat([E('e7', 'n1', 'n7'), E('e8', 'n7', 'n6')]),
  };
  ck('校验/分支内变量泄漏到分支外 → 报错', /分支|块/.test(V(dft(leak.nodes, leak.edges)).join('|')), JSON.stringify(V(dft(leak.nodes, leak.edges))));
  const sameLevel = { nodes: BR.nodes.concat([N('n7', 'agent', 200, 200, { label: 'Y', prompt: 'y' })]), edges: BR.edges.concat([E('e7', 'n1', 'n7'), E('e8', 'n7', 'n6')]) };
  ck('校验/branch 不能与其他步骤同层(它会独占 if/else)', /同层|独占/.test(V(dft(sameLevel.nodes, sameLevel.edges)).join('|')),
     JSON.stringify(V(dft(sameLevel.nodes, sameLevel.edges))));

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
