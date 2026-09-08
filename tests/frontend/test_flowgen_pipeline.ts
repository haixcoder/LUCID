// 生成器 map/pipeline 契约(1.2.53 · Phase 4,计划里唯一的 🔴 High 风险项):
// 语义等价**不看文本**,看沙箱真跑的到达顺序——无栅栏 = 条目 A 的 stage2 可以早于条目 B 的 stage1。
// 为什么必须这样钉:"按层 parallel 栅栏"与"逐条目 pipeline"是两种根本不同的调度,映射错会静默分叉语义。
import { load, makeCk, runFlowScript } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + ')') as string;
const V = (d: unknown): string[] => env.get('flowValidate(' + JSON.stringify(d) + ')') as string[];
const N = (id: string, type: string, x: number, y: number, data: any = {}): any => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string, sh = 'out', th = 'in'): any => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th });
const dft = (nodes: any[], edges: any[], extra: any = {}): any =>
  ({ v: 2, name: 'demo', desc: 'd', cwd: '/work/fix', nodes, edges, next: 99, view: { x: 0, y: 0, zoom: 1 },
     argsSpec: { schemaText: '{"type":"object","properties":{"paths":{"type":"array"}}}', exampleText: '{"paths":["a.ts"]}', required: false }, ...extra });
const ok = (d: any): boolean => { try { G(d); return true; } catch { return false; } };

