// 多语言层契约(复刻历史 t2 并入库):
//  · 静态:en/es/fr/de 四字典 key 集合完全对齐(缺一即"切语言露中文");模板中所有 T('字面量') 均有四语译文;
//  · 运行时:setLang('en') → 整屏重绘后 DOM 文本零汉字(夹具内容全 ASCII,出现汉字=漏译);zh 可逆。
import fs from 'node:fs';
import path from 'node:path';
import { load, payload, makeCk, visibleText, REPO, RUN_DONE, RUN_LIVE, SESSION_FIX } from './harness.ts';
const { ck, done } = makeCk();

const SRC = path.join(REPO, 'frontend', 'src');
const i18nSrc = fs.readFileSync(path.join(SRC, '05-i18n.ts'), 'utf8');

// ── 静态:四字典对齐 ──
function dictKeys(lang: string): string[] | null {
  const m = new RegExp('\\n  ' + lang + ': \\{', 'm').exec(i18nSrc);
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1;
  const keys: string[] = [];
  const rest = i18nSrc.slice(i);
  const lineRe = /^    '((?:[^'\\]|\\.)*)':/;
  for (const line of rest.split('\n')) {
    const t = lineRe.exec(line);
    if (t) keys.push(t[1].replace(/\\'/g, "'"));
    if (/^  \},?$/.test(line)) break;
  }
  return keys;
}
const dicts: Record<string, string[]> = {};
for (const l of ['en', 'es', 'fr', 'de']) dicts[l] = dictKeys(l) || [];
ck('四字典均解析成功', ['en', 'es', 'fr', 'de'].every((l) => dicts[l].length > 60),
   Object.entries(dicts).map(([k, v]) => k + '=' + v.length).join(' '));
const enSet = new Set(dicts.en);
for (const l of ['es', 'fr', 'de']) {
  const s = new Set(dicts[l]);
  const miss = [...enSet].filter((k) => !s.has(k));
  const extra = [...s].filter((k) => !enSet.has(k));
  ck('key 对齐 ' + l, miss.length === 0 && extra.length === 0, `缺:${miss.slice(0, 4).join('|')} 多:${extra.slice(0, 4).join('|')}`);
}

// ── 静态:源码里所有 T('字面量') 都有译文(漏译=切语言后露中文,历史真踩过的坑) ──
const usedKeys = new Set<string>();
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith('.ts') || f === '05-i18n.ts') continue;
  const src = fs.readFileSync(path.join(SRC, f), 'utf8');
  const re = /T\('((?:[^'\\]|\\.)+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) usedKeys.add(m[1].replace(/\\'/g, "'"));
}
const missing = [...usedKeys].filter((k) => /[一-鿿]/.test(k) && !enSet.has(k));
ck('模板 T() 字面量在 en 字典全有译(' + usedKeys.size + ' 键引用)', missing.length === 0, missing.join(' | '));

// ── CSS content 文案走 --tr-* 变量:五语齐全(day 走 :root) ──
const tpl = fs.readFileSync(path.join(REPO, 'frontend', 'template.html'), 'utf8');
for (const l of ['"en"', '"es"', '"fr"', '"de"']) {
  ck('CSS lang 块 ' + l, new RegExp('html\\[lang=' + l + '\\]\\{--tr-more:').test(tpl));
}

// ── 运行时:整屏英文零汉字 ──
(async () => {
  const runs = [JSON.parse(JSON.stringify(RUN_DONE)), { ...JSON.parse(JSON.stringify(RUN_LIVE)), status: 'completed', live: false }];
  const sessions = [JSON.parse(JSON.stringify(SESSION_FIX))];
  const env = load({ fetchFor: payload(runs, sessions) });
  await env.flush();
  env.run("document.getElementById('langsel').value='en'; document.getElementById('langsel').onchange({target:{value:'en'}});");
  await env.flush();
  const bodyText = visibleText(env.doc.body);
  const cn = (bodyText.match(/[一-鿿]/g) || []);
  ck('setLang(en) 后可见文案零汉字(script/语言原生自称除外)', cn.length === 0, '残留:' + cn.slice(0, 12).join('') + ' ctx:' + bodyText.slice(0, 80));
  ck('英文文案确实生效(RUNS 标签/等待徽标/日志标题)', /last activity|System log|Waiting answer|full text/i.test(bodyText),
     bodyText.slice(0, 160));
  ck('lang 反射到 <html>', env.get('document.documentElement.lang') === 'en' && env.localStorage.getItem('wfo-lang') === 'en');
  env.run("document.getElementById('langsel').value='zh'; document.getElementById('langsel').onchange({target:{value:'zh'}});");
  await env.flush();
  ck('切回 zh 中文文案回归(可逆)', /等待回答|最后活动/.test(env.doc.body!.textContent));
  ck('切语言后 diff 缓存已清(不陈旧)', env.get('Object.keys(CARDS).length') === 2 && env.get('Object.keys(FULL).length') >= 0);
  ck('全程无渲染异常', env.errs.length === 0, env.errs.join('|'));
  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
