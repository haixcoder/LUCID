// A9 断连横幅 / 陈旧标记(1.2.66 修)。真机实测缺陷(CDP 断网 5s 再恢复):横幅**永久残留**——
// 根因是 catch 直接改写 #gauges.innerHTML 却没清 GSTR[0],恢复后数据载荷未变 → gh === GSTR[0] 为真
// → 仪表块永不重绘,页面上一直挂着"⚠ 链路中断 重连中"(14s / 7 个轮询周期仍是假掉线)。
// 修法(结构性):横幅搬出 #gauges,住顶栏常驻元素 #linkdown,成功一轮就隐藏;另加「更新于」时间戳,
// 连续失败 ≥3 轮才加 body.stale(偶发一次抖动不该把整页降透明)。
import { load, makeCk, payload, RUN_DONE, RUN_LIVE, SESSION_FIX } from './harness.ts';
const { ck, done } = makeCk();

(async function main() {
  const runs = [JSON.parse(JSON.stringify(RUN_DONE)), JSON.parse(JSON.stringify(RUN_LIVE))];
  const sessions = [JSON.parse(JSON.stringify(SESSION_FIX))];
  let mode: 'ok' | 'fail' = 'ok';
  const env = load({ fetchFor: (url: string) => mode === 'fail' ? new Error('net down') : payload(runs, sessions)(url) });
  await env.flush();
  // 取用时查活节点(null 安全:元素缺席时断言给 ✗ 而不是让整个套件崩)
  const ld = () => env.$q('#linkdown'), lu = () => env.$q('#lastupd');
  const ldHidden = (): boolean => !!ld() && ld()!.hidden === true;
  const luText = (): string => (lu() ? lu()!.textContent : '') || '';
  const bodyCls = (): string => String((env.doc.body && env.doc.body.attrs.class) || '');
  const tick = async (n = 1): Promise<void> => { for (let i = 0; i < n; i++) { env.run('void tick()'); await env.flush(); } };
  await tick();

  // ① 正常轮:#linkdown 存在且隐藏,#lastupd 有"更新于"文案
  ck('顶栏有断连横幅元素 #linkdown(默认隐藏,常驻不进 gauges 串)', ldHidden(), ld() ? String(env.$q('#linkdown')!.hidden) : 'no el');
  ck('#gauges 内不含断连文案(横幅搬出仪表块 → 恢复不必依赖 gauge 串变化)',
     (env.$('gauges').innerHTML || '').indexOf('链路中断') < 0, env.$('gauges').innerHTML.slice(0, 80));
  ck('正常轮:#lastupd 显示「更新于 …」', /更新于/.test(luText()), luText() || 'no el');
  ck('正常轮:body 无 stale 类', bodyCls().indexOf('stale') < 0, bodyCls());

  // ② 断连 1 轮:横幅立即可见;尚未 stale(阈值=3)
  mode = 'fail';
  await tick();
  ck('断连 1 轮:#linkdown 可见', !!ld() && ld()!.hidden === false, ld() ? String(ld()!.hidden) : 'no el');
  ck('断连 1 轮:未到阈值,body 不 stale', bodyCls().indexOf('stale') < 0, bodyCls());
  // ③ 断连第 3 轮:body.stale + 最后更新提示(数据最后更新于 …)
  await tick(2);
  ck('连续失败 3 轮:body.stale(整页陈旧视觉)', bodyCls().indexOf('stale') >= 0, bodyCls());
  ck('断连文案带最后成功时间锚点(数据最后更新于 …)',
     /数据最后更新于/.test(luText() + (ld() ? ld()!.getAttribute('title') || '' : '')),
     luText() + ' | ' + (ld() ? ld()!.getAttribute('title') : 'no el'));

  // ④ 恢复(载荷与断连前逐字节相同 —— 旧实现恰在此处永久残留):横幅清除、stale 移除、仪表回计数
  mode = 'ok';
  await tick();
  ck('恢复后:横幅清除(载荷未变也必须清)', ldHidden(), ld() ? String(ld()!.hidden) : 'no el');
  ck('恢复后:body.stale 移除', bodyCls().indexOf('stale') < 0, bodyCls());
  ck('恢复后:仪表回到计数态(不再被断连态卡住)', /<span>运行<\/span>/.test(env.$('gauges').innerHTML), env.$('gauges').innerHTML.slice(0, 90));
  ck('恢复后:#lastupd 回到「更新于」', /更新于/.test(luText()), luText());
  ck('全程无渲染异常', env.errs.length === 0, env.errs.join('|'));
  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
