// ── 30-app.ts:装配层——主题/设置面板/轮询 tick/diff 渲染/展开态恢复/全文抽屉 ──
const thm = $<HTMLSelectElement>('thm');
const THEMES = ['night', 'ice', 'volt', 'ink'];
function curTheme(): string { for (const t of THEMES) if (document.body.classList.contains(t)) return t; return 'day'; }
function paintThm(): void { thm.value = curTheme(); }
thm.onchange = () => { const t = thm.value; document.body.classList.remove(...THEMES); if (t !== 'day') document.body.classList.add(t); localStorage.setItem('wfo-theme', t); };
paintThm();
// 语言:与主题同为"视图状态"(localStorage wfo-lang),即点即生效;切换后 setLang 清 diff 缓存 → 整屏重绘
const langsel = $<HTMLSelectElement>('langsel');
langsel.value = lang;
langsel.onchange = () => { setLang(langsel.value as Lang); renderAnchored(); };  // 整屏重绘也保持视口锚定
// 筛选/视图状态 localStorage 恢复:项目/搜索/自动刷新——刷新(含部署自动 reload)后不丢失(历史 bug,教训见 CLAUDE.md)
fproj = localStorage.getItem('wfo-fproj') || '';
fstr = localStorage.getItem('wfo-fstr') || '';
$<HTMLInputElement>('fq').value = fstr;
auto = localStorage.getItem('wfo-auto') !== '0';
$<HTMLInputElement>('auto').checked = auto;
// 通知钩子面板
const cfg = $('cfg'), hmsg = $('hmsg'), hookbtn = $<HTMLButtonElement>('hookbtn'), hsave = $<HTMLButtonElement>('hsave');
const hena = $<HTMLInputElement>('hena'), hfmt = $<HTMLSelectElement>('hfmt'), hurl = $<HTMLInputElement>('hurl'), hinsec = $<HTMLInputElement>('hinsec'), hport = $<HTMLInputElement>('hport'), hdays = $<HTMLInputElement>('hdays');
const hinp = $<HTMLSelectElement>('hinp'), htest2 = $<HTMLButtonElement>('htest2');
function showLast(l?: LastHook | null): void {
  if (l && l.at) {
    const t = new Date(l.at * 1000).toLocaleTimeString(loc(), { hour12: false });
    hmsg.textContent = `${T('最近推送')} ${t} ${l.ok ? '✓' : '✗'} ${String(l.reply || '')}`; hmsg.style.color = l.ok ? 'var(--gr)' : 'var(--rd)';
  } else hmsg.textContent = T('终态运行 + 等待输入自动推送；通知依赖本服务进程存活');
}
cfg.addEventListener('input', () => hsave.classList.add('dirty'));  // 全局保存:任何字段改动→APPLY 亮未存红点
hookbtn.onclick = async () => {
  cfg.hidden = !cfg.hidden; hookbtn.classList.toggle('on', !cfg.hidden);
  if (cfg.hidden) return;
  try {
    const d = await (await fetch('/api/config')).json() as ConfResp;
    hena.checked = !!d.conf.enabled; hfmt.value = d.conf.format; hurl.value = d.conf.url; hinsec.checked = !!d.conf.insecure;
    hinp.value = d.conf.notifyInput || 'blocked';
    hport.value = String(d.conf.port || location.port); hdays.value = String(d.conf.recentDays || 14); hsave.classList.remove('dirty'); showLast(d.last);
  } catch (e) { hmsg.textContent = T('配置读取失败'); }
};
hsave.onclick = async () => {
  const r = await (await fetch('/api/config/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: hena.checked, format: hfmt.value, url: hurl.value.trim(), insecure: hinsec.checked, port: +hport.value || 0, recentDays: +hdays.value || 14, notifyInput: hinp.value }) })).json() as SaveResp;
  hmsg.textContent = T(r.msg || '') + (r.ok && !r.reloc ? T('，运行终态与等待输入将自动推送') : ''); hmsg.style.color = r.ok ? 'var(--gr)' : 'var(--rd)';
  if (r.ok) hsave.classList.remove('dirty');
  if (r.reloc) { const rl = r.reloc; setTimeout(() => { location.href = rl; }, 1800); }  // 等 execv 重启落到新端口后自动跳转
  else if (r.ok) { cfg.hidden = true; hookbtn.classList.remove('on'); }  // 设置完成即收起;失败留在面板内看红字
};
$('htest').onclick = async () => {
  hmsg.textContent = T('发送中…'); hmsg.style.color = 'var(--dim)';
  const r = await (await fetch('/api/config/test', { method: 'POST' })).json() as TestResp;
  hmsg.textContent = (r.ok ? T('✓ 测试消息已送达 ') : '✗ ' + T(r.msg || '失败')) + String((r.last && r.last.reply) || '');
  hmsg.style.color = r.ok ? 'var(--gr)' : 'var(--rd)';
};
htest2.onclick = async () => {  // 分型测试：按「等待用户输入」的真实正文/载荷发一条，验证新类型通路
  hmsg.textContent = T('发送中…'); hmsg.style.color = 'var(--dim)';
  const r = await (await fetch('/api/config/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"kind":"input_required"}' })).json() as TestResp;
  hmsg.textContent = (r.ok ? T('✓ 等待通知已送达 ') : '✗ ' + T(r.msg || '失败')) + String((r.last && r.last.reply) || '');
  hmsg.style.color = r.ok ? 'var(--gr)' : 'var(--rd)';
};
// 构建戳自取。历史坑:曾写作 $('wfo-ver') —— getElementById 只认 id,而模板里是 <meta name=...>,
// 真浏览器返回 null → VER 恒为空 → "旧标签页自动换新代码"与版本角标静默失效多版(无头桩按规范复现,1.2.18 修)。
const VER = (document.querySelector('meta[name="wfo-ver"]') as HTMLMetaElement | null)?.getAttribute('content') || '';
async function tick(): Promise<void> {
  let d: RunsResp, s: SessionsResp;
  try {
    const [a, b] = await Promise.all([fetch('/api/runs').then(r => r.json() as Promise<RunsResp>), fetch('/api/sessions').then(r => r.json() as Promise<SessionsResp>).catch(() => ({ sessions: [] as SessionState[] } as SessionsResp))]);
    d = a; s = b;
    // 部署后旧标签页自动换代码:服务端 JS 载荷 md5 ≠ 本页构建时戳 → 整页重载(一次即可,新页戳必匹配)
    if (d.ver && VER && d.ver !== VER) { location.reload(); return; }
  } catch (e) { $('gauges').innerHTML = `<div class="g er"><b>⚠</b><span>${T('⚠ 链路中断 重连中')}</span></div>`; return; }
  // 渲染异常不再冒充"链路中断"(历史坑:catch 同包 fetch+render,JS bug 被伪装成掉线且无痕迹)
  try {
    runs = d.runs; sess = s.sessions || []; rdays = d.recentDays || 14;
    const sel = $<HTMLSelectElement>('fproj');
    // 下拉数据源 = 后端 projects(回看窗口内有活动的项目全集,含无 workflow 运行的纯会话项目——
    // 旧行为只从 runs∪sessions 推导,窗口调到 180 天下拉的"总项目数"仍对不上,1.2.35 修)
    // ∪ 当前载荷键(兜底:窗口外活跃会话等 projects 覆盖不到的键)。
    const projs = [...new Set([...(d.projects || []), ...runs.map(r => r.cwd || r.project), ...sess.map(x => x.cwd || x.project)])];
    if (fproj && !projs.includes(fproj)) { fproj = ''; localStorage.setItem('wfo-fproj', ''); }  // 已保存的项目不在数据源(窗口滑动/被删)→ 回落全部项目,避免永久 NO MATCH
    // 重建判定按内容而非数量:数量相同、集合不同(一进一出)时旧判定会永久保留陈旧选项(同症状的另一半根因)
    const pstr = projs.join('\n');
    if (PSTR !== pstr) { PSTR = pstr; sel.innerHTML = `<option value="">${T('◆ 全部项目')}</option>` + projs.map(p => `<option${p === fproj ? ' selected' : ''}>${esc(p)}</option>`).join(''); }
    renderAnchored();  // 页面级视口锚定:基线在任何重建前捕获(修「执行中展开详情上下滚动漂移」,详见 renderAnchored 注释)
  } catch (e) {
    console.error('render error:', e);
    const err: string = String((e as Error | null)?.message ?? e);
    $('gauges').innerHTML = '<div class="g er" title="' + esc(err) + '"><b>⚠</b><span>' + T('渲染异常(全文见下方卡片)') + '</span></div>';
    fullError(err, (e as Error)?.stack || '');   // 仪表条装不下异常全文：整条堆栈进列表区滚动框(见"日志可看全"铁律)
  }
}
// 渲染异常的全文出口：列表首块 + 定高滚动框；data-rid="__err" 会被下一轮成功渲染的清理逻辑自动摘掉
function fullError(msg: string, stack: string): void {
  $('list').innerHTML = `<div class="card" data-rid="__err"><div class="hd"><span class="b b-error">RENDER ERROR</span>
  <h2>${T('渲染异常 · 页面数据可能不完整')}</h2><span class="meta">${T('完整堆栈同时打在 F12 控制台')}</span></div>
  <div class="term-body solo" style="margin:10px 0 0"><div class="pane" data-t="ERR · JS"><pre>${esc(msg)}${stack ? '\n\n' + esc(stack) : ''}</pre></div></div></div>`;
}
// ── 按卡 diff 渲染:render()/renderSessions() 共用的唯一实现(1.2.18 抽取) ─────────────
// 这里住着卡片区所有用血换来的不变量,是"改一处两处同审"教训的结构性终结——新增卡片区直接复用:
//  · 稳定节点身份:HTML 串不变的卡绝不重建(滚动/选中/hover/details 展开不闪);
//  · outerHTML 重建后 ref 必须同步到新节点(旧节点已脱离文档,拿它 insertBefore 抛 NotFoundError 打断整轮渲染);
//  · details open 态 + pane scrollTop 快照跨重建恢复(不恢复即"点开即关"复发);
//  · 离开的 rid 连 store 串一并删除(防陈旧 diff 串滞留);
//  · 新出现卡片在稳态只演一次入场(.en + delay 0)。
function diffPaint(el: HTMLElement, store: Record<string, string>, items: { id: string; html: string }[], painted: boolean): void {
  const open = new Set([...el.querySelectorAll<HTMLDetailsElement>('details[open]')].map(x => x.dataset.k || ''));
  const sc: Record<string, number[]> = {};
  el.querySelectorAll('details').forEach(x => { if (x.dataset.k) sc[x.dataset.k] = [...x.querySelectorAll<HTMLElement>('.rich,.pane pre')].map(s => s.scrollTop); });
  const seen = new Set<string>(); let ref: Element | null = el.firstElementChild;
  for (const { id, html } of items) {
    seen.add(id); const sl = `:scope>div[data-rid="${CSS.escape(id)}"]`; let e2 = el.querySelector(sl) as HTMLElement | null;
    if (!e2) {
      store[id] = html; const t = document.createElement('template'); t.innerHTML = html; e2 = t.content.firstElementChild as HTMLElement;
      if (painted) { e2.classList.add('en'); e2.style.animationDelay = '0ms'; }  // 运行中新出现的卡:单卡入场
      el.insertBefore(e2, ref);
    } else {
      if (store[id] !== html) {
        store[id] = html; const was = e2; e2.outerHTML = html; e2 = el.querySelector(sl) as HTMLElement | null;
        if (ref === was) ref = e2;  // outerHTML 分离旧节点:ref 若正指着它必须跟到新节点(NotFoundError 根因)
      }
      if (e2 && e2 !== ref) el.insertBefore(e2, ref);
    }
    ref = e2 ? e2.nextElementSibling : null;
  }
  for (const x of [...el.children] as HTMLElement[]) { const rid = x.dataset.rid; if (rid && !seen.has(rid)) { delete store[rid]; x.remove(); } }
  if (open.size) el.querySelectorAll('details').forEach(x => {
    const dk = x.dataset.k || '';
    if (open.has(dk)) { x.open = true; x.classList.add('noanim'); const v = sc[dk]; if (v) x.querySelectorAll<HTMLElement>('.rich,.pane pre').forEach((s2, i2) => { if (v[i2]) s2.scrollTop = v[i2]; }); }
  });
}
// 会话命中判定单点(renderSessions 与仪表 TASKS 共用——同一过滤口径,两处不许各写一份)
const sessHit = (s: SessionState): boolean => {
  const q = fstr.toLowerCase();
  return (!fproj || (s.cwd || s.project) === fproj) && (!q || (s.title + ' ' + s.sessionId + ' ' + (s.cwd || s.project) + ' ' + s.status + ' ' + (s.waitReason || '') + ' ' + (s.waitTool || '') + ' ' + (s.lastPrompt || '') + ' ' + (s.prompts || []).map(p => p.t).join(' ') + ' ' + (s.subagents || []).map(a => a.label + ' ' + (a.description || '')).join(' ')).toLowerCase().includes(q));
};
function renderSessions(): void {
  const el = $('sess'), tt = $('secttl');
  if (!sess.length) { tt.hidden = true; el.innerHTML = ''; return; }
  tt.hidden = false;
  const vis = sess.filter(sessHit), live = sess.filter(s => s.alive).length, waiting = vis.filter(sessStuck).length;  // ⏸ 只数真卡住(ask/permission);回合已完(turn)不算等待(1.2.13)
  tt.innerHTML = `${T('AGENT 状态 · 会话(主+子)')} ${vis.length}${live ? ' · ' + T('活跃') + ' ' + live : ''}${waiting ? ' · <b class="wtag">⏸ ' + T('等待输入') + ' ' + waiting + '</b>' : ''}`;
  if (!vis.length) { el.innerHTML = `<p class="idle">${T('NO MATCH · 无匹配会话')}</p>`; spainted = true; return; }
  if (el.querySelector('.idle')) el.innerHTML = '';
  // 活跃会话卡每轮 HTML 都会变→outerHTML 重建;快照/恢复等契约全在 diffPaint(与运行卡区同一实现)
  diffPaint(el, SCARDS, vis.map((r, i) => ({ id: r.sessionId, html: sessCard(r, i) })), spainted);
  spainted = true;
}
function render(): void {
  const list = $('list');
  const q = fstr.toLowerCase();
  const vis = runs.filter(r => (!fproj || (r.cwd || r.project) === fproj) && (!q || (r.name + ' ' + r.runId + ' ' + (r.cwd || r.project) + ' ' + r.status + ' ' + (r.task || '')).toLowerCase().includes(q)));
  const n = (f: (r: Run) => boolean) => vis.filter(f).length;
  // 过滤/搜索是持久化视图状态(1.2.9)——仪表计数随之变化,若不自证口径就会被当成"数据不准"(用户真实报过:
  // 只见 "3 RUNS" 不知还有第 4 个被筛掉)。有过滤时 RUNS 显示「命中/总数」+ tooltip 交代原因。
  const flt = !!(fproj || q);
  // TASKS = 视图内各会话主 agent 调用任务次数之和(后端 turns 单点:尾窗全量+头扫首条;老数据缺字段按 0 计不冒充)
  const tsum = (ls: SessionState[]): number => ls.reduce((a, s) => a + (s.turns || 0), 0);
  const gh = `<div class="g"${flt ? ` title="${esc(T('已按项目/搜索过滤：显示 %1 个，共 %2 个运行 · 任务 %3/%4', vis.length, runs.length, tsum(sess.filter(sessHit)), tsum(sess)))}"` : ''}><b>${vis.length}${flt ? '/' + runs.length : ''}</b><span>RUNS</span></div>
    <div class="g"><b>${tsum(sess.filter(sessHit))}${flt ? '/' + tsum(sess) : ''}</b><span>TASKS</span></div>
    <div class="g lv"><b>${n(r => r.status === 'running')}</b><span>LIVE</span></div>
    <div class="g ok"><b>${n(r => r.status === 'completed')}</b><span>DONE</span></div>
    <div class="g er"><b>${n(r => ALERT_ST.has(r.status))}</b><span>ALERT</span></div>`;
  if (gh !== GSTR[0]) { $('gauges').innerHTML = gh; GSTR[0] = gh; }
  // 空态→非空态:先摘 NO MATCH 段。<p.idle> 无 data-rid,下面的按卡清理会跳过它——不显式摘除就永久
  // 残留在结果尾部(与 renderSessions 的 .idle 清理对称;历史缺失,无头桩 t-diff 复现,1.2.18 修)
  if (vis.length && list.querySelector('.idle')) list.innerHTML = '';
  // 按卡 diff 全在 diffPaint(与会话区同一实现):串稳定的卡绝不重建,滚动/选中/hover 不跳
  diffPaint(list, CARDS, vis.map((r, ii) => ({ id: r.runId, html: card(r, ii) })), painted);
  if (!vis.length && !list.querySelector('.idle')) list.innerHTML = `<p class="idle">${(q || fstr || fproj) ? T('NO MATCH · 无匹配运行，调整搜索或筛选') : T('TELEMETRY SILENT · 近 %1 天无 workflow 运行记录', rdays)}</p>`;
  painted = true;
}
// ── 页面级视口锚定(tick 与全部重绘入口的统一包装)──
// 用户反馈「执行任务中,展开工具调用/agent 详情后上下滚动出现上下漂移」的根因:旧实现把锚点
// 捕获放在 render() 函数体开头,而 tick() 先跑 renderSessions()——执行中会话卡每轮长高(新步骤行)
// 时基线已被增长污染,补偿恒 0;且锚点只在运行卡区找,视线在会话区时不该补的也补。
// 正确语义(等价于浏览器原生 scroll-anchoring 在外壳被 outerHTML 重建后依然生效):
// 基线必须在**任何重建之前**捕获;锚点=文档序(会话卡→运行卡)中第一张底边仍在视口的卡——
// 锚点之上的内容(区标题变高/上方卡长高)变化即补偿,锚点卡自身在视口顶以下追加不补偿。
function renderAnchored(): void {
  const cards = [...$<HTMLElement>('sess').children, ...$<HTMLElement>('list').children] as HTMLElement[];
  const ancEl = cards.find(x => x.getBoundingClientRect().bottom > 2);
  const anc = ancEl ? ancEl.dataset.rid || null : null, off0 = ancEl ? ancEl.getBoundingClientRect().top : 0;
  renderSessions();
  render();
  if (anc) {
    const ae = ([...$<HTMLElement>('sess').children, ...$<HTMLElement>('list').children] as HTMLElement[]).find(c => c.dataset.rid === anc);
    if (ae) { const d = ae.getBoundingClientRect().top - off0; if (Math.abs(d) > 1) window.scrollTo(0, window.scrollY + d); }  // 含 details open 恢复后的最终高度
  }
}
$<HTMLSelectElement>('fproj').onchange = e => { fproj = (e.target as HTMLSelectElement).value; localStorage.setItem('wfo-fproj', fproj); renderAnchored(); };
$<HTMLInputElement>('fq').oninput = e => { fstr = (e.target as HTMLInputElement).value.trim(); localStorage.setItem('wfo-fstr', fstr); renderAnchored(); };
$<HTMLInputElement>('auto').onchange = e => { auto = (e.target as HTMLInputElement).checked; localStorage.setItem('wfo-auto', auto ? '1' : '0'); };
// 首次展开:按 agentId 拉全文(transcript+journal),替换截断预览;FULL 缓存跨轮询重建存活
// data-src 两种形态:proj|sess|run|agent(workflow) 或 S|proj|sess|agent(主/子会话,agent=main#msgId 为主会话单步)
const onToggle = (e: Event) => {
  const x = e.target as Node; if (!(x instanceof HTMLDetailsElement) || !x.open || !x.dataset.src) return;
  const k = x.dataset.k || ''; if (!k || FULL[k]) return;
  const sp = x.dataset.src.split('|'); let url;
  if (sp[0] === 'S') {
    let ag = sp[3] || '', extra = ''; const h = ag.indexOf('#');  // data-src=S|proj|sess|agent(4段);sp[4] 曾误用致 agent=''→全文拉空(TS 迁移回归)
    if (h >= 0) { extra = '&msg=' + encodeURIComponent(ag.slice(h + 1)); ag = ag.slice(0, h); }
    url = `/api/subagent?proj=${encodeURIComponent(sp[1] || '')}&sess=${encodeURIComponent(sp[2] || '')}&agent=${encodeURIComponent(ag)}${extra}`;
  } else {
    url = `/api/agent?proj=${encodeURIComponent(sp[0] || '')}&sess=${encodeURIComponent(sp[1] || '')}&run=${encodeURIComponent(sp[2] || '')}&agent=${encodeURIComponent(sp[3] || '')}`;
  }
  // 活节点查询:fetch 期间轮询可能已重建卡片(x 成孤儿节点),一律按 data-k 重查再写
  const live = () => ((x.ownerDocument || document).querySelector(`details[data-k="${CSS.escape(k)}"]`) as HTMLElement | null) || x;
  const livePanes = () => live().querySelectorAll<HTMLElement>('.pane');
  // 转场(用户反馈"约 1 秒后突然一闪"):展开即给 pane 挂 .q 拉取扫描光,"等一下"变成有预告的过渡;
  // 到达时换内容的 pane 走 .xf 内容淡入 + .xfp 一次性扫光(见 template.html keyframes)
  livePanes().forEach(pn => pn.classList.add('q'));
  const note = (txt: string) => {
    livePanes().forEach(pn => pn.classList.remove('q'));
    const rich = live().querySelector<HTMLElement>('.pane .rich'); if (rich) rich.textContent = txt;
  };
  fetch(url).then(r => r.json()).then(rd => {
    const d = rd as FullResp;
    if (FULL[k]) { livePanes().forEach(pn => pn.classList.remove('q')); return; }  // 并发展开已回填:摘掉加载态防止扫描光永挂
    FULL[k] = { p: d.prompt || '', r: d.result || '', m: !!d.miss };
    livePanes().forEach(pn => {
      const t = pn.dataset.t || '', rich = pn.querySelector<HTMLElement>('.rich'); pn.classList.remove('q'); if (!rich) return;
      let xf = false;
      if (t.startsWith('IN') && FULL[k].p) { rich.innerHTML = mdLite(wrapLong(unent(FULL[k].p))); pn.dataset.t = 'IN · ' + T('全文'); xf = true; }
      else if (t.startsWith('IN') && d.miss) { rich.textContent = T('⚠ 该步已超出转录留存范围，无法回取全文'); pn.dataset.t = 'IN · ' + T('不可回取'); xf = true; }
      if (t.startsWith('OUT') && FULL[k].r) { rich.innerHTML = mdLite(pretty(unent(FULL[k].r))); pn.dataset.t = 'OUT · ' + T('全文'); xf = true; }
      else if (t.startsWith('OUT') && d.miss) { rich.textContent = T('⚠ 该步已超出转录留存范围，无法回取全文'); pn.dataset.t = 'OUT · ' + T('不可回取'); xf = true; }
      if (xf) { void pn.offsetWidth; pn.classList.add('xfp'); rich.classList.add('xf'); }  // offsetWidth 强制 reflow:扫光可从 .q 位置起重播
    });
  }).catch(err => { note(T('⚠ 全文加载失败: ') + String((err && (err as Error).message) || err)); });
};
$('list').addEventListener('toggle', onToggle, true);
$('sess').addEventListener('toggle', onToggle, true);
$('verB').textContent = VER ? 'v' + VER : '';  // 版本角标:旧标签页(无此角标)= 陈旧代码,请刷新
setInterval(() => { if (auto) void tick(); }, 2000); void tick();
// 后台标签页节流补偿:浏览器(Chrome 严格节流/Safari 挂起)会把隐藏页的 setInterval 降到 ~1 次/分钟——
// 用户在终端输入后切回页面,切回瞬间看到的是降频前的旧状态(真实反馈:"输入内容后不能立刻看到最近任务执行的信息")。
// 恢复可见/从 bfcache 返回/窗口回焦 → 立即补扫一轮;三事件同瞬触发用 1s 冷却去重;auto 关闭尊重用户设置不越权。
let lastCatch = 0;
function catchUp(): void {
  if (document.hidden || !auto) return;
  const now = Date.now(); if (now - lastCatch < 1000) return;
  lastCatch = now; void tick();
}
document.addEventListener('visibilitychange', catchUp);
window.addEventListener('pageshow', catchUp);
window.addEventListener('focus', catchUp);
