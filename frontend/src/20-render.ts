// ── 20-render.ts:共享可变状态(全局脚本模式各文件可见)+ 运行卡 + 会话卡渲染 ──
let runs: Run[] = [], sess: SessionState[] = [], fproj = '', fstr = '', auto = true, painted = false, spainted = false, rdays = 14;
const FULL: Record<string, Fu> = {};  // runId:agentId 或 sessionId:msgId/agentId → 全文缓存(跨轮询重建不丢失)
const CARDS: Record<string, string> = {}, SCARDS: Record<string, string> = {}, GSTR: string[] = [''];  // runId/sessionId→上次渲染 HTML(按卡 diff);仪表串缓存

function card(r: Run, i: number): string {
  const done = r.agents.filter(a => a.state === 'done').length, total = r.agentCount || r.agents.length || 1;
  const phDone: Record<string, number> = {}, phRun: Record<string, number> = {};
  r.agents.forEach(a => { const p = a.phase; if (!p) return; if (a.state === 'done') phDone[p] = 1; else if (a.state === 'running') phRun[p] = 1; });
  return `<div class="card${r.live ? ' live' : ''}${painted ? '' : ' en'}" data-rid="${esc(r.runId)}" style="${painted ? '' : `animation-delay:${Math.min(i, 8) * 80}ms`}">
  <div class="hd"><span class="b b-${esc(r.status)}" ${r.status === 'running' ? `style="${AD(1.8)}"` : ''}>${esc(r.status.toUpperCase())}</span>
  <h2>${esc(r.name)}</h2><span class="rid">${esc(r.runId)}</span>
  <span class="meta">${T('T%1 启动', fmtC(r.startedAt).slice(0, 8))} · ${fmtT(r.durationMs)}${r.tokens ? ' · ' + fmtN(r.tokens) + ' tok' : ''}</span></div>
  <div class="cwd">${esc(r.cwd || r.project)} · ${esc(r.session.slice(0, 8))}…</div>
  ${r.task ? `<details class="term taskd" data-k="${esc(r.runId)}:task"><summary class="task clamp">${inlineMd(r.task.replace(/^#{1,4}\s+/gm, '').replace(/^```[^\n]*$/gm, '').slice(0, 170))}</summary><div class="task full rich">${mdLite(r.task)}</div></details>` : ''}
  ${r.phases.length ? `<div class="strip">${r.phases.map(p => `<span class="ph ${phRun[p.title] ? 'on' : phDone[p.title] ? 'fin' : ''}">${esc(p.title)}</span>`).join('')}</div>` : ''}
  <div class="pipe"><div class="trk"></div><div class="fil" style="width:calc(${Math.round(done / total * 100)}% * .98)"></div>
  ${r.agents.map((a, j) => `<div class="nd ${esc(a.state)}" title="${esc(a.label)} · ${esc(a.state)}" style="left:${((j + .5) / (total || 1) * 100).toFixed(1)}%;${a.state === 'running' ? AD(1.6) : ''}"></div>`).join('')}</div>
  <span class="cnt">AGENTS ${done}/${total}${r.live && r.lastActivityAt ? ' · ' + T('最后活动') + ' ' + fmtC(r.lastActivityAt) : ''}${r.orphan ? ' · ' + T('⊘ 发起会话已结束，未正常收尾') : ''}</span>
  <div class="thead"><span></span><span>AGENT</span><span>PHASE</span><span>${T('最近工具')}</span><span class="num">TOKENS</span><span class="num">${T('用时')}</span><span></span></div>
  ${r.agents.map((a, j) => {
    const k = r.runId + ':' + (a.agentId || 'a' + j), fu: Fu = FULL[k] || {};
    const P = fu.p || a.prompt, R = (fu.r || a.result || '') === 'null' ? '' : (fu.r || a.result);
    const d = P || R, src = a.agentId ? ` data-src="${esc(r.project)}|${esc(r.session)}|${esc(r.runId)}|${esc(a.agentId)}"` : '';
    return `<details class="term" data-k="${esc(k)}"${src}${d ? '' : 'style="display:contents"'}${d ? '' : ' open'}><summary class="arow">
  <span class="glyph s-${esc(a.state)}" ${a.state === 'running' ? `style="${AD(1.5)}"` : ''} title="${esc(a.state)}">${GLY(a.state)}</span>
  <span class="lbl">${esc(a.label)}</span><span class="phc">${esc(a.phase || '')}</span><span class="tool">${esc(a.lastTool || '')}</span>
  <span class="num">${fmtN(a.tokens)}</span><span class="num">${fmtT(a.durationMs)}</span><span class="tw"></span></summary>
  ${d ? `<div class="term-body${P && R ? '' : ' solo'}">${P ? paneIn(T(fu.p ? '全文' : '截断预览'), P) : ''}${R ? paneOut(T(fu.r ? '全文' : '截断预览'), R) : ''}</div>` : ''}</details>`;
  }).join('')}
  ${r.logs.length ? `<div style="margin-top:10px"><details class="term" data-k="${esc(r.runId)}:logs"><summary style="cursor:pointer;list-style:none;font:500 10px var(--mono);letter-spacing:.14em;color:var(--cy)">${T('系统日志尾(%1 行·单行≤%2字)', r.logs.length, 500)}</summary>
  <div class="term-body solo"><div class="pane" data-t="SYS · LOGS"><pre>${esc(r.logs.join('\n'))}</pre></div></div></details></div>` : ''}
  ${r.result && !r.live ? `<div style="margin-top:6px"><details class="term" data-k="${esc(r.runId)}:result"><summary style="cursor:pointer;list-style:none;font:500 10px var(--mono);letter-spacing:.14em;color:var(--cy)">${T('运行产物')}</summary>
  <div class="term-body solo"><div class="pane" data-t="RUN · RESULT"><div class="rich">${mdLite(pretty(r.result))}</div></div></div></details></div>` : ''}
  </div>`;
}

// IN/OUT 抽屉面板的单点构造(1.2.18):tag=「全文/截断预览/工具」等态标签,txt=正文。
// 统一过 unent——修此前 workflow 卡"预览不解实体、展开后才解"的口径不一(同内容展开前后渲染不一致)。
const paneIn = (tag: string, txt: string): string => `<div class="pane" data-t="IN · ${tag}"><div class="rich">${mdLite(wrapLong(unent(txt)))}</div></div>`;
const paneOut = (tag: string, txt: string): string => `<div class="pane" data-t="OUT · ${tag}"><div class="rich">${mdLite(pretty(unent(txt)))}</div></div>`;

// 运行终态 → 仪表 ALERT 计数集(单一判定点)。新增 status 需同步核对四处显示位:
// 此集合 / template.html 的 .b-<status> 样式 / 10-util 的 GL 字图标 / notify.py 的 STATUS_ZH 白名单。
const ALERT_ST = new Set(['failed', 'error', 'stale', 'aborted', 'killed', 'timeout']);

// 等待显示策略(单一判定处;renderSessions 的 ⏸ 计数复用):ask/permission=真卡住、该你动手 → 琥珀闪烁告警;
// turn=模型说完、正常交回话轮(执行完成)→ 安静"回合已完",不再占用告警视觉。notifyInput 档位只门控推送、
// 从不管页面显示 —— "关了通知仍被提示等待输入"的根因即 turn 曾被一律渲染成 ⏸ 等待输入(1.2.13 修)。
const sessStuck = (s: SessionState): boolean => s.status === 'input_required' && (s.waitReason === 'ask' || s.waitReason === 'permission');

function sessCard(r: SessionState, i: number): string {
  const tk = r.tokens || ({} as Tok), sa = r.subagents || [], st = r.steps || [], done = sa.filter(a => a.state === 'done').length;
  // 等待用户输入(3.2)：徽标换成中文短标签 + 反白高亮，另起一行交代"在等什么"。串内不放逐秒变化字段(ageSec)，
  // 否则每轮 diff 必失配 → 展开的步骤抽屉"点开即关"(见 CLAUDE.md 前端不变量)。
  const wait = r.status === 'input_required';
  const stuck = sessStuck(r);
  const wlab = r.waitReason === 'ask' ? T('等待回答') : r.waitReason === 'permission' ? T('等待授权') : stuck ? T('等待输入') : T('回合已完');
  const wtxt = (r.lastText || '').replace(/\s+/g, ' ').trim();   // 摘要不再定长裁切：省略号只是折叠，展开即拉全文(见"日志可看全"铁律)
  // 等待行全文抽屉:后端回传 lastTextMid → data-src=main#<id> 懒拉整步全文(FULL 缓存跨轮询存活),
  // 与步骤行/子代理行同一契约;无 mid 的老转录回落到 300 字摘要+指引文案。
  const wkey = r.sessionId + ':wait', wf: Fu = FULL[wkey] || {}, wmid = r.lastTextMid || '';
  const wsrc = wmid && r.lastText ? ` data-src="S|${esc(r.project)}|${esc(r.sessionId)}|main#${esc(wmid)}"` : '';
  const wbody = wf.r ? mdLite(wrapLong(unent(wf.r))) : wf.m ? `<i style="opacity:.7">${esc(T('⚠ 该步已超出转录留存范围，无法回取全文'))}</i>` : mdLite(wrapLong(unent(r.lastText || '')));
  const wtag = wf.r ? T('全文') : wf.m ? T('不可回取') : T('最后输出');
  const whint = (wf.r || wf.m) ? '' : `<div class="hint">${wmid ? T('展开后自动拉取该步所在回合的全部输出(超出转录留存范围会显式提示)') : T('转录留存字段有上限；整步全文请展开下方对应步骤行(超出留存范围会显式提示)')}</div>`;
  // ── 回合分组(1.2.20):一次真人输入 = 一个任务 = 一个独立展示单元,不再把所有步骤平铺一锅端。──
  // 输入行成为组头(仍是 promptline 抽屉契约:data-k=<sid>:prompt:<uuid> 与 data-src 不变 → FULL 缓存、
  // 展开态、懒拉全文跨升级延续),该回合的步骤行挂在组头下。归属只认后端 step.turn
  // ("什么算用户输入"住 _user_prompt 单点,前端不猜边界——CLAUDE.md 不变量)。
  // ❯=终端提示符:机器等你(⏸ 琥珀)对仗你已给出(❯ 青);尾窗口径写进眉标(铁律7)。
  const ps = (r.prompts || []).filter(p => p.u);
  const pmap: Record<string, PromptEcho> = {};
  for (const p of ps) if (!pmap[p.u]) pmap[p.u] = p;
  const byTurn: Record<string, Step[]> = {};
  for (const s of st) { const k = s.turn || ''; (byTurn[k] = byTurn[k] || []).push(s); }
  // 组序=时间序:输入行用其 ts,仅有步骤的组(输入超尾窗)用首步 ts;''(尾窗起点前的孤儿组)置顶
  const ords: { u: string; ts: number }[] = ps.map(p => ({ u: p.u, ts: Date.parse(p.ts || '') || 0 }));
  for (const k in byTurn) ords.push({ u: k, ts: k ? Date.parse(byTurn[k][0].ts || '') || 0 : -1 });
  const seenG: Record<string, 1> = {};
  const grps = ords.sort((a, b) => a.ts - b.ts).filter(o => !seenG[o.u] && (seenG[o.u] = 1));
  const turnHead = (u: string, n: number): string => {
    const p = pmap[u];
    const k = r.sessionId + ':prompt:' + u, pf: Fu = FULL[k] || {};
    const ptag = pf.p ? T('全文') : pf.m ? T('不可回取') : T('截断预览');
    const pbody = pf.p ? mdLite(wrapLong(unent(pf.p))) : pf.m ? `<i style="opacity:.7">${esc(T('⚠ 该条输入已超出转录留存范围，无法回取全文'))}</i>` : mdLite(wrapLong(unent(p ? p.t || '' : '')));
    const phint = (pf.p || pf.m) ? '' : `<div class="hint">${T('展开后自动拉取整条输入全文(超出转录留存范围会显式提示)')}</div>`;
    const summ = p ? `<span class="pk">${p.ts ? fmtC(Date.parse(p.ts)) : '—'}</span>${p.f ? `<span class="fchip">${T('最初')}</span>` : ''}<span class="pt">${esc((p.t || '').replace(/\s+/g, ' ').trim())}</span>`
                   : `<span class="pk">—</span><span class="pt"><i style="opacity:.45">${esc(T('(该任务输入超出尾窗 · 展开取全文)'))}</i></span>`;
    return `<details class="term promptline turnhd" data-k="${esc(k)}" data-src="S|${esc(r.project)}|${esc(r.sessionId)}|main#${esc(u)}">
  <summary>${summ}<span class="tc">${T('%1 步', n)}</span></summary>
  <div class="term-body solo"><div class="pane" data-t="IN · ${ptag}"><div class="rich">${pbody}</div>${phint}</div></div></details>`;
  };
  const orphanHead = (n: number): string => `<div class="turnhd orphan"><span class="pk">—</span><span class="pt"><i style="opacity:.45">${esc(T('(该回合开场输入在尾窗之前)'))}</i></span><span class="tc">${T('%1 步', n)}</span></div>`;
  const lastMid = st.length ? st[st.length - 1].msgId : '';
  const stepRow = (s: Step): string => {
    const last = s.msgId === lastMid, g = (last && r.status === 'running' && r.pendingTools.length > 0) ? 'running' : 'done', k = r.sessionId + ':' + s.msgId, fu: Fu = FULL[k] || {}, P = fu.p || '', R = fu.r !== undefined ? fu.r : (s.text || '');
    return `<details class="term tstep" data-k="${esc(k)}" data-src="S|${esc(r.project)}|${esc(r.sessionId)}|main#${esc(s.msgId)}">
  <summary class="arow">
  <span class="glyph s-${g}" ${g === 'running' ? `style="${AD(1.5)}"` : ''} title="${esc(s.model || '')}">${g === 'running' ? '◈' : '▸'}</span>
  <span class="lbl" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((s.text || '').replace(/\s+/g, ' ').slice(0, 110)) || `<i style="opacity:.45">${T('(工具调用步)')}</i>`}</span>
  <span class="tool">${esc((s.tools || []).join(' '))}</span>
  <span class="num">${fmtN(s.tokIn)}/${fmtN(s.tokOut)}</span><span class="num">${s.ts ? fmtC(Date.parse(s.ts)) : '—'}</span><span class="tw"></span></summary>
  <div class="term-body${R && P ? '' : ' solo'}"><div class="pane" data-t="IN · ${T(P ? '工具入参全文' : '工具')}"><div class="rich">${P ? mdLite(wrapLong(unent(P))) : esc((s.tools || []).map(t => '● ' + t).join(' ')) || T('(本步无工具调用)')}</div></div>${R ? paneOut(T(fu.r !== undefined ? '全文' : '截断预览'), R) : ''}</div></details>`;
  };
  const taskRegion = (st.length || ps.length) ? `<div class="phead"><span>${T('任务(回合)· 尾窗 %1 输入 · %2 步骤', ps.length, st.length)}</span></div>
  <div class="thead"><span></span><span>${T('步骤 · 输出')}</span><span>${T('工具')}</span><span class="num">TOK in/out</span><span class="num">${T('时间')}</span><span class="num"></span><span></span></div>
  ${grps.map(o => `<div class="tg">${o.u ? turnHead(o.u, (byTurn[o.u] || []).length) : orphanHead((byTurn[''] || []).length)}${(byTurn[o.u] || []).map(stepRow).join('')}</div>`).join('')}` : '';
  return `<div class="card${r.alive ? ' live' : ''}${stuck ? ' wait' : ''}${spainted ? '' : ' en'}" data-rid="${esc(r.sessionId)}" style="${spainted ? '' : `animation-delay:${Math.min(i, 8) * 80}ms`}">
  <div class="hd"><span class="b b-${wait ? (stuck ? 'input_required' : 'turn') : esc(r.status)}" ${r.status === 'running' ? `style="${AD(1.8)}"` : ''}>${wait ? wlab : esc(r.status.toUpperCase())}</span>
  <h2>${esc(r.title || T('会话 %1', r.sessionId.slice(0, 8)))}</h2><span class="rid">${esc(r.sessionId.slice(0, 8))}${r.pid ? ' · pid ' + r.pid : ''}</span>
  <span class="meta">${T('主 agent')} · ${esc(r.model || '?')}${r.permissionMode ? ' · ' + T('%1 模式', esc(r.permissionMode)) : ''}${r.kind ? ' · ' + esc(r.kind) : ''}</span></div>
  <div class="cwd">${esc(r.cwd || r.project)} · ${T('T%1 启动', fmtC(r.startedAt).slice(0, 8))} · ${T('最后活动')} ${fmtC(r.lastActivityAt)} · ${r.turns === undefined ? '' : T('尾窗任务 %1', r.turns) + ' · '}${T('尾窗工具调用')} ${r.toolCalls}</div>
  ${wait ? `<details class="term waitline${stuck ? '' : ' turn'}" data-k="${esc(r.sessionId)}:wait"${wsrc}${r.lastText ? '' : ' style="display:contents"'}><summary title="${esc(wtxt)}"><span class="wk">${stuck ? T('在等') + ' · ' + (r.waitTool ? esc(r.waitTool) : T('你的回复')) : T('最后输出')}</span><span class="wt">${wtxt ? esc(wtxt) : `<i style="opacity:.45">${T('(无文本输出)')}</i>`}</span></summary>
  <div class="term-body solo"><div class="pane" data-t="OUT · ${wtag}"><div class="rich">${wbody}</div>${whint}</div></div></details>` : ''}
  <div class="strip"><span class="ph ${r.pendingTools.length ? 'on' : ''}">${T('最近工具')} ${esc(r.pendingTools[0] || '—')}${r.pendingTools.length > 1 ? ' ' + T('等%1项', r.pendingTools.length) : ''}</span>
  <span class="ph fin">tok in ${fmtN(tk.input)} / out ${fmtN(tk.output)} / cacheR ${fmtN(tk.cacheRead)}</span>
  <span class="ph ${done < sa.length ? 'on' : 'fin'}">subagents ${done}/${sa.length}</span></div>
  ${taskRegion}
  ${sa.length ? `<div class="thead"><span></span><span>AGENT</span><span>${T('类型 · 模型')}</span><span>${T('最近工具')}</span><span class="num">TOK in/out</span><span class="num">${T('最后活动')}</span><span></span></div>
  ${sa.map(a => {
    const k = r.sessionId + ':' + a.agentId, fu: Fu = FULL[k] || {}, P = fu.p || a.prompt, R = fu.r !== undefined ? fu.r : a.lastText;
    return `<details class="term" data-k="${esc(k)}" data-src="S|${esc(r.project)}|${esc(r.sessionId)}|${esc(a.agentId)}"${P || R ? '' : ' open'}><summary class="arow" title="${esc(a.description || '')}${a.teamName ? ' · team ' + esc(a.teamName) : ''}">
  <span class="glyph s-${esc(a.state)}" ${a.state === 'running' ? `style="${AD(1.5)}"` : ''} title="${esc(a.state)}${a.pendingTools.length ? ' → ' + esc(a.pendingTools.join(',')) : ''}">${GLY(a.state)}</span>
  <span class="lbl">${esc(a.label)}</span><span class="phc">${esc((a.kind === 'teammate' ? 'T·' : '') + (a.agentType || 'agent'))} · ${esc(a.model || '')}</span><span class="tool">${esc(a.lastTool || '')}</span>
  <span class="num">${fmtN(a.tokens ? a.tokens.input : null)}/${fmtN(a.tokens ? a.tokens.output : null)}</span><span class="num">${fmtC(a.lastActivityAt)}</span><span class="tw"></span></summary>
  ${P || R ? `<div class="term-body${P && R ? '' : ' solo'}">${P ? paneIn(T(fu.p ? '全文' : '截断预览'), P) : ''}${R ? paneOut(T(fu.r !== undefined ? '全文' : '截断预览'), R) : ''}</div>` : ''}</details>`;
  }).join('')}` : ''}
  </div>`;
}
