// 字段选择(1.2.60):{{nX.字段}} → ${nX?.字段} —— 生成 / 沙箱真跑 / 校验三类断言。
// 为什么必须有这套:1.2.59 之前「多字段输出」的下游接入有两种**静默坏**——
//   ① {{n2.title}} 不被占位符正则识别 → 原样字面量喂给下游 agent(不报错、不告警);
//   ② {{n2}} 指向声明了 schema 的节点 → 模板字面量把对象字符串化成 "[object Object]"。
// 两条都由本套件钉死(错误/警告 + 生成物 + 沙箱实跑各一层)。
import { load, makeCk, runFlowScript } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + ')') as string;
const V = (d: unknown): string[] => env.get('flowValidate(' + JSON.stringify(d) + ')') as string[];
const W = (d: unknown): string[] => env.get('flowWarnings(' + JSON.stringify(d) + ')') as string[];
const N = (id: string, type: string, x: number, y: number, data: any = {}): any => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string, sh = 'out'): any => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: 'in' });
const dft = (nodes: any[], edges: any[], extra: any = {}): any =>
  ({ v: 2, name: 'fields', desc: 'd', cwd: '/work/fix', nodes, edges, next: 99, view: { x: 0, y: 0, zoom: 1 },
     argsSpec: { schemaText: '', exampleText: '', required: false }, ...extra });
