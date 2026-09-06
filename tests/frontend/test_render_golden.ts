// 渲染函数黄金快照:card()/sessCard() 对固定载荷生成的 HTML 串与 golden/ 逐字节比对。
// 目的:为一切前端重构(共享 pane 构造/diffPaint 抽取)提供"输出零漂移"证明;
// 故意改文案/结构时 UPDATE=1 node tests/frontend/test_render_golden.ts 重录,并在提交信息里说明。
// 运行中态的 AD() 反相抖动按 `animation-delay:-N(.N)s → -AD` 归一(它本就不是契约)。
import fs from 'node:fs';
import path from 'node:path';
import { load, makeCk, HERE, RUN_DONE, RUN_LIVE, SESSION_FIX } from './harness.ts';
const { ck, done } = makeCk();

const GOLD = path.join(HERE, 'golden');
const norm = (s: string) => s.replace(/animation-delay:-[\d.]+s/g, 'animation-delay:-ADs');

const env = load({ fetchFor: () => ({ now: 1757000300, ver: 'ffffffffffff', recentDays: 14, runs: [] }) });
env.run('painted = true; spainted = true; for (const k in FULL) delete FULL[k];');  // 稳态:无入场类,无缓存
const card = env.get('card'), sessCard = env.get('sessCard');

const cases: Array<[string, string]> = [
  ['run_completed.html', norm(card(JSON.parse(JSON.stringify(RUN_DONE)), 0))],
  ['run_live.html', norm(card(JSON.parse(JSON.stringify(RUN_LIVE)), 1))],
  ['session_ask.html', norm(sessCard(JSON.parse(JSON.stringify(SESSION_FIX)), 0))],
];
if (!fs.existsSync(GOLD)) fs.mkdirSync(GOLD, { recursive: true });
for (const [name, html] of cases) {
  const fp = path.join(GOLD, name);
  if (process.env.UPDATE === '1' || !fs.existsSync(fp)) { fs.writeFileSync(fp, html); console.log('(重录) ' + name); continue; }
  const want = fs.readFileSync(fp, 'utf8');
  let i = 0; while (i < Math.min(want.length, html.length) && want[i] === html[i]) i++;
  ck('golden ' + name, want === html, '首个差异@' + i + ': want ' + JSON.stringify(want.slice(i, i + 90)) + ' got ' + JSON.stringify(html.slice(i, i + 90)));
}
// 幂等性:同载荷两次生成必一致(串稳定 = 按卡 diff 的前提)
ck('card() 纯函数性(同输入同输出)', norm(card(RUN_DONE, 0)) === norm(card(RUN_DONE, 0)));
ck('sessCard() 纯函数性', norm(sessCard(SESSION_FIX, 0)) === norm(sessCard(SESSION_FIX, 0)));
done();
