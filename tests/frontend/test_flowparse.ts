// 反解器 + 内嵌图契约(1.2.71):flowParse / flowParseVerified / flowEmbed / flowDecodeGraph / flowAutoLayout。
// 手法 = **生成 → 反解 → 复原图再生成** 的往返对账(逐字节) + 沙箱调用序列等价(AD-6:结构等价看调用,不看文本)。
// 反解器只认生成器文法,且复核不过一律 null —— 这里既钉"能还原的必须还原",也钉"还原不了的必须老实拒绝"。
import { load, makeCk, runFlowScript } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown, ctx?: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + (ctx !== undefined ? ', ' + JSON.stringify(ctx) : '') + ')') as string;
const PV = (js: string, ctx?: unknown): { draft: any; foreignSubflow: boolean } | null =>
  env.get('flowParseVerified(' + JSON.stringify(js) + (ctx !== undefined ? ', ' + JSON.stringify(ctx) : '') + ')') as { draft: any; foreignSubflow: boolean } | null;
const P = (js: string): any => env.get('flowParse(' + JSON.stringify(js) + ')');
const EMB = (d: unknown): string => env.get('flowEmbed(' + JSON.stringify(d) + ')') as string;
const DEC = (js: string): any => env.get('flowDecodeGraph(' + JSON.stringify(js) + ')');

const N = (id: string, type: string, x: number, y: number, data: any = {}): any => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string, sh = 'out', th = 'in'): any => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th });
const dft = (nodes: any[], edges: any[], extra: any = {}): any =>
  ({ v: 2, name: 'rt', desc: '往返', cwd: '/work/rt', nodes, edges, next: 99, view: { x: 0, y: 0, zoom: 1 }, ...extra });