const SCHEMA = '{"type":"object","properties":{"title":{"type":"string","description":"标题"},"tags":{"type":"array"},"meta":{"type":"object"}},"required":["title"]}';
// 链式:start → n2(带 schema) → n3(引用 n2 的字段) → return
const chain = (prompt: string, label = '汇总', extra: any = {}): any => dft(
  [N('n1', 'start', 0, 0, { note: 'q' }),
   N('n2', 'agent', 200, 0, { label: '抽取', prompt: '抽取要点', schemaText: SCHEMA, ...(extra.n2 || {}) }),
   N('n3', 'agent', 400, 0, { label, prompt }),
   N('n4', 'return', 600, 0, { ret: '' })],
  [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')]);

(async () => {
  // ── 生成:路径 → 可选链(上游被跳过/终止时返回 null,不许把整张图炸掉)──
  const js1 = G(chain('标题 {{n2.title}} / 首个标签 {{n2.tags[0]}} / 嵌套 {{n2.meta.owner}}'));
  ck('gen/{{nX.字段}} → ${nX?.字段}(点访问)', /`标题 \$\{n2\?\.title\} \/ 首个标签 \$\{n2\?\.tags\?\.\[0\]\} \/ 嵌套 \$\{n2\?\.meta\?\.owner\}`/.test(js1), js1.split('\n').slice(-4).join(' | '));
  ck('gen/整节点引用逐字节不变({{n2}} → ${n2},无路径不引入 ?.)',
     /const n3 = await agent\(`根据 \$\{n2\} 写摘要`/.test(G(chain('根据 {{n2}} 写摘要', '汇总', { n2: { schemaText: '' } }))), '');
  ck('gen/label 模板同样走字段路径', /label: `摘要 \$\{n2\?\.title\}`/.test(G(chain('x', '摘要 {{n2.title}}'))), G(chain('x', '摘要 {{n2.title}}')).split('\n').slice(-3).join(' | '));

  // map 链内:级 2 引用级 1 的字段 → 回调的 prev;{{item.字段}} → 原始条目
  const mapD = dft(
    [N('n1', 'start', 0, 0, { note: 'q' }),
     N('n2', 'map', 200, 0, { items: 'ARGS.files', prompt: '审计 {{item.path}}', label: 'audit:{{item.path}}' }),
     N('n3', 'agent', 400, 0, { label: '复核', prompt: '复核 {{n2.title}} 与 {{n2}}' }),
     N('n4', 'return', 600, 0, { ret: '{ rows: n2 }' })],
    [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')],
    { argsSpec: { schemaText: '{"type":"object","properties":{"files":{"type":"array"}}}', exampleText: '{"files":[]}', required: false } });
  const jsM = G(mapD);
  ck('gen/map 链内 {{上一级.字段}} → prev?.字段、{{item.字段}} → item?.字段',
     /\(prev, item, i\) => agent\(`复核 \$\{prev\?\.title\} 与 \$\{prev\}`/.test(jsM) && /`审计 \$\{item\?\.path\}`/.test(jsM), jsM.split('\n').slice(-4).join(' | '));

  // log 节点文本同样是模板
  const logD = dft(
    [N('n1', 'start', 0, 0, { note: 'q' }),
     N('n2', 'agent', 200, 0, { label: 'A', prompt: 'a', schemaText: SCHEMA }),
     N('n3', 'log', 400, 0, { text: '标题={{n2.title}}' }),
     N('n4', 'return', 600, 0, { ret: '' })],
    [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')]);
  ck('gen/log 文本里的字段引用', /log\(`标题=\$\{n2\?\.title\}`\)/.test(G(logD)), G(logD).split('\n').slice(-3).join(' | '));

  // ── 沙箱真跑:字段值真的进了下游 prompt;上游返回 null 时不抛 ──
  const rec1 = await runFlowScript(G(chain('标题 {{n2.title}} 标签 {{n2.tags[0]}}')), 'q', {
    agent: async (_p: string, o: any) => (o.label === '抽取' ? { title: 'T-42', tags: ['a', 'b'] } : 'R'),
  });
  ck('sandbox/下游 prompt 拿到字段值(不是 [object Object])',
     rec1.calls.length === 2 && rec1.calls[1].prompt === '标题 T-42 标签 a', JSON.stringify(rec1.calls.map(c => c.prompt)));
  const rec2 = await runFlowScript(G(chain('标题 {{n2.title}}')), 'q', { agent: async () => null });
  ck('sandbox/上游返回 null(被跳过)→ 可选链不抛,prompt 里是 undefined',
     rec2.calls.length === 2 && rec2.calls[1].prompt === '标题 undefined', JSON.stringify(rec2.calls.map(c => c.prompt)));

  // ── 校验:两类静默坏变成「拦生成」──
  ck('val/{{n2}} 指向声明了 schema 的节点 → 错误(不再是 [object Object] 静默坏)',
     V(chain('根据 {{n2}} 写摘要')).some(e => /声明了 schema/.test(e) && /\[object Object\]/.test(e)), JSON.stringify(V(chain('根据 {{n2}} 写摘要'))));
  ck('val/形似引用但不合规 → 错误(不再是原样字面量)', V(chain('看 {{n2.1bad}}')).some(e => /无法识别/.test(e))
     && V(chain('看 {{n2 .title}}')).some(e => /无法识别/.test(e)), JSON.stringify(V(chain('看 {{n2.1bad}}'))));
  const idxD = dft(
    [N('n1', 'start', 0, 0, { note: 'q' }),
     N('n2', 'map', 200, 0, { items: 'ARGS.files', prompt: 'x {{index.x}}' }),
     N('n3', 'return', 400, 0, { ret: '' })],
    [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')]);
  ck('val/start / index 没有字段', V(chain('看 {{n1.x}}')).some(e => /Start 是文本入口/.test(e)) && V(idxD).some(e => /index 是数字/.test(e)),
     JSON.stringify([V(chain('看 {{n1.x}}')), V(idxD)]));

  // ── 警告(不拦生成):无 schema 取字段 / 字段名不在 properties 内 ──
  const noSchema = dft(
    [N('n1', 'start', 0, 0, { note: 'q' }),
     N('n2', 'agent', 200, 0, { label: 'A', prompt: 'a' }),
     N('n3', 'agent', 400, 0, { label: 'B', prompt: '看 {{n2.title}}' }),
     N('n4', 'return', 600, 0, { ret: '' })],
    [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')]);
  ck('warn/上游没有 schema 却取字段 → 警告(不拦生成)', V(noSchema).length === 0 && W(noSchema).some(w => /没有声明 schema/.test(w)), JSON.stringify(W(noSchema)));
  const typo = chain('看 {{n2.titel}}');
  ck('warn/字段名不在 schema properties 内 → 警告(拼错能被看见)', V(typo).length === 0 && W(typo).some(w => /不在.*properties/.test(w)), JSON.stringify(W(typo)));
  ck('clean/合法字段引用:无错误也无警告', V(chain('看 {{n2.title}} {{n2.tags[0]}}')).length === 0 && W(chain('看 {{n2.title}} {{n2.tags[0]}}')).length === 0,
     JSON.stringify([V(chain('看 {{n2.title}} {{n2.tags[0]}}')), W(chain('看 {{n2.title}} {{n2.tags[0]}}'))]));

  done();
})();
