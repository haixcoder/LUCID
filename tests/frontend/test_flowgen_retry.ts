// 生成器 agent 选项 / retry / log 契约(1.2.56 · Phase 7):
// ① effort/agentType/isolation 落到 opts;② phase 在**单节点层也发**(pipeline/parallel 内必须用它);
// ③ $retry 助手全图只生成一次,形状与官方 scan.js 同构(log + 指数退避 setTimeout);
// ④ log 节点出 log(`…`) 且 {{nX}} 正确解析。执行语义全部走沙箱真跑(首次失败→退避→成功/耗尽)。
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

const AG = {
  nodes: [N('n1', 'start', 0, 0, { note: 'q' }),
    N('n2', 'agent', 200, 0, { label: 'A', phase: 'P', prompt: 'a', effort: 'low', agentType: 'code-reviewer', isolation: true, retryN: 2, retryMs: 100 }),
    N('n3', 'return', 400, 0, { ret: '{ v: n2 }' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')],
};
const PLAIN = {
  nodes: [N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'agent', 200, 0, { label: 'A', phase: 'P', prompt: 'a' }), N('n3', 'return', 400, 0, { ret: '' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')],
};
const LOG = {
  nodes: [N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'agent', 200, 0, { label: 'A', phase: 'P', prompt: 'a' }),
    N('n3', 'log', 400, 0, { text: '得到 {{n2}}' }), N('n4', 'return', 600, 0, { ret: '' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')],
};

(async () => {
  // ── agent 选项落 opts ──
  const js = G(dft(AG.nodes, AG.edges));
  ck('opts/effort 落到 opts', /effort: "low"/.test(js), js.split('\n').slice(-4).join(' | '));
  ck('opts/agentType 落到 opts(命名空间前缀原样保留)', /agentType: "code-reviewer"/.test(js));
  ck('opts/isolation 开关 → isolation: "worktree"(只有这一个合法值)', /isolation: "worktree"/.test(js));
  ck('phase/单节点层也发 phase opts(pipeline/parallel 内靠它归组,不能只靠全局 phase())',
     /label: "A", phase: "P"/.test(G(dft(PLAIN.nodes, PLAIN.edges))), G(dft(PLAIN.nodes, PLAIN.edges)).split('\n').slice(-3).join(' | '));
  ck('opts/没勾选就不落码(默认路径不漂移)',
     !/effort|agentType|isolation/.test(G(dft(PLAIN.nodes, PLAIN.edges))));

  // ── $retry 助手:全图只生成一次,形状与官方 scan.js 同构 ──
  ck('retry/勾了 retry 的节点走 $retry(prompt, opts, n, backoffMs)',
     /const n2 = await \$retry\("a", \{ label: "A", phase: "P", effort: "low", agentType: "code-reviewer", isolation: "worktree" \}, 2, 100\)/.test(js),
     js.split('\n').slice(-4).join(' | '));
  ck('retry/助手定义 = async function $retry(…)(log + 指数退避 setTimeout,与官方 scan.js 同构)',
     /async function \$retry\(prompt, opts, n, backoffMs\)/.test(js) && /log\(`\$\{label\} 失败,\$\{backoffMs \* 2 \*\* k\}ms 后重试`\)/.test(js)
     && /setTimeout\(res, backoffMs \* 2 \*\* k\)/.test(js), js.slice(0, 400));
  const twice = {
    nodes: AG.nodes.concat([N('n5', 'agent', 200, 200, { label: 'B', phase: 'P', prompt: 'b', retryN: 1, retryMs: 50 })]),
    edges: AG.edges.concat([E('e5', 'n1', 'n5'), E('e6', 'n5', 'n3')]),
  };
  ck('retry/助手全图只生成一次(两个节点都勾了也只一份)',
     (G(dft(twice.nodes, twice.edges)).match(/async function \$retry\(/g) || []).length === 1);
  ck('retry/没勾 retry 时不出助手(空助手 = 噪音)', !/\$retry/.test(G(dft(PLAIN.nodes, PLAIN.edges))));

  // ── 沙箱真跑:首次失败 → 退避 → 成功;耗尽 → null ──
  let n = 0;
  const r = await runFlowScript(js, undefined, { agent: async () => (n++ === 0 ? null : 'OK') });
  ck('sandbox/首次返回 null → 重试后成功', r.calls.length === 2 && r.ret && r.ret.v === 'OK', JSON.stringify([r.calls.length, r.ret]));
  ck('sandbox/重试日志含 retry1 与退避毫秒数(1x 基数)',
     r.logs.some(l => /retry1/.test(l)) && r.logs.some(l => /100ms/.test(l)), JSON.stringify(r.logs));
  ck('sandbox/重试调用换了 label(带上 :retryN,便于 /workflows 里认出)', r.calls[1].opts.label === 'A:retry1', JSON.stringify(r.calls.map(c => c.opts.label)));
  let m = 0;
  const rEx = await runFlowScript(js, undefined, { agent: async () => (m++, null) });
  ck('sandbox/耗尽(1 次原调 + 2 次重试)后返回 null,不抛', rEx.calls.length === 3 && rEx.ret && rEx.ret.v === null,
     JSON.stringify([rEx.calls.length, rEx.ret]));
  const backoffs = rEx.logs.map(l => (/(\d+)ms/.exec(l) || [])[1]).filter(Boolean).map(Number);
  ck('sandbox/退避序列 = 基数 × 2^k(100 / 200)', backoffs.length === 2 && backoffs[0] === 100 && backoffs[1] === 200, JSON.stringify(backoffs));

  // ── log 节点 ──
  const ljs = G(dft(LOG.nodes, LOG.edges));
  ck('log/节点出 log(`…`),{{nX}} 解析成运行期变量', /log\(`得到 \$\{n2\}`\)/.test(ljs), ljs.split('\n').slice(-4).join(' | '));
  const rl = await runFlowScript(ljs, undefined, { agent: async () => 'V' });
  ck('sandbox/log 真的写到运行期(内容含上游结果)', rl.logs.some(l => l === '得到 V'), JSON.stringify(rl.logs));

  // ── 校验:effort / model 白名单 ──
  ck('校验/effort 五档外 → 报错', /effort/.test(V(dft(PLAIN.nodes.map(x => x.id === 'n2' ? { ...x, data: { ...x.data, effort: 'turbo' } } : x), PLAIN.edges)).join('|')));
  ck('校验/effort 五档内全放行',
     ['low', 'medium', 'high', 'xhigh', 'max'].every(e =>
       V(dft(PLAIN.nodes.map(x => x.id === 'n2' ? { ...x, data: { ...x.data, effort: e } } : x), PLAIN.edges)).length === 0));
  ck('校验/model 白名单:别名与 claude-* 全放行,其它报错',
     V(dft(PLAIN.nodes.map(x => x.id === 'n2' ? { ...x, data: { ...x.data, model: 'claude-fable-5-1' } } : x), PLAIN.edges)).length === 0
     && /不在白名单/.test(V(dft(PLAIN.nodes.map(x => x.id === 'n2' ? { ...x, data: { ...x.data, model: 'gpt-5' } } : x), PLAIN.edges)).join('|')));
  ck('校验/retryN 非负整数(0=关)', /retry/.test(V(dft(AG.nodes.map(x => x.id === 'n2' ? { ...x, data: { ...x.data, retryN: -1 } } : x), AG.edges)).join('|'))
     && V(dft(AG.nodes.map(x => x.id === 'n2' ? { ...x, data: { ...x.data, retryN: 0 } } : x), AG.edges)).length === 0,
     JSON.stringify(V(dft(AG.nodes.map(x => x.id === 'n2' ? { ...x, data: { ...x.data, retryN: -1 } } : x), AG.edges))));

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
