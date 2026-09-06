// 迷你 markdown 渲染器/转义层单测(纯字符串变换,历史 895 条真实语料沉淀的行为,回归风险最高的一层)。
import { load, makeCk } from './harness.ts';
const { ck, done } = makeCk();

const env = load({ fetchFor: () => ({ now: 0, ver: 'ffffffffffff', recentDays: 14, runs: [] }) });
const call = (expr: string): any => env.get(expr);  // 取产物里的全局函数(跨 realm 以 host 参数调用)

// esc:HTML 实体
ck('esc', call('esc')('<a href="x">&</a>') === '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
// unent:数字实体解码 + 双重转义(`&amp;#124;`→`|`),不解码无关实体
ck('unent 实体竖线', call('unent')('a&#124;b') === 'a|b');
ck('unent 双重转义', call('unent')('a&amp;#124;b') === 'a|b');
ck('unent 高位码点不动', call('unent')('&#9776;') === '&#9776;');
// inlineMd:行内码/粗体,先转义
ck('inlineMd', call('inlineMd')('**b** `c<d`') === '<b>b</b> <code>c&lt;d</code>');
// wrapLong:长单行按。；断行;短/多行不碰
const long = '句子一。' + '从'.repeat(500) + '。尾巴';
ck('wrapLong 断长行', call('wrapLong')(long).includes('\n'));
ck('wrapLong 不碰正常多行', call('wrapLong')('a\nb\nc\nd') === 'a\nb\nc\nd');
// mdLite:标题/列表/段落/粗体
const h = call('mdLite')('# 标题\n正文 **粗** 与 `码`');
ck('mdLite 标题', h.includes('<p class="h3">标题</p>'), h);
ck('mdLite 行内', h.includes('<b>粗</b>') && h.includes('<code>码</code>'), h);
const li = call('mdLite')('- 甲\n- 乙');
ck('mdLite 列表', li.includes('class="li"') && li.includes('甲'), li);
// mdLite:围栏(闭合与截断未闭合)+ 内容不被逐行分段打碎
const fence = call('mdLite')('前文\n```js\nlet a=1;\nlet b=2;\n```\n后文');
ck('mdLite 闭合围栏成代码块', fence.includes('<pre class="code">let a=1;\nlet b=2;</pre>') && !fence.includes('```'), fence);
const open1 = call('mdLite')('```python\nprint(1)\nprint(2)');
ck('mdLite 未闭合围栏兜底整段', open1.includes('<pre class="code">print(1)\nprint(2)'), open1);
ck('mdLite 围栏内不被 markdown 化', !call('mdLite')('```\n**not bold**\n```').includes('<b>'), call('mdLite')('```\n**not bold**\n```'));
// mdLite:表格(含转义竖线解码后)+ 对齐分隔行识别 + 单元格内行内码
const tbl = call('mdLite')(call('unent')('| a | b |\n|---|---|\n| 1 | `2` |'));
ck('mdLite 表格', tbl.includes('<table class="mdt">') && tbl.includes('<th>a</th>') && tbl.includes('<code>2</code>'), tbl);
// 字面 \n 还原(围栏外)
ck('mdLite 字面换行还原', call('mdLite')('第一行\\n第二行') === '<p class="">第一行</p><p class="">第二行</p>', call('mdLite')('第一行\\n第二行'));
// pretty:JSON 展开;非 JSON 原样
const pj = call('pretty')('{"k":"v\\nx","n":{"deep":[1,2]}}');
ck('pretty JSON 展 k: v', pj.includes('k: v\nx') && pj.includes('deep:') && !pj.includes('{'), pj);
ck('pretty 非 JSON 原样', call('pretty')('plain text') === 'plain text');
// fmt 工具
ck('fmtT 毫秒梯度', call('fmtT')(500) === '500ms' && call('fmtT')(30000) === '30s' && call('fmtT')(65000) === '1.1m' && call('fmtT')(null) === '—');
ck('fmtN 千分位', call('fmtN')(1234567) === '1,234,567');
ck('GLY 未知态', call('GLY')('nope') === '?');
// 占位符抽取后回填不串块
const mix = call('mdLite')('```x\ncode|pipe\n```\n\n| t |\n|---|\n| v |');
ck('mdLite 围栏+表格混排', mix.includes('<pre class="code">code|pipe</pre>') && mix.includes('<table'), mix);

done();