// ── 夹具:覆盖全部节点型与区域形态 ──
// A.链 + 转义酷刑(反引号 / ${ / 反斜杠 / 换行)+ start 引用 + 字段路径 + schema + retry
const A = dft([
  N('n1', 'start', 0, 0, { note: '选题' }),
  N('n2', 'agent', 200, 0, { label: '拆解', phase: 'Scope', prompt: '把 {{start}} 拆三条。\n含反引号 ` 与 ${x} 与反斜杠 \\ 结尾', model: 'haiku', schemaText: '{"type":"object","properties":{"items":{"type":"array"}}}' }),
  N('n3', 'agent', 400, 0, { label: '汇总', phase: 'Sum', prompt: '看 {{n2.items}} 汇总', retryN: 2, retryMs: 500 }),
  N('n4', 'return', 600, 0, { ret: '{ v: n2.items, len: String(n3).length }' }),
], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')], { title: 'TTL', whenToUse: '需要时' });

// B.扇出 + 汇聚(parallel 层与 fan-in)
const B = dft([
  N('n1', 'start', 0, 0, { note: 'q' }),
  N('n2', 'agent', 200, 0, { label: 'A', phase: 'P', prompt: 'a {{n1}}' }),
  N('n3', 'agent', 400, -80, { label: 'B1', phase: 'P', prompt: 'b1 {{n2}}' }),
  N('n4', 'agent', 400, 80, { label: 'B2', phase: 'P', prompt: 'b2 {{n2}}', effort: 'high', isolation: true }),
  N('n5', 'agent', 600, 0, { label: 'C', phase: 'Q', prompt: 'c {{n3}} {{n4}}', agentType: 'market-researcher' }),
  N('n6', 'return', 800, 0, { ret: '' }),
], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n2', 'n4'), E('e4', 'n3', 'n5'), E('e5', 'n4', 'n5'), E('e6', 'n5', 'n6')]);

// C.map 链(map 自带级 1 + 下游一级 + 汇合点 + 消费者)
const C = dft([
  N('n1', 'start', 0, 0, { note: 'q' }),
  N('n2', 'map', 200, 0, { items: 'ARGS.paths', prompt: '审计 {{item}} #{{index}}', label: 'audit:{{item}}', phase: 'Scan' }),
  N('n3', 'agent', 400, 0, { label: '汇总', phase: 'Scan', prompt: '汇总 {{n2}}' }),
  N('n4', 'merge', 600, 0, {}),
  N('n5', 'agent', 800, 0, { label: '收尾', phase: 'End', prompt: '收尾 {{n4}}' }),
  N('n6', 'return', 1000, 0, { ret: '{ v: n5 }' }),
], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4'), E('e4', 'n4', 'n5'), E('e5', 'n5', 'n6')],
{ argsSpec: { schemaText: '{"type":"object","properties":{"paths":{"type":"array"}},"required":["paths"]}', exampleText: '{"paths":["a"]}', required: true } });

// D.分支(汇于 merge)
const D = dft([
  N('n1', 'start', 0, 0, { note: 'q' }),
  N('n2', 'branch', 200, 0, { label: 'J', cond: 'ARGS.flag' }),
  N('n3', 'agent', 400, -80, { label: '是', phase: 'P', prompt: 'yes {{n1}}' }),
  N('n4', 'agent', 400, 80, { label: '否', phase: 'P', prompt: 'no {{n1}}' }),
  N('n5', 'merge', 600, 0, {}),
  N('n6', 'return', 800, 0, { ret: '{ m: n5 }' }),
], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3', 'true'), E('e3', 'n2', 'n4', 'false'), E('e4', 'n3', 'n5'), E('e5', 'n4', 'n5'), E('e6', 'n5', 'n6')]);

// E.分支(双臂直接收于 return,无 merge)+ 空臂写法
const E5 = dft([
  N('n1', 'start', 0, 0, { note: 'q' }),
  N('n2', 'branch', 200, 0, { label: '', cond: 'n1.length > 3' }),
  N('n3', 'agent', 400, -80, { label: '长', phase: 'P', prompt: 'long' }),
  N('n4', 'agent', 400, 80, { label: '短', phase: 'P', prompt: 'short' }),
  N('n5', 'return', 600, 0, { ret: '{ a: n3, b: n4 }' }),
], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3', 'true'), E('e3', 'n2', 'n4', 'false'), E('e4', 'n3', 'n5'), E('e5', 'n4', 'n5')]);

// F.循环(预算守卫 + 体末扇出经 merge 回环)+ code + subflow + log
const F = dft([
  N('n1', 'start', 0, 0, { note: 'q' }),
  N('n2', 'loop', 200, 0, { label: 'L', cond: 'true', maxRounds: 3, budgetGuard: true }),
  N('n3', 'agent', 400, -80, { label: '内', phase: 'Lp', prompt: 'in {{n1}}' }),
  N('n4', 'agent', 600, -80, { label: '扇1', phase: 'Lp', prompt: 'f1 {{n3}}' }),
  N('n5', 'agent', 600, 80, { label: '扇2', phase: 'Lp', prompt: 'f2 {{n3}}' }),
  N('n6', 'merge', 800, 0, {}),
  N('n7', 'code', 1000, 0, { code: 'const seen = new Set();\nreturn String(seen.size)' }),
  N('n8', 'subflow', 1200, 0, { ref: 'triage', argsExpr: '{ v: n7 }' }),
  N('n9', 'log', 1400, 0, { text: '完成 {{n8}}' }),
  N('n10', 'return', 1600, 0, { ret: '{ v: n8 }' }),
], [
  E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3', 'body'), E('e3', 'n3', 'n4'), E('e4', 'n3', 'n5'),
  E('e5', 'n4', 'n6'), E('e6', 'n5', 'n6'), E('e7', 'n6', 'n2'), E('e8', 'n2', 'n7', 'out'),
  E('e9', 'n7', 'n8'), E('e10', 'n8', 'n9'), E('e11', 'n9', 'n10'),
]);

const ALL = [A, B, C, D, E5, F];
const NAMES = ['A链+转义', 'B扇出', 'C-map链', 'D分支', 'E分支-return', 'F循环+全节点'];
const ctx = { drafts: [{ name: 'triage', nested: false }] };

// ── 1) 往返:生成 → 反解 → 复核通过 → 复原图再生成 == 原文 ──
ALL.forEach((g, k) => {
  const js = G(g, ctx);
  const pv = PV(js, ctx);
  const ok = !!pv && G(pv.draft, ctx) === js;
  ck('往返/' + NAMES[k] + ' 反解复核通过且再生成逐字节一致', ok, JSON.stringify(pv && pv.draft && pv.draft.nodes.map((n: any) => n.id)));
});
ck('往返/节点数一个不少(C 的链内级会换 id 但结构与数量保住:start/map/级2/merge/消费者/return)',
   (() => { const pv = PV(G(C, ctx), ctx); return !!pv && pv.draft.nodes.length === 6
     && pv.draft.nodes.filter((n: any) => n.type === 'map').length === 1 && pv.draft.nodes.filter((n: any) => n.type === 'merge').length === 1; })(),
   JSON.stringify(PV(G(C, ctx), ctx)?.draft?.nodes?.map((n: any) => n.id + ':' + n.type)));

// ── 2) 结构等价(AD-6):沙箱跑"原文"与"复原图再生成"两份脚本,调用序列/参数/返回一致 ──
{
  const js = G(F, ctx);
  const js2 = G(PV(js, ctx)!.draft, ctx);
  const args = { x: 1 };
  const r1 = await runFlowScript(js, args);
  const r2 = await runFlowScript(js2, args);
  ck('等价/循环+扇出+code+subflow+log:调用序列与参数逐项一致',
     JSON.stringify(r1.calls) === JSON.stringify(r2.calls) && JSON.stringify(r1.order) === JSON.stringify(r2.order)
     && JSON.stringify(r1.workflows) === JSON.stringify(r2.workflows) && JSON.stringify(r1.logs) === JSON.stringify(r2.logs)
     && JSON.stringify(r1.ret) === JSON.stringify(r2.ret), JSON.stringify(r1.calls).slice(0, 200));
}

// ── 3) 解析出的图必须自己就能过校验(载入画布即可用) ──
for (const [k, g] of ALL.entries()) {
  const pv = PV(G(g, ctx), ctx);
  const errs = pv ? (env.get('flowValidate(' + JSON.stringify(pv.draft) + ')') as string[]) : ['<null>'];
  ck('校验/还原图 ' + NAMES[k] + ' 零错误', errs.length === 0, JSON.stringify(errs));
}

// ── 4) 字段还原抽查:escape 酷刑 / 选项 / args 契约 / 循环参数 / 布局 ──
{
  const pv = PV(G(A, ctx), ctx)!;
  const n2 = pv.draft.nodes.find((n: any) => n.id === 'n2');
  ck('还原/prompt 逐字(反引号/${/反斜杠/换行/{{start}} 都回来了)',
     n2.data.prompt === '把 {{start}} 拆三条。\n含反引号 ` 与 ${x} 与反斜杠 \\ 结尾' && n2.data.model === 'haiku'
     && n2.data.schemaText === '{"type":"object","properties":{"items":{"type":"array"}}}', JSON.stringify(n2.data.prompt));
  const n3 = pv.draft.nodes.find((n: any) => n.id === 'n3');
  ck('还原/retry 选项与字段路径引用', Number(n3.data.retryN) === 2 && Number(n3.data.retryMs) === 500 && /n2\.items/.test(n3.data.prompt), JSON.stringify(n3.data));
  ck('还原/meta 加宽字段(whenToUse/title/phases)与 start note/return 表达式', pv.draft.whenToUse === '需要时' && pv.draft.title === 'TTL' && pv.draft.phases.length === 2
     && pv.draft.nodes.find((n: any) => n.type === 'start').data.note === '选题' && /n2\.items/.test(pv.draft.nodes.find((n: any) => n.type === 'return').data.ret), JSON.stringify(pv.draft.phases));
  const f = PV(G(F, ctx), ctx)!;
  const lp = f.draft.nodes.find((n: any) => n.type === 'loop');
  ck('还原/循环 cond 与 maxRounds 与预算守卫', lp.data.cond === 'true' && Number(lp.data.maxRounds) === 3 && lp.data.budgetGuard === true, JSON.stringify(lp.data));
  ck('还原/code 片段原文(含换行)', f.draft.nodes.find((n: any) => n.type === 'code').data.code === 'const seen = new Set();\nreturn String(seen.size)');
  ck('还原/subflow 按名引用与参数', f.draft.nodes.find((n: any) => n.type === 'subflow').data.ref === 'triage');
  ck('还原/布局:所有节点都有坐标且分层有序', f.draft.nodes.every((n: any) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))
     && new Set(f.draft.nodes.map((n: any) => n.position.x)).size >= 4, JSON.stringify(f.draft.nodes.map((n: any) => [n.id, n.position.x])));
  const c = PV(G(C, ctx), ctx)!;
  ck('还原/args 契约:required 字段按名单重建(schema 原文在脚本里不可见,只保证再生成一致)', c.draft.argsSpec.required === true
     && /"paths"/.test(c.draft.argsSpec.schemaText), JSON.stringify(c.draft.argsSpec));
}

// ── 5) 内嵌图:保存附加 → 无损还原(含中文/坐标)→ 与"再生成"互不干扰 ──
{
  const g = C;
  const js = G(g, ctx);
  const withEmbed = js + '\n' + EMB(g);
  ck('内嵌/生成物不含标记(预览与产物逐字节不变),附加后带标记', !DEC(js) && !!DEC(withEmbed));
  const back = DEC(withEmbed);
  ck('内嵌/无损还原(名称/中文/坐标/视图逐字段一致)', JSON.stringify(back) === JSON.stringify(g), JSON.stringify(back && back.nodes && back.nodes.length));
  ck('内嵌/解码带版本白名单(伪造 v=9 → null)',
     DEC('x\n// lucid-graph:1:' + Buffer.from(JSON.stringify({ v: 9, nodes: [], edges: [] })).toString('base64') + '\n') === null);
  ck('内嵌/坏 base64 静默 null(不抛)',
     DEC('// lucid-graph:1:!!!not-base64!!!\n') === null && DEC('// lucid-graph:1:\n') === null);
  ck('内嵌/中文往返(UTF-8 路径)', (() => { const b = DEC('// lucid-graph:1:' + Buffer.from(JSON.stringify({ v: 2, nodes: [{ id: 'n1', type: 'start', position: { x: 0, y: 0 }, data: { note: '中文注释 ✅' } }], edges: [] }), 'utf8').toString('base64') + '\n'); return !!b && b.nodes[0].data.note === '中文注释 ✅'; })());
}

// ── 6) 拒绝面:非生成器产物 / 被手改过的生成物 / 结构不认识 —— 一律 null(宁可不还原) ──
{
  // 本机真实历史运行脚本(AI 手写风格:单引号 meta、Array.from 生成 thunk)——必须拒绝
  const AI = [
    "export const meta = {",
    "  name: 'viewer-e2e-test',",
    "  description: 'x',",
    "}",
    "const results = await parallel(",
    "  Array.from({ length: 4 }, (_, i) => () =>",
    "    agent(`请只回复一个词:task-${i}`, { label: `t${i}` })",
    "  )",
    ")",
    "return { agents: results }",
    "",
  ].join('\n');
  ck('拒绝/AI 手写风格脚本(无反解锚) → null', P(AI) === null && PV(AI) === null);
  const js = G(B, ctx);
  const tampered = js.replace('b1 ${n2}', 'b1 改过了');       // 脚本里的插值形态是 ${n2}
  ck('拒绝/手改过的生成物(文案被改一个词) → 复核否决',
     tampered !== js && P(tampered) !== null && PV(tampered, ctx) === null, JSON.stringify(P(tampered) !== null));
  ck('拒绝/截断的脚本(少了 return) → null', P(js.slice(0, js.indexOf('return'))) === null);
  ck('拒绝/空串与随机 JS → null', P('') === null && P('console.log(1)') === null && P('// 由 Lucid 编排器生成 —— 目标项目: /x\n// 用法: x\n乱写') === null);
  // 引用不存在的节点:反解出的图必须拒绝(挂边时目标不在)
  const bad = js.replace('${n2}', '${n9}');
  ck('拒绝/占位符指向不存在节点 → null', bad !== js && PV(bad, ctx) === null);
}

// ── 7) 子流引用的宽松复核:引用不在当前项目草稿里 → 允许载入但带标记 ──
{
  const g = F;
  const js = G(g, ctx);
  const pv = PV(js, { drafts: [] });
  ck('复核/子流不在当前项目:先严后宽,通过且 foreignSubflow=true',
     !!pv && pv.foreignSubflow === true, JSON.stringify(pv && pv.foreignSubflow));
  ck('复核/严格上下文能过时 foreignSubflow=false', PV(js, ctx)!.foreignSubflow === false);
}

done();
