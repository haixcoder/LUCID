// 生成器 args 契约(1.2.51 · Phase 2):ARGS 解析块 + 必填前置校验块 + JSON Schema 根形状预校验单点。
// 判据是"沙箱真跑":对象 args 与字符串化 JSON args 必须得到**相同**调用序列(否则两条通路语义分叉)。
// schema 根形状单点:agent.schemaText 与 argsSpec.schemaText 共用——测试断言两者错误形状一致。
import { load, makeCk, runFlowScript } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + ')') as string;
const V = (d: unknown): string[] => env.get('flowValidate(' + JSON.stringify(d) + ')') as string[];
const demo = (extra: Record<string, unknown> = {}): any =>
  Object.assign(env.get('(function(){flowSeedDemo();return JSON.parse(JSON.stringify(flowDraft()))})()'), extra);
const dft = (nodes: any[], edges: any[], extra: any = {}): any =>
  ({ v: 2, name: 'demo', desc: 'd', cwd: '/work/fix', nodes, edges, next: 99, view: { x: 0, y: 0, zoom: 1 }, ...extra });
const N = (id: string, type: string, x: number, y: number, data: any = {}): any => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string): any => ({ id, source: s, sourceHandle: 'out', target: t, targetHandle: 'in' });
const CHAIN = {
  nodes: [N('n1', 'start', 0, 0, { note: '输入' }), N('n2', 'agent', 200, 0, { label: 'A', phase: 'P1', prompt: '第一步 {{n1}}' }), N('n3', 'return', 400, 0, { ret: '' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')],
};
const SCHEMA = JSON.stringify({ type: 'object', properties: { paths: { type: 'array' } }, required: ['paths'] });
const spec = (extra: any = {}): any => ({ schemaText: SCHEMA, exampleText: '{"paths":["a.ts"]}', required: true, ...extra });
const PARSE = 'const ARGS = (typeof args === \'string\') ? JSON.parse(args) : args';

(async () => {
  // ── 零 diff:没声明 argsSpec 时产物与 v1 逐字节同源(空字段不落码) ──
  ck('argsSpec/全空 → 不生成 ARGS 块(空字段不落码)', !/const ARGS/.test(G(demo())), G(demo()).slice(0, 120));
  ck('argsSpec/全空 → 校验零错误', V(demo()).length === 0, JSON.stringify(V(demo())));

  // ── 解析块 ──
  const js = G(demo({ argsSpec: spec() }));
  ck('生成/含 ARGS 解析块(对象与字符串化 JSON 两条通路同源)', js.includes(PARSE), js.split('\n').slice(3, 8).join(' | '));
  ck('生成/required 开启 → 前置校验块含缺失字段名 paths',
     /if \(typeof ARGS\.paths === 'undefined'\) throw new Error\("args 缺少字段:paths"\)/.test(js), js.split('\n').slice(3, 9).join(' | '));
  ck('生成/required 关闭 → 只解析不校验(不替用户做没勾的检查)',
     G(demo({ argsSpec: spec({ required: false }) })).includes(PARSE)
     && !/throw new Error\("args 缺少字段/.test(G(demo({ argsSpec: spec({ required: false }) }))));
  ck('生成/有 ARGS 时 Q 从 ARGS 派生(对象与字符串化两条通路落到同一个 Q)',
     /const Q = \(typeof ARGS === 'string' && ARGS\.trim\(\)\) \|\| "调研选题"/.test(js), js.split('\n').slice(4, 8).join(' | '));
  ck('生成/前置块在首个 phase() 之前(参数不合法就别开始跑代理)',
     js.indexOf(PARSE) < js.indexOf('phase('), String(js.indexOf(PARSE)) + ' vs ' + String(js.indexOf('phase(')));

  // ── 沙箱真跑:两条通路同序列;缺参抛可读错误(用单代理链,调用序列好读)──
  const cjs = G(dft(CHAIN.nodes, CHAIN.edges, { argsSpec: spec() }));
  const rObj = await runFlowScript(cjs, { paths: ['a.ts'] });
  const rStr = await runFlowScript(cjs, '{"paths":["a.ts"]}');
  ck('sandbox/对象 args 跑通且调用序列完整', rObj.calls.length === 1 && rObj.calls[0].prompt === '第一步 输入', JSON.stringify(rObj.calls.map(c => c.prompt)));
  ck('sandbox/字符串化 JSON args 与对象 args 得到相同调用序列(两条通路不分叉)',
     JSON.stringify(rStr.calls) === JSON.stringify(rObj.calls) && JSON.stringify(rStr.ret) === JSON.stringify(rObj.ret),
     JSON.stringify([rObj.calls, rStr.calls]));
  let thrown = '';
  try { await runFlowScript(cjs, { other: 1 }); } catch (e) { thrown = String((e as Error).message); }
  ck('sandbox/缺必填字段 → 抛错且错误信息含字段名(不是 undefined is not an object)',
     thrown.includes('args 缺少字段:paths'), thrown);
  let thrown2 = '';
  try { await runFlowScript(cjs, undefined); } catch (e) { thrown2 = String((e as Error).message); }
  ck('sandbox/完全没传 args → 可读错误', /缺少 args/.test(thrown2), thrown2);

  // ── JSON Schema 根形状预校验(单点:agent.schemaText 与 argsSpec.schemaText 共用)──
  const badRoot = JSON.stringify({ type: 'array', items: {} });
  const noProps = JSON.stringify({ type: 'object' });
  const reqGap = JSON.stringify({ type: 'object', properties: { a: {} }, required: ['a', 'b'] });
  const agentErr = (st: string): string[] => V(dft([N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'agent', 200, 0, { label: 'A', schemaText: st }), N('n3', 'return', 400, 0, { ret: '' })], CHAIN.edges));
  const argsErr = (st: string): string[] => V(demo({ argsSpec: spec({ schemaText: st }) }));
  ck('schema 根形状/type 非 object → 报错(agent 与 args 同一单点)',
     /根须为 \{type:'object', properties/.test(agentErr(badRoot).join('|')) && /根须为 \{type:'object', properties/.test(argsErr(badRoot).join('|')),
     JSON.stringify([agentErr(badRoot), argsErr(badRoot)]));
  ck('schema 根形状/缺 properties → 报错(两处同形状)', /根须为/.test(agentErr(noProps).join('|')) && /根须为/.test(argsErr(noProps).join('|')));
  ck('schema 根形状/required ⊄ properties → 报错并点名缺的键(两处同形状)',
     /b/.test(agentErr(reqGap).join('|')) && /b/.test(argsErr(reqGap).join('|')),
     JSON.stringify([agentErr(reqGap), argsErr(reqGap)]));
  ck('schema 根形状/合法 schema 放行(两处)',
     agentErr(SCHEMA).length === 0 && argsErr(SCHEMA).length === 0, JSON.stringify([agentErr(SCHEMA), argsErr(SCHEMA)]));
  ck('schema 根形状/既有的"非法 JSON/非对象"两类错误不回归',
     /schema 不是合法 JSON/.test(agentErr('{bad').join('|')) && /需为 JSON 对象/.test(agentErr('[1]').join('|')));

  // ── 示例 JSON 校验 ──
  ck('args 示例/非法 JSON → 校验报错且不出码',
     /示例不是合法 JSON/.test(V(demo({ argsSpec: spec({ exampleText: '{bad' }) })).join('|'))
     && (function () { try { G(demo({ argsSpec: spec({ exampleText: '{bad' }) })); return false; } catch { return true; } })());
  ck('args 示例/合法 JSON 放行', V(demo({ argsSpec: spec({ exampleText: '{"paths":["x"]}' }) })).length === 0);
  ck('args 示例/留空放行(示例是可选文档,不是契约)', V(demo({ argsSpec: spec({ exampleText: '' }) })).length === 0);

  // ── 无 schema 只勾必填:退化为"ARGS 必须是个对象" ──
  const js2 = G(dft(CHAIN.nodes, CHAIN.edges, { argsSpec: { schemaText: '', exampleText: '', required: true } }));
  ck('生成/无 schema 只勾必填 → 只校验 ARGS 是对象(不发明字段)', /缺少 args/.test(js2) && !/缺少字段/.test(js2), js2.split('\n').slice(3, 8).join(' | '));
  const rObj2 = await runFlowScript(js2, { any: 1 });
  ck('sandbox/无 schema 必填:对象 args 照常跑通(校验只要求"是对象")', rObj2.calls.length === 1, JSON.stringify(rObj2.calls.length));
  let thrown3 = '';
  try { await runFlowScript(js2, undefined); } catch (e) { thrown3 = String((e as Error).message); }
  ck('sandbox/无 schema 必填:没传 args → 可读错误', /缺少 args/.test(thrown3), thrown3);

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