// 链式两级:start → map(n2,**级1** 自带模板) → agent(n3,级2) → return(n4)
const MAP2 = {
  nodes: [N('n1', 'start', 0, 0, { note: 'q' }),
    N('n2', 'map', 200, 0, { items: 'ARGS.paths', prompt: '审计 {{item}} #{{index}}', label: 'audit:{{item}}', phase: 'Scan' }),
    N('n3', 'agent', 400, -60, { label: '复核', phase: 'Verify', prompt: '复核 {{n2}}' }),
    N('n4', 'return', 600, 0, { ret: '{ rows: n2 }' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')],
};
// 扇出级:start → map(n2) → agent(n3,stage1) → (n4a,n4b,stage2) → merge(n5) → return(n6)
const MAPFAN = {
  nodes: [N('n1', 'start', 0, 0, { note: 'q' }),
    N('n2', 'map', 200, 0, { items: 'ARGS.paths', prompt: '审计 {{item}}', label: 'audit:{{item}}' }),
    N('n3', 'agent', 400, 0, { label: '抽要点', phase: 'Scan', prompt: '抽 {{item}}' }),
    N('n4a', 'agent', 600, -80, { label: '正', phase: 'Verify', prompt: '正 {{n3}}' }),
    N('n4b', 'agent', 600, 80, { label: '反', phase: 'Verify', prompt: '反 {{n3}}' }),
    N('n5', 'merge', 800, 0, {}),
    N('n6', 'return', 1000, 0, { ret: '{ rows: n2 }' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4a'), E('e4', 'n3', 'n4b'),
    E('e5', 'n4a', 'n5'), E('e6', 'n4b', 'n5'), E('e7', 'n5', 'n6')],
};

(async () => {
  // ── 出码形状:map 节点持有整条 pipeline 的结果(变量绑定在 map 的 id 上)──
  const js = G(dft(MAP2.nodes, MAP2.edges));
  ck('生成/map 出码 = await pipeline(items, 回调…)', /const n2 = await pipeline\(ARGS\.paths,/.test(js), js.split('\n').slice(-6).join(' | '));
  ck('生成/级内节点不再各自出 const(它们是回调里的局部值,不是顶层变量)',
     !/const n3 = await agent/.test(js) && !/const n4 = await agent/.test(js), js);
  ck('生成/回调签名统一 (prev, item, i);{{item}}→item、{{index}}→i',
     /\(prev, item, i\) => agent\(`审计 \$\{item\} #\$\{i\}`/.test(js), js.split('\n').slice(-6).join(' | '));
  ck('生成/第二级用 {{上一级}} → prev', /\(prev, item, i\) => agent\(`复核 \$\{prev\}`/.test(js), js.split('\n').slice(-4).join(' | '));
  ck('生成/级内 agent 一律带 phase opts(pipeline 内不许靠全局 phase() 状态)',
     /label: `audit:\$\{item\}`, phase: "Scan"/.test(js) && /label: "复核", phase: "Verify"/.test(js), js.split('\n').slice(-4).join(' | '));

  const jsFan = G(dft(MAPFAN.nodes, MAPFAN.edges));
  ck('生成/扇出级 = () => parallel([…]) 回调(官方 review-changes 范式)',
     /\(prev, item, i\) => parallel\(\[\s*\(\) => agent\(`正 \$\{prev\}`/.test(jsFan), jsFan.split('\n').slice(-8).join(' | '));
  ck('生成/扇出级的两条代理各带自己的 phase', /label: "正", phase: "Verify"/.test(jsFan) && /label: "反", phase: "Verify"/.test(jsFan));

  // ── 沙箱真跑:无栅栏(到达顺序)+ 失败条目落 null ──
  // 判据:让条目 A 的第一级慢。无栅栏 → B 的第二级**早于** A 的第一级完成;栅栏 → 必须等 A 的第一级。
  const order: string[] = [];
  const slow = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
  const rec = await runFlowScript(js, { paths: ['A', 'B'] }, {
    agent: async (prompt: string) => {
      const isS1 = prompt.indexOf('审计') === 0;
      // 第二级靠第一级返回值认条目(第二级 prompt 是 `复核 ${prev}`)——这正是"参数真的传下去了"的副产品证据
      const item = isS1 ? (prompt.indexOf('审计 A') === 0 ? 'A' : 'B') : (prompt.indexOf('RA') >= 0 ? 'A' : 'B');
      if (isS1 && item === 'A') await slow(30);              // 条目 A 的第一级故意慢
      order.push((isS1 ? 'S1:' : 'S2:') + item);
      return isS1 ? 'R' + item : 'R2' + item;
    },
  });
  ck('sandbox/两级逐条目执行(2 条目 × 2 级 = 4 次调用)', rec.calls.length === 4, JSON.stringify(rec.calls.map(c => c.opts.label)));
  ck('sandbox/无栅栏:B 的第二级早于 A 的第一级完成(栅栏实现会反过来)',
     order.indexOf('S2:B') >= 0 && order.indexOf('S2:B') < order.indexOf('S1:A'), JSON.stringify(order));

  const recFail = await runFlowScript(js, { paths: ['ok', 'bad'] }, {
    agent: async (prompt: string, opts: any) => {
      if (prompt.indexOf('bad') >= 0 && prompt.indexOf('审计') === 0) throw new Error('boom');
      return 'R(' + String(opts.label) + ')';
    },
  });
  ck('sandbox/某条目某级抛错 → 该条目落 null 且跳过后续级,其余条目不受影响',
     recFail.ret && recFail.ret.rows && recFail.ret.rows.length === 2 && recFail.ret.rows[0] !== null && recFail.ret.rows[1] === null
     && recFail.calls.filter(c => String(c.opts.label).indexOf('复核') === 0).length === 1,
     JSON.stringify([recFail.ret, recFail.calls.map(c => c.opts.label)]));

  // ── 校验:级内嵌套 / 扇出不成汇合 / item 越界 / 链内变量外泄 / 同层冲突 ──
  const nestMap = {
    nodes: MAP2.nodes.concat([N('n9', 'map', 500, 120, { items: 'n3', prompt: 'x' })]),
    edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e9', 'n3', 'n9'), E('e10', 'n9', 'n4')],   // 把 n3→return 换成 n3→n9→return
  };
  ck('校验/级内嵌套 map → 报错并指向 code 节点',
     /嵌套|code 节点/.test(V(dft(nestMap.nodes, nestMap.edges)).join('|')) && !ok(dft(nestMap.nodes, nestMap.edges)),
     JSON.stringify(V(dft(nestMap.nodes, nestMap.edges))));
  const noMerge = { nodes: MAPFAN.nodes, edges: MAPFAN.edges.filter(e => e.id !== 'e6') };
  ck('校验/扇出级没汇于同一 merge → 报错', /扇出|汇/.test(V(dft(noMerge.nodes, noMerge.edges)).join('|')), JSON.stringify(V(dft(noMerge.nodes, noMerge.edges))));
  const itemOut = dft([N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'agent', 200, 0, { label: 'A', prompt: '裸用 {{item}}' }), N('n3', 'return', 400, 0, { ret: '' })],
    [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')]);
  ck('校验/{{item}}/{{index}} 只在 map 链内有意义 → 链外用报错且不出码',
     /item/.test(V(itemOut).join('|')) && !ok(itemOut), JSON.stringify(V(itemOut)));
  const leak = {
    nodes: MAP2.nodes.concat([N('n9', 'agent', 300, 200, { label: 'X', prompt: '用 {{n3}}' })]),
    edges: MAP2.edges.concat([E('e9', 'n1', 'n9'), E('e10', 'n9', 'n5')]),
  };
  ck('校验/链内节点变量泄漏到链外 → 报错(否则生成的脚本会 ReferenceError)',
     /链内|pipeline/.test(V(dft(leak.nodes, leak.edges)).join('|')), JSON.stringify(V(dft(leak.nodes, leak.edges))));
  ck('校验/items 为空 → 报错', /items/.test(V(dft(MAP2.nodes.map(n => n.id === 'n2' ? { ...n, data: { items: '' } } : n), MAP2.edges)).join('|')));
  const sameLevel = { nodes: MAP2.nodes.concat([N('n9', 'agent', 200, 200, { label: 'Y', prompt: 'y' })]), edges: MAP2.edges.concat([E('e9', 'n1', 'n9'), E('e10', 'n9', 'n5')]) };
  ck('校验/map 不能与其他步骤同层(它会独占一个 await 点)→ 报错',
     /同层|独占/.test(V(dft(sameLevel.nodes, sameLevel.edges)).join('|')), JSON.stringify(V(dft(sameLevel.nodes, sameLevel.edges))));
  ck('校验/合法 map 图零错误', V(dft(MAP2.nodes, MAP2.edges)).length === 0 && V(dft(MAPFAN.nodes, MAPFAN.edges)).length === 0,
     JSON.stringify([V(dft(MAP2.nodes, MAP2.edges)), V(dft(MAPFAN.nodes, MAPFAN.edges))]));

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
