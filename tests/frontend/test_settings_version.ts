// 设置中心「插件版本」(1.2.72):/api/config.plugin → #pver 的展示契约。
// 数据源单点在后端 web.plugin_info(运行副本自己的 .claude-plugin/plugin.json,后端套件钉住);
// 本套件钉展示层三态与静态契约:① 打开面板即拉取并显示 `lucid vX.Y.Z`;
// ② 旧后端无 plugin 字段 / 副本被裁剪(version 空)→「未知」而非空白(铁律 7:不许静默留白);
// ③ 面板未打开时不预填版本(静态初值「—」);④ 顶部角标 tooltip 声明 12 位构建戳不是插件版本。
import fs from 'node:fs';
import path from 'node:path';
import { load, payload, makeCk, REPO, RUN_DONE, SESSION_FIX, type Env } from './harness.ts';
const { ck, done } = makeCk();

const CONF = { enabled: false, format: 'feishu', url: '', insecure: false, port: 8787, recentDays: 14, notifyInput: 'blocked' };

function envWith(cfgResp: unknown): Env {
  const runs = [JSON.parse(JSON.stringify(RUN_DONE))];
  const sessions = [JSON.parse(JSON.stringify(SESSION_FIX))];
  const p = payload(runs, sessions);
  return load({ fetchFor: (url: string) => (url.indexOf('/api/config') === 0 ? cfgResp : p(url)) });
}
async function openPanel(env: Env): Promise<string> {
  await env.flush();
  env.$('hookbtn').fire('click');   // 真实入口:点顶栏「⚙ 设置」
  await env.flush();
  return env.$('pver').textContent;
}

(async () => {
  const withVer = await openPanel(envWith({ conf: CONF, last: null, plugin: { name: 'lucid', version: '1.2.99' } }));
  ck('打开设置显示 插件名+版本', withVer === 'lucid v1.2.99', withVer);

  const noField = await openPanel(envWith({ conf: CONF, last: null }));
  ck('旧后端无 plugin 字段 → 未知(不空白)', noField === '未知', noField);

  const emptyVer = await openPanel(envWith({ conf: CONF, last: null, plugin: { name: 'lucid', version: '' } }));
  ck('副本读不到清单(version 空)→ 未知', emptyVer === '未知', emptyVer);

  const env = envWith({ conf: CONF, last: null, plugin: { name: 'lucid', version: '1.2.99' } });
  await env.flush();
  ck('未打开面板时不预填版本(初值「—」)', env.$('pver').textContent === '—', env.$('pver').textContent);
  ck('顶栏角标 tooltip 声明是构建戳非插件版本', /构建戳/.test(env.$('verB').title), env.$('verB').title);
  ck('全程无渲染异常', env.errs.length === 0, env.errs.join('|'));

  // 静态契约:07 模块两处用户可见文案必须走 data-i18n(漏挂=切语言留中文,test_i18n 的零汉字断言会兜底)
  const tpl = fs.readFileSync(path.join(REPO, 'frontend', 'template.html'), 'utf8');
  ck('07 模块标签走 data-i18n', tpl.includes('<b>07</b><span data-i18n="插件版本">'));
  ck('版本说明走 data-i18n', tpl.includes('data-i18n="本服务正在运行的副本版本；升级插件后需重启服务才更新"'));

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
