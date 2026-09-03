// ── 20-render.ts:共享可变状态(全局脚本模式各文件可见)+ 运行卡 + 会话卡渲染 ──
let runs: Run[] = [], sess: SessionState[] = [], fproj = '', fstr = '', auto = true, painted = false, spainted = false;
const FULL: Record<string, { p: string; r: string }> = {};  // runId:agentId 或 sessionId:msgId/agentId → 全文缓存(跨轮询重建不丢失)
const CARDS: Record<string, string> = {}, SCARDS: Record<string, string> = {}, GSTR: string[] = [''];  // runId/sessionId→上次渲染 HTML(按卡 diff);仪表串缓存

function card(r: Run, i: number): string {
  const done = r.agents.filter(a => a.state === 'done').length, total = r.agentCount || r.agents.length || 1;
  const phDone: Record<string, number> = {}, phRun: Record<string, number> = {};
  r.agents.forEach(a => { const p = a.phase; if (!p) return; if (a.state === 'done') phDone[p] = 1; else if (a.state === 'running') phRun[p] = 1; });
  return `<div class="card${r.live ? ' live' : ''}${painted ? '' : ' en'}" data-rid="${esc(r.runId)}" style="${painted ? '' : `animation-delay:${Math.min(i, 8) * 80}ms`}">
  <div class="hd"><span class="b b-${esc(r.status)}" ${r.status === 'running' ? `style="${AD(1.8)}"` : ''}>${esc(r.status.toUpperCase())}</span>
  <h2>${esc(r.name)}</h2><span class="rid">${esc(r.runId)}</span>
  <span class="meta">T${fmtC(r.startedAt).slice(0, 8)} 启动 · ${fmtT(r.durationMs)}${r.tokens ? ' · ' + fmtN(r.tokens) + ' tok' : ''}</span></div>
  <div class="cwd">${esc(r.cwd || r.project)} · ${esc(r.session.slice(0, 8))}…</div>
  ${r.task ? `<details class="term taskd" data-k="${esc(r.runId)}:task"><summary class="task clamp">${inlineMd(r.task.replace(/^#{1,4}\s+/gm, '').replace(/^```[^\n]*$/gm, '').slice(0, 170))}</summary><div class="task full rich">${mdLite(r.task)}</div></details>` : ''}
  ${r.phases.length ? `<div class="strip">${r.phases.map(p => `<span class="ph ${phRun[p.title] ? 'on' : phDone[p.title] ? 'fin' : ''}">${esc(p.title)}</span>`).join('')}</div>` : ''}
  <div class="pipe"><div class="trk"></div><div class="fil" style="width:calc(${Math.round(done / total * 100)}% * .98)"></div>
  ${r.agents.map((a, j) => `<div class="nd ${esc(a.state)}" title="${esc(a.label)} · ${esc(a.state)}" style="left:${((j + .5) / (total || 1) * 100).toFixed(1)}%;${a.state === 'running' ? AD(1.6) : ''}"></div>`).join('')}</div>
  <span class="cnt">AGENTS ${done}/${total}${r.live && r.lastActivityAt ? ' · 最后活动 ' + fmtC(r.lastActivityAt) : ''}${r.orphan ? ' · ⊘ 发起会话已结束，未正常收尾' : ''}</span>
  <div class="thead"><span></span><span>AGENT</span><span>PHASE</span><span>最近工具</span><span class="num">TOKENS</span><span class="num">用时</span><span></span></div>
  ${r.agents.map((a, j) => {
    const k = r.runId + ':' + (a.agentId || 'a' + j), fu: Fu = FULL[k] || {};
    const P = fu.p || a.prompt, R = (fu.r || a.result || '') === 'null' ? '' : (fu.r || a.result);
    const d = P || R, src = a.agentId ? ` data-src="${esc(r.project)}|${esc(r.session)}|${esc(r.runId)}|${esc(a.agentId)}"` : '';
    return `<details class="term" data-k="${esc(k)}"${src}${d ? '' : 'style="display:contents"'}${d ? '' : ' open'}><summary class="arow">
  <span class="glyph s-${esc(a.state)}" ${a.state === 'running' ? `style="${AD(1.5)}"` : ''} title="${esc(a.state)}">${GLY(a.state)}</span>
  <span class="lbl">${esc(a.label)}</span><span class="phc">${esc(a.phase || '')}</span><span class="tool">${esc(a.lastTool || '')}</span>
  <span class="num">${fmtN(a.tokens)}</span><span class="num">${fmtT(a.durationMs)}</span><span class="tw"></span></summary>
  ${d ? `<div class="term-body${P && R ? '' : ' solo'}">${P ? `<div class="pane" data-t="${fu.p ? 'IN · 全文' : 'IN · 截断预览'}"><div class="rich">${mdLite(wrapLong(P))}</div></div>` : ''}${R ? `<div class="pane" data-t="${fu.r ? 'OUT · 全文' : 'OUT · 截断预览'}"><div class="rich">${mdLite(pretty(R))}</div></div>` : ''}</div>` : ''}</details>`;
  }).join('')}
  ${r.logs.length ? `<div style="margin-top:10px"><details class="term" data-k="${esc(r.runId)}:logs"><summary style="cursor:pointer;list-style:none;font:500 10px var(--mono);letter-spacing:.14em;color:var(--cy)">系统日志尾(${r.logs.length})</summary>
  <div class="term-body solo"><div class="pane" data-t="SYS · LOGS"><pre>${esc(r.logs.slice(-15).join('\n'))}</pre></div></div></details></div>` : ''}
  ${r.result && !r.live ? `<div style="margin-top:6px"><details class="term" data-k="${esc(r.runId)}:result"><summary style="cursor:pointer;list-style:none;font:500 10px var(--mono);letter-spacing:.14em;color:var(--cy)">运行产物</summary>
  <div class="term-body solo"><div class="pane" data-t="RUN · RESULT"><div class="rich">${mdLite(pretty(r.result))}</div></div></div></details></div>` : ''}
  </div>`;
}

function sessCard(r: SessionState, i: number): string {
  const tk = r.tokens || ({} as Tok), sa = r.subagents || [], st = r.steps || [], done = sa.filter(a => a.state === 'done').length;
  return `<div class="card${r.alive ? ' live' : ''}${spainted ? '' : ' en'}" data-rid="${esc(r.sessionId)}" style="${spainted ? '' : `animation-delay:${Math.min(i, 8) * 80}ms`}">
  <div class="hd"><span class="b b-${esc(r.status)}" ${r.status === 'running' ? `style="${AD(1.8)}"` : ''}>${esc(r.status.toUpperCase())}</span>
  <h2>${esc(r.title || '会话 ' + r.sessionId.slice(0, 8))}</h2><span class="rid">${esc(r.sessionId.slice(0, 8))}${r.pid ? ' · pid ' + r.pid : ''}</span>
  <span class="meta">主 agent · ${esc(r.model || '?')} · ${esc(r.permissionMode || '')}模式${r.kind ? ' · ' + esc(r.kind) : ''}</span></div>
  <div class="cwd">${esc(r.cwd || r.project)} · T${fmtC(r.startedAt).slice(0, 8)} 启动 · 最后活动 ${fmtC(r.lastActivityAt)} · 尾窗工具调用 ${r.toolCalls}</div>
  <div class="strip"><span class="ph ${r.pendingTools.length ? 'on' : ''}">最近工具 ${esc(r.pendingTools[0] || '—')}${r.pendingTools.length > 1 ? ' 等' + r.pendingTools.length + '项' : ''}</span>
  <span class="ph fin">tok in ${fmtN(tk.input)} / out ${fmtN(tk.output)} / cacheR ${fmtN(tk.cacheRead)}</span>
  <span class="ph ${done < sa.length ? 'on' : 'fin'}">subagents ${done}/${sa.length}</span></div>
  ${st.length ? `<div class="thead"><span></span><span>步骤 · 输出</span><span>工具</span><span class="num">TOK in/out</span><span class="num">时间</span><span class="num"></span><span></span></div>
  ${st.map((s, j) => {
    const last = j === st.length - 1, g = (last && r.status === 'running' && r.pendingTools.length > 0) ? 'running' : 'done', k = r.sessionId + ':' + s.msgId, fu: Fu = FULL[k] || {}, P = fu.p || '', R = fu.r !== undefined ? fu.r : (s.text || '');
    return `<details class="term" data-k="${esc(k)}" data-src="S|${esc(r.project)}|${esc(r.sessionId)}|main#${esc(s.msgId)}">
  <summary class="arow">
  <span class="glyph s-${g}" ${g === 'running' ? `style="${AD(1.5)}"` : ''} title="${esc(s.model || '')}">${g === 'running' ? '◈' : '▸'}</span>
  <span class="lbl" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((s.text || '').replace(/\s+/g, ' ').slice(0, 110)) || '<i style="opacity:.45">(工具调用步)</i>'}</span>
  <span class="tool">${esc((s.tools || []).join(' '))}</span>
  <span class="num">${fmtN(s.tokIn)}/${fmtN(s.tokOut)}</span><span class="num">${s.ts ? fmtC(Date.parse(s.ts)) : '—'}</span><span class="tw"></span></summary>
  <div class="term-body${R && P ? '' : ' solo'}"><div class="pane" data-t="${P ? 'IN · 工具入参全文' : 'IN · 工具'}"><div class="rich">${P ? mdLite(wrapLong(unent(P))) : esc((s.tools || []).map(t => '● ' + t).join(' ') || '(本步无工具调用)')}</div></div>${R ? `<div class="pane" data-t="${fu.r !== undefined ? 'OUT · 全文' : 'OUT · 截断预览'}"><div class="rich">${mdLite(pretty(unent(R)))}</div></div>` : ''}</div></details>`;
  }).join('')}` : ''}
  ${sa.length ? `<div class="thead"><span></span><span>AGENT</span><span>类型 · 模型</span><span>最近工具</span><span class="num">TOK in/out</span><span class="num">最后活动</span><span></span></div>
  ${sa.map(a => {
    const k = r.sessionId + ':' + a.agentId, fu: Fu = FULL[k] || {}, P = fu.p || a.prompt, R = fu.r !== undefined ? fu.r : a.lastText;
    return `<details class="term" data-k="${esc(k)}" data-src="S|${esc(r.project)}|${esc(r.sessionId)}|${esc(a.agentId)}"${P || R ? '' : ' open'}><summary class="arow" title="${esc(a.description || '')}${a.teamName ? ' · team ' + esc(a.teamName) : ''}">
  <span class="glyph s-${esc(a.state)}" ${a.state === 'running' ? `style="${AD(1.5)}"` : ''} title="${esc(a.state)}${a.pendingTools.length ? ' → ' + esc(a.pendingTools.join(',')) : ''}">${GLY(a.state)}</span>
  <span class="lbl">${esc(a.label)}</span><span class="phc">${esc((a.kind === 'teammate' ? 'T·' : '') + (a.agentType || 'agent'))} · ${esc(a.model || '')}</span><span class="tool">${esc(a.lastTool || '')}</span>
  <span class="num">${fmtN(a.tokens ? a.tokens.input : null)}/${fmtN(a.tokens ? a.tokens.output : null)}</span><span class="num">${fmtC(a.lastActivityAt)}</span><span class="tw"></span></summary>
  ${P || R ? `<div class="term-body${P && R ? '' : ' solo'}">${P ? `<div class="pane" data-t="${fu.p ? 'IN · 全文' : 'IN · 截断预览'}"><div class="rich">${mdLite(wrapLong(unent(P)))}</div></div>` : ''}${R ? `<div class="pane" data-t="${fu.r !== undefined ? 'OUT · 全文' : 'OUT · 截断预览'}"><div class="rich">${mdLite(pretty(unent(R)))}</div></div>` : ''}</div>` : ''}</details>`;
  }).join('')}` : ''}
  </div>`;
}
