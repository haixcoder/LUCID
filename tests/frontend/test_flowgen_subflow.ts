// 生成器 subflow 节点契约(1.2.57 · Phase 8,PRD §5.4 规则 4):workflow(name | {scriptPath}, args)
// ——子流**只有一层**(运行期嵌套即抛),所以"引用不存在的草稿"与"二层嵌套"都必须在生成前拦下。
import { load, makeCk, runFlowScript } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown, ctx?: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + (ctx ? ', ' + JSON.stringify(ctx) : '') + ')') as string;
const V = (d: unknown, ctx?: unknown): string[] => env.get('flowValidate(' + JSON.stringify(d) + (ctx ? ', ' + JSON.stringify(ctx) : '') + ')') as string[];
const N = (id: string, type: string, x: number, y: number, data: any = {}): any => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string, sh = 'out', th = 'in'): any => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th });
const dft = (nodes: any[], edges: any[], extra: any = {}): any =>
  ({ v: 2, name: 'demo', desc: 'd', cwd: '/work/fix', nodes, edges, next: 99, view: { x: 0, y: 0, zoom: 1 }, ...extra });
// argsSpec 让 argsExpr 里的 ARGS 有定义(Phase 2 的 args 契约;不写的话 ARGS 是未定义全局)
const ARGS_SPEC = { schemaText: '{"type":"object","properties":{"ids":{}}}', exampleText: '{"ids":[]}', required: false };
const subDraft = (data: any): any => dft([
  N('n1', 'start', 0, 0, { note: 'q' }),
  N('n2', 'subflow', 200, 0, data),
  N('n3', 'return', 400, 0, { ret: '{ v: n2 }' }),
], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')], { argsSpec: ARGS_SPEC });
const CTX = { drafts: [{ name: 'triage-issues' }, { name: 'outer', nested: true }] };

(async () => {
  // ── 出码 + 沙箱 ──
  const js = G(subDraft({ ref: 'triage-issues', argsExpr: '{ issues: ARGS.ids }' }), CTX);
  ck('生成/按名引用 → await workflow("名字", 参数表达式)',
     /const n2 = await workflow\("triage-issues", \{ issues: ARGS\.ids \}\)/.test(js), js.split('\n').slice(-3).join(' | '));
  const r = await runFlowScript(js, { ids: [1, 2] }, {});
  ck('sandbox/workflow(name, args) 参数正确传下去(实参真求值)',
     r.workflows.length === 1 && r.workflows[0].ref === 'triage-issues'
     && JSON.stringify(r.workflows[0].args) === '{"issues":[1,2]}', JSON.stringify(r.workflows[0]));
  const jsPath = G(subDraft({ ref: '/abs/dir/my-flow.js', argsExpr: 'ARGS' }), CTX);
  ck('生成/路径引用 → workflow({ scriptPath: "…" }, …)(路径以 / 或 . 开头即按路径处理)',
     /await workflow\(\{ scriptPath: "\/abs\/dir\/my-flow\.js" \}, ARGS\)/.test(jsPath), jsPath.split('\n').slice(-3).join(' | '));
  const jsNoArgs = G(subDraft({ ref: 'triage-issues', argsExpr: '' }), CTX);
  ck('生成/没写参数表达式 → 不传第二个实参(不发明 args)', /await workflow\("triage-issues"\)/.test(jsNoArgs), jsNoArgs.split('\n').slice(-3).join(' | '));

  // ── 校验:引用存在性 + 嵌套深度 ──
  ck('校验/ref 为空 → 报错', /ref|引用/.test(V(subDraft({ ref: '' }), CTX).join('|')), JSON.stringify(V(subDraft({ ref: '' }), CTX)));
  ck('校验/引用不存在的草稿 → 报错(名字不在已保存列表里)',
     /不存在|未找到/.test(V(subDraft({ ref: 'nope' }), CTX).join('|')), JSON.stringify(V(subDraft({ ref: 'nope' }), CTX)));
  ck('校验/引用已保存的草稿 → 放行', V(subDraft({ ref: 'triage-issues' }), CTX).length === 0);
  ck('校验/子流内再 subflow(二层嵌套)→ 报错',
     /嵌套|一层/.test(V(subDraft({ ref: 'outer' }), CTX).join('|')), JSON.stringify(V(subDraft({ ref: 'outer' }), CTX)));
  ck('校验/路径引用不做存在性检查(路径可能还没分发,交给运行期)',
     V(subDraft({ ref: '/abs/dir/x.js' }), CTX).length === 0, JSON.stringify(V(subDraft({ ref: '/abs/dir/x.js' }), CTX)));
  ck('校验/没有草稿上下文时只查形状(不假装知道存在性)',
     V(subDraft({ ref: 'whatever' })).length === 0 && V(subDraft({ ref: '' })).length > 0);
  ck('校验/subflow 结果可被下游 {{nX}} 引用(与普通节点同待遇)',
     (() => { try { G(dft([N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'subflow', 200, 0, { ref: 'triage-issues' }),
       N('n3', 'agent', 400, 0, { label: 'X', prompt: '用 {{n2}}' }), N('n4', 'return', 600, 0, { ret: '' })],
       [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')]), CTX); return true; } catch { return false; } })());

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
