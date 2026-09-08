// 生成器 code 节点契约(1.2.57 · Phase 8,PRD §5.4 规则 1/2/2b):任意 JS 片段是**唯一会引入幻觉 API 的地方**,
// 所以校验必须分清"确定违规(拦下)"与"无法判定(只警告)"——宁可漏报也不误杀(误杀=用户写不了合法片段)。
import { load, makeCk, runFlowScript } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + ')') as string;
const V = (d: unknown): string[] => env.get('flowValidate(' + JSON.stringify(d) + ')') as string[];
const W = (d: unknown): string[] => env.get('flowWarnings(' + JSON.stringify(d) + ')') as string[];
const N = (id: string, type: string, x: number, y: number, data: any = {}): any => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string, sh = 'out', th = 'in'): any => ({ id, source: s, sourceHandle: sh, target: t, targetHandle: th });
const dft = (nodes: any[], edges: any[], extra: any = {}): any =>
  ({ v: 2, name: 'demo', desc: 'd', cwd: '/work/fix', nodes, edges, next: 99, view: { x: 0, y: 0, zoom: 1 }, ...extra });
const ok = (d: any): boolean => { try { G(d); return true; } catch { return false; } };
const codeDraft = (frag: string): any => dft([
  N('n1', 'start', 0, 0, { note: 'q' }),
  N('n2', 'agent', 200, 0, { label: 'A', phase: 'P', prompt: 'a' }),
  N('n3', 'code', 400, 0, { code: frag }),
  N('n4', 'return', 600, 0, { ret: '{ v: n3 }' }),
], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')]);

(async () => {
  // ── 出码形状 + 沙箱:片段返回值绑定节点 id,可被下游引用 ──
  const js = G(codeDraft('const up = String(n2).toUpperCase(); return up'));
  ck('生成/code 片段包在 await (async () => { … })() 里,结果绑定节点 id',
     /const n3 = await \(async \(\) => \{/.test(js) && /const up = String\(n2\)\.toUpperCase\(\); return up/.test(js), js.split('\n').slice(-5).join(' | '));
  const r = await runFlowScript(js, undefined, { agent: async () => 'ab' });
  ck('sandbox/片段返回值真的被下游 return 引用到', r.ret && r.ret.v === 'AB', JSON.stringify(r.ret));
  ck('生成/片段里的上游变量是真变量(n2 在闭包里可见)', r.calls.length === 1, JSON.stringify(r.calls.length));

  // ── 确定性禁令:跳过字符串/注释,只拦"真的会执行"的 ──
  ck('校验/import( → 报错(运行前就会失败)', /import/.test(V(codeDraft('import("fs"); return 1')).join('|')) && !ok(codeDraft('import("fs"); return 1')));
  for (const bad of ['return Date.now()', 'return Math.random()', 'return new Date()']) {
    ck('校验/' + bad + ' → 报错(破 resume 的确定性禁令)', V(codeDraft(bad)).length > 0 && !ok(codeDraft(bad)), JSON.stringify(V(codeDraft(bad))));
  }
  ck('校验/字符串里的 Date.now() 不误杀', V(codeDraft("return 'Date.now()'")).length === 0, JSON.stringify(V(codeDraft("return 'Date.now()'"))));
  ck('校验/注释里的 Math.random() 不误杀', V(codeDraft('// Math.random()\nreturn 1')).length === 0, JSON.stringify(V(codeDraft('// Math.random()\nreturn 1'))));
  ck('校验/块注释里的 new Date() 不误杀', V(codeDraft('/* new Date() */\nreturn 1')).length === 0, JSON.stringify(V(codeDraft('/* new Date() */\nreturn 1'))));
  ck('校验/模板字面量里的 Date.now() 不误杀', V(codeDraft('return `t=${"Date.now()"}`')).length === 0, JSON.stringify(V(codeDraft('return `t=${"Date.now()"}`'))));
  ck('校验/片段为空 → 报错(空 code 节点没有意义)',
     /空|code/.test(V(codeDraft('')).join('|')), JSON.stringify(V(codeDraft(''))));

  // ── 未知全局:警告而非错误(唯一会引入幻觉 API 的地方,本机已实证一次 ReferenceError) ──
  const wBad = W(codeDraft('return agents(n2)'));
  ck('警告/幻觉 API agents(...) → 警告(不拦)', wBad.length > 0 && /agents/.test(wBad.join('|')), JSON.stringify(wBad));
  ck('警告/警告不阻止出码(校验错误为空)', V(codeDraft('return agents(n2)')).length === 0 && ok(codeDraft('return agents(n2)')));
  ck('警告/白名单与内建不误报',
     W(codeDraft('const xs = [1,2]; return JSON.stringify(xs.filter(x => x > 1))')).length === 0,
     JSON.stringify(W(codeDraft('const xs = [1,2]; return JSON.stringify(xs.filter(x => x > 1))'))));
  ck('警告/上游节点变量不误报', W(codeDraft('return n2')).length === 0, JSON.stringify(W(codeDraft('return n2'))));
  ck('警告/片段内声明的变量与函数参数不误报',
     W(codeDraft('function f(a, b) { const c = a + b; return c } return f(1, 2)')).length === 0,
     JSON.stringify(W(codeDraft('function f(a, b) { const c = a + b; return c } return f(1, 2)'))));
  ck('警告/属性访问不误报(seen.has → has 不是全局)',
     W(codeDraft('const seen = new Set(); return [1].filter(x => !seen.has(x))')).length === 0,
     JSON.stringify(W(codeDraft('const seen = new Set(); return [1].filter(x => !seen.has(x))'))));

  // ── 生成物仍然不含沙箱禁用调用(既有断言不放松)──
  ck('生成/产物不含 Date.now()/Math.random()(既有沙箱禁令保持)',
     !/Date\.now\(\)|Math\.random\(\)/.test(G(codeDraft('return 1'))));

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
