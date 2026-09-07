// ── 40-flow.ts:「✦ 编排」模态——选中项目 → 可视化编排 Workflow → 保存草稿 → 终端 scriptPath 执行 ──
// 数据面与主视图完全隔离:编辑器只住 #flow(独立容器),不进 #list/#sess 的 diffPaint 池,黄金快照零漂移;
// tick()/render()/catchUp() 永不触碰它,轮询照常在后台跑。
// ⚠ XYFlowSystem(vendored UMD)只许在函数体内取(顶层取属性会在无 vendor 环境——例如无头测试桩——直接
//   ReferenceError 打断整块);一律经 xy() 惰性拿。画布交互由 headless 五断言实证(?flowsmoke=1)。
// DOM 契约 C1–C10(@xyflow/system 的隐藏要求,踩坑实录见 docs/xyflow-integration-research.md §4)的实现位置:
//   C1 template 骨架类名 / C2–C6 nodeHTML+handleHTML 单点 / C7 safely() / C8 六回调 / C10 measureFlow()。
const FLOW_LIB = 'lucid';              // 类名前缀契约:{lib}-flow__node / __pane / __handle(C2/C3)
const FLOW_ID = 'lwf';                 // isValidHandle 以 data-id="${flowId}-${nodeId}-${handleId}-${type}" 反查 handle(C5)
const FLOW_HANDLE_R = 40;              // 连线吸附半径(配 C5:拖出视口仍能连)
const FLOW_MIN_Z = 0.2, FLOW_MAX_Z = 2.5;
const FLOW_DRAG_TH = 3;                // 拖拽阈值:小于此位移算点击,不误拖节点
const FLOW_EXTENT: number[][] = [[-1e5, -1e5], [1e5, 1e5]];
const FLOW_LS = 'wfo-flow-autosave-';  // 防误关丢失(按项目 slug 存;显式保存才走 /api/draft/save)
const FLOW_MODELS = ['sonnet', 'opus', 'haiku', 'fable', 'mythos'];

interface FlowStore { name: string; desc: string; cwd: string; nodes: FlowNode[]; edges: FlowEdge[]; next: number; sel: Set<string>; view: FlowView }
let FS: FlowStore = { name: '', desc: '', cwd: '', nodes: [], edges: [], next: 1, sel: new Set(), view: { x: 20, y: 10, zoom: 1 } };
let flowVisible = false, flowWired = false;
let fpz: FlowPanZoom | null = null;
const flookup = new Map<string, FlowIntern>();       // adoptUserNodes 的产物(XYDrag/XYHandle 都读它)
const fparents = new Map<string, unknown>();
const fbounds = new Map<string, FlowHandleBounds>();  // 手写测量的 handle 位置(C10)
const fdrag = new Map<string, FlowDragInst>();
let ffrom: FlowFromHandle | null = null;              // 坑⑤:vendor 每帧 move 的守卫,不许回吐 null
let fDrafts: DraftItem[] = [];
// 冒烟诊断(?flowsmoke 下才非空):连线失败时把"vendor 到底调没调我们"带进 title,不靠猜
let fDbg: Record<string, number> | null = null;

const xy = (): typeof XYFlowSystem => XYFlowSystem;
const fPane = (): HTMLElement => $<HTMLElement>('fPane');
const fVp = (): HTMLElement => $<HTMLElement>('fViewport');
const fSvg = (): Element => $<HTMLElement>('fEdges');
const fConnEl = (): Element => document.getElementById('fConn') as Element;
const flowSlug = (): string => FS.cwd || '__no_cwd__';
const tailNum = (s: unknown): number => { const m = /(\d+)$/.exec(String(s ?? '')); return m ? Number(m[1]) : 0; };

// C7:喂给 vendor 的包装层回调**不许 throw**——vendor 内部不做 try/catch,抛出会静默打断其自身监听注册
// (症状实录:"拖出虚线后松手什么都不发生,连虚线都没有")。一律经 safely(),异常走 #fErr 可见(铁律 7)。
function safely<A extends unknown[]>(tag: string, fn: (...a: A) => void): (...a: A) => void {
  return (...a: A) => {
    try { fn(...a); }
    catch (e) { flowErr(T('编辑器回调异常') + ' [' + tag + ']: ' + String((e as Error)?.message ?? e) + '\n' + String((e as Error)?.stack ?? '')); }
  };
}
function flowErr(msg: string): void {
  const b = $<HTMLElement>('fErr'); if (!b) return;
  b.textContent = msg; b.hidden = !msg;
}
function flowNote(msg: string, ok: boolean): void {
  const b = $<HTMLElement>('fNote'); if (!b) return;
  b.textContent = msg; b.style.color = ok ? 'var(--gr)' : 'var(--rd)';
}

// ── 渲染:节点 DOM 的唯一实现(C2–C6 属性只在这里拼;别处禁止再拼一份 handle HTML)──
function handleHTML(n: FlowNode, type: 'source' | 'target'): string {
  const hid = type === 'source' ? 'out' : 'in', pos = type === 'source' ? 'right' : 'left';
  // connectable + connectableend = isConnectable 的隐藏契约:缺任一 → isValid 恒 false → 连线静默失效(C4)
  return `<div class="${FLOW_LIB}-flow__handle ${type} nodrag connectable connectableend" data-handleid="${hid}"` +
    ` data-handlepos="${pos}" data-nodeid="${n.id}" data-id="${FLOW_ID}-${n.id}-${hid}-${type}" title="${type}"></div>`;
}
function nodeHTML(n: FlowNode): string {
  const d = n.data, t = n.type;
  const label = t === 'agent' ? 'AGENT' : t === 'start' ? 'START' : 'RETURN';
  let fields = '';
  if (t === 'start') fields = `<label>${T('说明(生成 args 入口)')}</label><input class="nodrag f-note" value="${esc(d.note || '')}" placeholder="${esc(T('如:调研选题'))}">`;
  if (t === 'agent') fields =
    `<label>${T('label / phase')}</label><div class="frow"><input class="nodrag f-label" value="${esc(d.label || '')}" placeholder="label"><input class="nodrag f-phase" value="${esc(d.phase || '')}" placeholder="phase"></div>` +
    `<label>${T('prompt(可引用 {{nX}})')}</label><textarea class="nodrag f-prompt" rows="3">${esc(d.prompt || '')}</textarea>` +
    `<label>${T('model / schema(可空)')}</label><div class="frow"><select class="nodrag f-model"><option value="">inherit</option>${FLOW_MODELS.map(m => `<option${d.model === m ? ' selected' : ''}>${m}</option>`).join('')}</select><textarea class="nodrag f-schema" rows="1" placeholder="{JSON Schema}">${esc(d.schemaText || '')}</textarea></div>`;
  if (t === 'return') fields = `<label>${T('return 表达式')}</label><textarea class="nodrag f-ret" rows="2">${esc(d.ret || '')}</textarea>`;
  return `<div class="wfnode t-${t} ${FLOW_LIB}-flow__node nopan${FS.sel.has(n.id) ? ' sel' : ''}" data-nodeid="${n.id}" style="left:${n.position.x}px;top:${n.position.y}px">` +
    `<div class="hd"><b>${label}</b>${t === 'agent' && d.label ? `<span>${esc(d.label)}</span>` : ''}<span class="tag nodrag" title="${T('删除节点')}">✕</span></div>${fields}` +
    (t !== 'start' ? handleHTML(n, 'target') : '') + (t !== 'return' ? handleHTML(n, 'source') : '') + `</div>`;
}
function fNodeEl(id: string): HTMLElement | null {
  return fVp().querySelector<HTMLElement>(`.wfnode[data-nodeid="${id}"]`);
}
// C10:vendor 的 dimensions 测量挂在 ResizeObserver 上(本仓零 bundler 不引),handleBounds 由我们手写测量注入。
// 不注入的实录后果:isValid 找不到 handle(连不上)、边端点随缩放漂移。口径 = 节点内相对坐标 ÷ zoom(缩放不变)。
function measureFlow(): void {
  for (const n of FS.nodes) {
    const el = fNodeEl(n.id); if (!el) continue;
    const box = el.getBoundingClientRect(), z = FS.view.zoom || 1;
    const grab = (type: 'source' | 'target'): FlowHandleBound[] =>
      Array.from(el.querySelectorAll('.lucid-flow__handle.' + type)).map(h => {
        const r = h.getBoundingClientRect();
        return { id: h.getAttribute('data-handleid'), type, position: h.getAttribute('data-handlepos') || '',
          x: (r.left - box.left) / z, y: (r.top - box.top) / z, width: r.width / z, height: r.height / z };
      });
    fbounds.set(n.id, { source: grab('source'), target: grab('target') });
    const m = el as unknown as { offsetWidth: number; offsetHeight: number };
    n.measured = { width: m.offsetWidth, height: m.offsetHeight };
  }
}
function syncLookup(): void {
  xy().adoptUserNodes(FS.nodes, flookup, fparents, { nodeOrigin: [0, 0], nodeExtent: FLOW_EXTENT });
  for (const n of FS.nodes) {
    const it = flookup.get(n.id);
    if (it && fbounds.has(n.id)) it.internals.handleBounds = fbounds.get(n.id);
  }
}
function flowRender(): void {
  if (!flowWired) return;                                 // 未打开时不碰 DOM(编辑器元素虽在壳里,但画布尚未初始化)
  for (const i of fdrag.values()) i.destroy();
  fdrag.clear();
  fVp().querySelectorAll('.wfnode').forEach(el => el.remove());
  fVp().insertAdjacentHTML('beforeend', FS.nodes.map(nodeHTML).join(''));
  measureFlow(); syncLookup(); wireNodes(); renderEdges(); refreshFlowScript(); autosaveFlow();
}

// ── 交互装配:字段编辑 / 选择 / 拖拽 / 连线起点 ──
function wireNodes(): void {
  for (const n of FS.nodes) {
    const el = fNodeEl(n.id); if (!el) continue;
    // 字段只改状态 + 重出脚本,**不整重渲染**(否则 textarea 焦点每键丢一次);改 label 即时刷表头 span
    const bind = (sel: string, key: keyof FlowNodeData): void => {
      const f = el.querySelector<HTMLInputElement>(sel);
      if (f) f.addEventListener('input', () => {
        n.data[key] = f.value;
        if (key === 'label') { const sp = el.querySelector('.hd span'); if (sp) sp.textContent = String(n.data.label || ''); }
        refreshFlowScript(); autosaveFlow();
      });
    };
    bind('.f-label', 'label'); bind('.f-phase', 'phase'); bind('.f-prompt', 'prompt');
    bind('.f-model', 'model'); bind('.f-schema', 'schemaText'); bind('.f-ret', 'ret'); bind('.f-note', 'note');
    el.querySelector('.tag')?.addEventListener('mousedown', e => { e.stopPropagation(); flowRemoveNode(n.id); });
    el.addEventListener('mousedown', () => { if (!FS.sel.has(n.id)) { FS.sel.clear(); FS.sel.add(n.id); refreshSel(); } });
    el.querySelectorAll('.lucid-flow__handle').forEach(h => {
      h.addEventListener('pointerdown', ev => startConnect(ev as PointerEvent, h, n.id, h.classList.contains('target')));
    });
    // 每节点一个 XYDrag 实例(与 react-flow 的 NodeWrapper 同模式);阈值内位移算点击
    const inst = fdrag.get(n.id) || xy().XYDrag({
      getStoreItems: dragStore,
      onDrag: safely('onDrag', (_e: Event, items: Map<string, { position: FlowPos }>) => applyDrag(items)),
      onDragStop: safely('onDragStop', (_e: Event, items: Map<string, { position: FlowPos }>) => { applyDrag(items); flowRender(); })
    });
    fdrag.set(n.id, inst);
    inst.update({ domNode: el, nodeId: n.id, handleSelector: `.${FLOW_LIB}-flow__node`, noDragClassName: 'nodrag', nodeClickDistance: FLOW_DRAG_TH });
  }
}
function dragStore(): Record<string, unknown> {
  return {
    nodes: FS.nodes, nodeLookup: flookup, edges: FS.edges, nodeExtent: FLOW_EXTENT, snapGrid: [16, 16], snapToGrid: false,
    nodeOrigin: [0, 0], multiSelectionActive: false, domNode: fPane(), transform: [FS.view.x, FS.view.y, FS.view.zoom],
    autoPanOnNodeDrag: false, nodesDraggable: true, selectNodesOnDrag: true, nodeDragThreshold: FLOW_DRAG_TH,
    panBy: async () => false,                     // panBy 未从 XYPanZoom 实例暴露(X5 待补)→ 关 autoPan,别给 vendor 喂 undefined
    unselectNodesAndEdges() { FS.sel.clear(); refreshSel(); },
    updateNodePositions(items: Map<string, { position: FlowPos }>) { applyDrag(items); },
    onError(err: unknown) { flowErr(T('编辑器回调异常') + ' [xyflow]: ' + String((err as Error)?.message ?? err)); },
  };
}
function applyDrag(items: Map<string, { position: FlowPos }>): void {
  for (const [id, it] of items) {
    const n = FS.nodes.find(x => x.id === id); if (!n) continue;
    n.position = { x: it.position.x, y: it.position.y };
    const el = fNodeEl(id);
    if (el) { el.style.left = n.position.x + 'px'; el.style.top = n.position.y + 'px'; }
  }
  renderEdges();
}
function refreshSel(): void {
  for (const n of FS.nodes) { const el = fNodeEl(n.id); if (el) el.classList.toggle('sel', FS.sel.has(n.id)); }
}

// ── 连线:XYHandle.onPointerDown 全权接管(自挂 move/up、吸附、回调)──
function startConnect(ev: PointerEvent, handleDomNode: Element, nodeId: string, isTarget: boolean): void {
  ev.preventDefault();
  ffrom = null;
  xy().XYHandle.onPointerDown(ev as unknown as MouseEvent, {
    autoPanOnConnect: false, connectionMode: 'loose', connectionRadius: FLOW_HANDLE_R, domNode: fPane(),
    handleId: handleDomNode.getAttribute('data-handleid'), nodeId, isTarget,
    nodeLookup: flookup, lib: FLOW_LIB, flowId: FLOW_ID,
    updateConnection: safely('updateConnection', drawConn),
    panBy: async () => false,
    cancelConnection: safely('cancelConnection', () => { if (fDbg) fDbg.cancel++; fConnEl().setAttribute('d', ''); ffrom = null; }),
    // 坑⑤:onConnectStart 前 getFromHandle() 若为 null,vendor 每帧立即取消连接 → 这里记下并回吐
    onConnectStart: safely('onConnectStart', (_e: Event, p: FlowStartParam) => { if (fDbg) fDbg.start++; ffrom = { nodeId: p.nodeId, id: p.handleId, type: p.handleType }; }),
    onConnect: safely('onConnect', (c: FlowConn) => { if (fDbg) fDbg.connect++; flowConnect(c); }),
    onConnectEnd: safely('onConnectEnd', () => { fConnEl().setAttribute('d', ''); ffrom = null; }),
    isValidConnection: (c: FlowConn) => !!c && c.source !== c.target,
    getTransform: () => [FS.view.x, FS.view.y, FS.view.zoom],
    getFromHandle: () => ffrom,
    handleDomNode, dragThreshold: 1,
  });
}
// 加边单点(vendor 回调与测试共用;发号与去重只在这里)
function flowConnect(c: FlowConn): void {
  if (!c || c.source === c.target) return;
  if (FS.edges.some(e => e.source === c.source && e.target === c.target)) return;   // 同一对节点不叠边
  FS.edges = xy().addEdge({ ...c, id: 'e' + (FS.next++) }, FS.edges);
  flowRender();
}
function handlePoint(nodeId: string, handleId: string | null, type: 'source' | 'target'): { x: number; y: number; pos: string } | null {
  const n = FS.nodes.find(x => x.id === nodeId), hb = fbounds.get(nodeId)?.[type];
  if (!n || !hb || !hb.length) return null;
  const h = hb.find(x => x.id === handleId) || hb[0];
  return { x: n.position.x + h.x + h.width / 2, y: n.position.y + h.y + h.height / 2, pos: String(h.position) };
}
// ConnectionState 的指针字段名是 `pointer`(不是 pointerPos)——读错即连线静默失效(PoC 坑③实录)
function drawConn(st: FlowConnState): void {
  const from = st.fromHandle && handlePoint(st.fromHandle.nodeId, st.fromHandle.id, st.fromHandle.type);
  if (!from) return;
  const to = st.toHandle ? handlePoint(st.toHandle.nodeId, st.toHandle.id, st.toHandle.type) : null;
  const dst = to || { x: st.pointer?.x ?? 0, y: st.pointer?.y ?? 0, pos: 'left' };
  const [d] = xy().getBezierPath({ sourceX: from.x, sourceY: from.y, sourcePosition: from.pos, targetX: dst.x, targetY: dst.y, targetPosition: dst.pos });
  fConnEl().setAttribute('d', d);
}
function renderEdges(): void {
  const svg = fSvg();
  svg.querySelectorAll('path.e').forEach(p => p.remove());
  for (const e of FS.edges) {
    const a = handlePoint(e.source, e.sourceHandle || 'out', 'source'), b = handlePoint(e.target, e.targetHandle || 'in', 'target');
    if (!a || !b) continue;
    const [d] = xy().getBezierPath({ sourceX: a.x, sourceY: a.y, sourcePosition: a.pos, targetX: b.x, targetY: b.y, targetPosition: b.pos });
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); p.setAttribute('class', 'e'); p.setAttribute('data-eid', e.id);
    p.addEventListener('click', () => { FS.edges = FS.edges.filter(x => x.id !== e.id); flowRender(); });
    svg.appendChild(p);
  }
}

// ── 增删 ──
function flowAddNode(type: FlowKind, pos: FlowPos): string {
  if (type !== 'agent' && FS.nodes.some(n => n.type === type)) { flowErr(T('每类起止节点各一个(%1 已存在)', type)); return ''; }
  const id = 'n' + (FS.next++);
  const data: FlowNodeData = type === 'agent' ? { label: T('步骤') + id, phase: '', prompt: '', model: '', schemaText: '' }
    : type === 'start' ? { note: '' } : { ret: '' };
  FS.nodes.push({ id, type, position: { x: pos.x, y: pos.y }, data });
  flowRender();
  return id;
}
function flowRemoveNode(id: string): void {
  FS.nodes = FS.nodes.filter(n => n.id !== id);
  FS.edges = FS.edges.filter(e => e.source !== id && e.target !== id);
  FS.sel.delete(id);
  flowRender();
}
function flowCenter(): FlowPos {
  const p = fPane();
  return { x: (p.clientWidth / 2 - FS.view.x) / FS.view.zoom - 125, y: (p.clientHeight / 2 - FS.view.y) / FS.view.zoom - 40 };
}

// ── 脚本预览 + 校验(铁律 7:错误清单不裁,定高滚动)──
function refreshFlowScript(): void {
  const out = $<HTMLElement>('fScript'), d = flowDraft(), errs = flowValidate(d);
  if (errs.length) {
    out.textContent = '// ' + T('存在错误,无法生成');
    flowErr(T('存在错误,无法生成') + '\n· ' + errs.join('\n· '));
    return;
  }
  try { out.textContent = flowGenerate(d); flowErr(''); }
  catch (e) { out.textContent = '// ' + T('存在错误,无法生成'); flowErr(String((e as Error)?.message ?? e)); }
}
function flowDraft(): FlowDraft {
  return { v: 1, name: FS.name.trim() || 'untitled', desc: FS.desc, cwd: FS.cwd, nodes: FS.nodes, edges: FS.edges, next: FS.next, view: FS.view };
}

// ── 持久化:localStorage 防误关(按项目 slug)+ 显式保存到后端(CONF_DIR/drafts,铁律 2)──
function autosaveFlow(): void {
  try { localStorage.setItem(FLOW_LS + flowSlug(), JSON.stringify(flowDraft())); } catch { /* 隐私模式/超额:静默,显式保存不受影响 */ }
}
function autosavePeek(cwd: string): FlowDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(FLOW_LS + (cwd || '__no_cwd__')) || 'null');
    return d && Array.isArray(d.nodes) && d.nodes.length ? d as FlowDraft : null;
  } catch { return null; }
}
function flowApply(d: FlowDraft): void {
  FS.name = String(d.name || ''); FS.desc = String(d.desc || ''); FS.cwd = String(d.cwd || '');
  FS.nodes = (d.nodes || []).map(n => ({ id: String(n.id), type: n.type, position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 }, data: { ...n.data } }));
  FS.edges = (d.edges || []).map(e => ({ id: String(e.id), source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target, targetHandle: e.targetHandle ?? null }));
  // 发号器只前进不回退:存盘 next 与现存 id 尾号取大 +1(重号会让 vendor 的 data-id 反查串节点)
  FS.next = Math.max(Number(d.next) || 0, ...FS.nodes.map(n => tailNum(n.id)), ...FS.edges.map(e => tailNum(e.id))) + 1;
  if (d.view && typeof d.view.zoom === 'number') FS.view = { x: Number(d.view.x) || 0, y: Number(d.view.y) || 0, zoom: Number(d.view.zoom) || 1 };
  FS.sel.clear();
}
async function saveFlowDraft(overwrite: boolean): Promise<void> {
  const d = flowDraft(), errs = flowValidate(d);
  if (errs.length) { flowErr(T('存在错误,无法生成') + '\n· ' + errs.join('\n· ')); flowNote(T('先修复生成错误'), false); return; }
  flowNote(T('保存中…'), true);
  let r: DraftSaveResp;
  try {
    r = await (await fetch('/api/draft/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FS.name.trim(), draft: d, script: flowGenerate(d), overwrite }) })).json() as DraftSaveResp;
  } catch (e) { flowNote(T('保存失败:%1', String((e as Error)?.message ?? e)), false); return; }
  if (!r.ok) { flowNote(T('保存失败:%1', String(r.msg || '')), false); return; }
  const alt = String(r.path || '').split('/').pop() || '';
  const conflicted = alt !== FS.name.trim() + '.js';
  flowNote(conflicted ? T('已并存为 %1(同名草稿内容不同)', alt) : T('已保存: %1', String(r.path)), true);
  const box = $<HTMLElement>('fRun');
  if (box) {
    box.hidden = false;
    $<HTMLElement>('fRunCmd').textContent = `Workflow({ scriptPath: '${String(r.path)}', args: '<输入>' })`;
  }
  $<HTMLElement>('fOver').hidden = !conflicted;                  // 冲突时才给「覆盖原稿」入口(默认宁并存不覆盖)
  try { localStorage.removeItem(FLOW_LS + flowSlug()); } catch { /* 无键则已 */ }
  void loadFlowDrafts(FS.cwd);
}
// 草稿下拉的唯一渲染点(列表数据 + 语言)。setLang 之后必须重刷:动态拼出来的 <option> 不在
// applyI18n 的 data-i18n 覆盖范围内,漏刷则该语言下留旧语言文案(与清 CARDS 同一类问题)。
function renderDraftOptions(): void {
  const sel = $<HTMLSelectElement>('fDraft');
  if (!sel) return;
  sel.innerHTML = `<option value="">${esc(T('载入草稿…'))}</option>` +
    fDrafts.map(x => `<option value="${esc(x.name)}">${esc(String(x.meta?.name || x.name))}</option>`).join('');
}
async function loadFlowDrafts(cwd: string): Promise<void> {
  const sel = $<HTMLSelectElement>('fDraft');
  try { fDrafts = ((await (await fetch('/api/drafts?proj=' + encodeURIComponent(cwd || ''))).json() as DraftsResp).drafts) || []; }
  catch { fDrafts = []; flowNote(T('草稿列表读取失败'), false); }
  if (!sel) return;
  renderDraftOptions();
  sel.onchange = () => {
    const hit = fDrafts.find(x => x.name === sel.value); if (!hit) return;
    const j = hit.draft as FlowDraft;
    if (!j || j.v !== 1) { flowNote(T('未知草稿版本,不猜'), false); return; }   // 只增不改义:遇未知版本提示而非猜测读取
    flowApply(j); syncHeadInputs(); sel.value = '';
    fpz?.setViewport(FS.view);
    flowRender(); flowNote(T('草稿已载入: %1', String(hit.meta?.name || hit.name)), true);
  };
}

// ── 画布初始化:C8 = 六个回调全传(vendor 对 onDraggingChange/onTransformChange 无空值防护,缺则 "o is not a function")──
function initFlowCanvas(): void {
  if (fpz) return;
  const NOOP = (): void => {};
  fpz = xy().XYPanZoom({
    domNode: fPane(), minZoom: FLOW_MIN_Z, maxZoom: FLOW_MAX_Z, translateExtent: FLOW_EXTENT, viewport: { ...FS.view },
    onPanZoomStart: NOOP, onPanZoomEnd: safely('onPanZoomEnd', () => autosaveFlow()), onDraggingChange: NOOP,
    onPanZoom: (_ev: Event | null, vp: FlowView) => {
      FS.view = { x: vp.x, y: vp.y, zoom: vp.zoom };
      // handleBounds 是节点内相对坐标(缩放不变),边与节点同在 viewport 层 → 变换零重绘,只动一个 style
      fVp().style.transform = `translate(${vp.x}px,${vp.y}px) scale(${vp.zoom})`;
    },
  });
  fpz.update({
    panOnDrag: true, zoomOnScroll: true, zoomOnPinch: true, zoomOnDoubleClick: false, panOnScroll: false,
    preventScrolling: true, noPanClassName: 'nopan', noWheelClassName: 'nowheel', lib: FLOW_LIB,
    onTransformChange: NOOP, onPaneContextMenu: undefined, userSelectionActive: false,
  });
}
function fitFlowView(): void {
  if (!fpz) return;
  const ns = FS.nodes.filter(n => n.measured && n.measured.width);
  if (!ns.length) { void fpz.setViewport({ x: 20, y: 10, zoom: 1 }, { duration: 200 }); return; }
  const pane = fPane();
  const minX = Math.min(...ns.map(n => n.position.x)), maxX = Math.max(...ns.map(n => n.position.x + (n.measured?.width || 0)));
  const minY = Math.min(...ns.map(n => n.position.y)), maxY = Math.max(...ns.map(n => n.position.y + (n.measured?.height || 0)));
  const z = Math.min(FLOW_MAX_Z, pane.clientWidth / (maxX - minX + 80), pane.clientHeight / (maxY - minY + 80));
  if (!isFinite(z) || z <= 0) return;                            // 无头桩/隐藏容器给不出尺寸:不动视口,别写 NaN
  void fpz.setViewport({ x: (pane.clientWidth - (maxX - minX) * z) / 2 - minX * z, y: (pane.clientHeight - (maxY - minY) * z) / 2 - minY * z, zoom: z }, { duration: 200 });
}

// ── 入口 / 出口 ──
async function openFlow(cwd: string): Promise<void> {
  const root = $<HTMLElement>('flow');
  root.hidden = false; flowVisible = true;
  document.body.classList.add('flow-open');
  if (!flowWired) { wireShell(); flowWired = true; }
  initFlowCanvas();
  FS.cwd = cwd || '';
  $<HTMLElement>('fCwd').textContent = cwd || T('(未选项目)');
  $<HTMLElement>('fRun').hidden = true;
  $<HTMLElement>('fOver').hidden = true;
  flowErr('');
  await loadFlowDrafts(FS.cwd);
  const saved = autosavePeek(FS.cwd);
  if (saved) {
    // 上次未显式保存的编辑:先问再恢复(不静默覆盖用户刚存的版本),拒绝则回到"有草稿载入/无草稿示例"的正常态
    if (confirm(T('恢复上次未保存的编辑?'))) { flowApply(saved); }
    else { if (fDrafts.length) flowBlank(); else flowSeedDemo(); }
  } else if (!fDrafts.length) flowSeedDemo();
  else flowBlank();
  syncHeadInputs();
  flowRender();
  void fpz?.setViewport(FS.view);
  nextFrame(() => { flowRender(); fitFlowView(); });     // 二次测量(字体/布局稳定后)+ 适配视图
}
function flowBlank(): void {
  FS = { name: '', desc: '', cwd: FS.cwd, nodes: [], edges: [], next: 1, sel: new Set(), view: { x: 20, y: 10, zoom: 1 } };
}
function syncHeadInputs(): void {
  $<HTMLInputElement>('fName').value = FS.name;
  $<HTMLInputElement>('fDesc').value = FS.desc;
}
function closeFlow(): void {
  $<HTMLElement>('flow').hidden = true; flowVisible = false;
  document.body.classList.remove('flow-open');
}
// 首次编排的起手图(三角拆解 → 并行检索 → 交叉验证):可整图清空,也是 §8.5 真机冒烟的固定起点
function flowSeedDemo(): void {
  flowBlank();
  FS.name = 'demo-research'; FS.desc = T('三角拆解 → 并行检索 → 交叉验证');
  const N = (type: FlowKind, x: number, y: number, data: FlowNodeData): string => {
    const id = 'n' + (FS.next++); FS.nodes.push({ id, type, position: { x, y }, data }); return id;
  };
  const E = (a: string, b: string): void => { FS.edges.push({ id: 'e' + (FS.next++), source: a, sourceHandle: 'out', target: b, targetHandle: 'in' }); };
  const s = N('start', 40, 170, { note: T('调研选题') });
  const a = N('agent', 290, 165, { label: T('拆解'), phase: 'Scope', prompt: `把选题 {{${s}}} 拆成 3 个互补的调研角度,每角度一行。`, model: '', schemaText: '' });
  const b1 = N('agent', 560, 40, { label: T('检索A'), phase: 'Search', prompt: `角度1:{{${a}}} —— 检索并汇总要点。`, model: '', schemaText: '' });
  const b2 = N('agent', 560, 180, { label: T('检索B'), phase: 'Search', prompt: `角度2:{{${a}}} —— 检索并汇总要点。`, model: '', schemaText: '' });
  const b3 = N('agent', 560, 320, { label: T('检索C'), phase: 'Search', prompt: `角度3:{{${a}}} —— 检索并汇总要点。`, model: '', schemaText: '' });
  const v = N('agent', 830, 165, { label: T('交叉验证'), phase: 'Verify', prompt: `对 {{${b1}}} / {{${b2}}} / {{${b3}}} 交叉核对,标注矛盾点。`, model: '', schemaText: '' });
  const r = N('return', 1100, 180, { ret: `{ report: ${v}, angles: [${b1}, ${b2}, ${b3}] }` });
  E(s, a); E(a, b1); E(a, b2); E(a, b3); E(b1, v); E(b2, v); E(b3, v); E(v, r);
}
// 静态壳的事件接线(只连一次;#flow 在 template 里,不进 diffPaint 池)
function wireShell(): void {
  $<HTMLElement>('fClose').onclick = closeFlow;
  $<HTMLElement>('fSave').onclick = () => void saveFlowDraft(false);
  $<HTMLElement>('fOver').onclick = () => void saveFlowDraft(true);
  $<HTMLElement>('fFit').onclick = fitFlowView;
  $<HTMLElement>('fClear').onclick = () => {
    if (!confirm(T('清空画布?'))) return;
    FS.nodes = []; FS.edges = []; FS.sel.clear(); FS.next = 1; flowRender();
  };
  $<HTMLElement>('fCopy').onclick = () => { void copyText($<HTMLElement>('fScript').textContent || '', T('脚本已复制')); };
  $<HTMLElement>('fCopyCmd').onclick = () => { void copyText($<HTMLElement>('fRunCmd').textContent || '', T('命令已复制')); };
  $<HTMLInputElement>('fName').oninput = e => { FS.name = (e.target as HTMLInputElement).value; refreshFlowScript(); autosaveFlow(); };
  $<HTMLInputElement>('fDesc').oninput = e => { FS.desc = (e.target as HTMLInputElement).value; refreshFlowScript(); autosaveFlow(); };
  document.querySelectorAll<HTMLElement>('#fPalette .pal').forEach(p => {
    p.addEventListener('click', () => flowAddNode((p.dataset.t || 'agent') as FlowKind, flowCenter()));
    p.addEventListener('dragstart', e => (e as DragEvent).dataTransfer?.setData('text/plain', String(p.dataset.t || '')));
  });
  const pane = fPane();
  pane.addEventListener('dragover', e => e.preventDefault());
  pane.addEventListener('drop', e => {
    e.preventDefault();
    const t = (e as DragEvent).dataTransfer?.getData('text/plain'); if (!t) return;
    const r = pane.getBoundingClientRect(), v = FS.view;
    flowAddNode(t as FlowKind, { x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom });
  });
  document.addEventListener('keydown', flowKeydown);
}
// 键位:Del/Backspace 删选中(焦点在输入控件时忽略)、Cmd/Ctrl+S 保存、Esc 关闭
function flowKeydown(e: KeyboardEvent): void {
  if (!flowVisible) return;
  const k = String(e.key || '');
  if ((k === 'Delete' || k === 'Backspace') && FS.sel.size && !isInputNode(document.activeElement)) {
    e.preventDefault(); [...FS.sel].forEach(id => flowRemoveNode(id)); FS.sel.clear(); flowRender();
  }
  if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 's') { e.preventDefault(); void saveFlowDraft(false); }
  if (k === 'Escape') closeFlow();
}
function isInputNode(el: Element | null): boolean {
  return !!el && /INPUT|TEXTAREA|SELECT/.test(String((el as HTMLElement).tagName));
}
async function copyText(txt: string, okMsg: string): Promise<void> {
  try { await navigator.clipboard.writeText(txt); flowNote(okMsg, true); }
  catch { flowNote(T('复制失败(请手动选中文本)'), false); }      // http/权限受限时不假装成功:文本本就可手动选
}
function nextFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);                                       // 无头桩无 rAF:退化为定时器,不阻断首帧测量
}
// setLang() 调用:编辑器里"动态拼出来"的文案全部重绘(静态壳由 applyI18n 覆盖)。
// 三处非 data-i18n 的死角:草稿下拉的 <option>、校验/状态行、节点卡(卡内 label/提示文字走 T())。
// 状态行是一次性提示(已保存/保存中…),换语言后留着旧语言的它比清掉更容易误导 → 清空。
function flowRelang(): void {
  if (!$<HTMLElement>('flow')) return;
  $<HTMLElement>('fCwd').textContent = FS.cwd || T('(未选项目)');
  renderDraftOptions();
  flowNote('', true);
  flowRender();                                             // 内部会重跑 refreshFlowScript(错误清单同语言)
}
$<HTMLElement>('btnFlow').onclick = () => { void openFlow(fproj || (sess.length ? sess[0].cwd : '') || ''); };

// ── ?flowsmoke=1 真机自检(§8.5):合成事件跑通 连线 / 拖节点 / 滚轮缩放 三类真实交互,结论写进 document.title ──
// 为什么留在生产代码里:C3/C4/C5(吸附、connectable 类、data-id 反查)与拖拽阈值、缩放依赖**真实布局**——
// 无头桩给不出 getBoundingClientRect/elementFromPoint,只有浏览器能实证;坏了由冒烟命令拦下(不进日常路径)。
function flowSmoke(): void {
  const res: string[] = [];
  const check = (name: string, cond: boolean): boolean => { res.push((cond ? '✓' : '✗') + name); return cond; };
  // 虚拟时间下 rAF 可能不驱动(PoC 实录)→ 一律用 setTimeout 驱动
  const frames = (n = 1): Promise<void> => n <= 0 ? Promise.resolve() : new Promise<void>(r => setTimeout(() => { void r(frames(n - 1)); }, 8));
  // C9:d3 从 event.view 取 window,合成事件默认 view=null → 监听器根本不启动
  const fire = (el: EventTarget, type: string, x: number, y: number, extra?: Record<string, unknown>): void => {
    const Ctor = type === 'wheel' ? WheelEvent : type.indexOf('pointer') === 0 ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, Object.assign({
      view: window, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0,
      buttons: type === 'mouseup' ? 0 : 1, deltaY: 0,
    }, extra || {})));
  };
  void (async () => {
    try {
      document.title = 'SMOKE running';
      await openFlow('/smoke-proj');
      // 固定四节点链(不受既有草稿/自动存影响;横向 ~1030px,保证 1600×1000 视口内 elementFromPoint 拿得到 ——
      // 用 7 卡起手图 + 自适应缩放会把 handle 推到窗口外,正是 PoC 800×600 那个假失败)
      flowBlank(); FS.name = 'flow-smoke'; FS.cwd = '/smoke-proj';
      const sm = (type: FlowKind, x: number, y: number, data: FlowNodeData): string => {
        const id = 'n' + (FS.next++); FS.nodes.push({ id, type, position: { x, y }, data }); return id;
      };
      const sN = sm('start', 60, 150, { note: 'q' }), aN = sm('agent', 300, 150, { label: 'A', phase: 'P', prompt: 'a {{n1}}' });
      const bN = sm('agent', 540, 150, { label: 'B', phase: 'P', prompt: 'b {{n2}}' }), rN = sm('return', 780, 150, { ret: '' });
      FS.edges.push({ id: 'e' + (FS.next++), source: sN, sourceHandle: 'out', target: aN, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: aN, sourceHandle: 'out', target: bN, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: bN, sourceHandle: 'out', target: rN, targetHandle: 'in' });
      flowRender();
      await frames(40);
      const n2 = fNodeEl(aN), n4 = fNodeEl(rN);
      check('nodes', FS.nodes.length === 4 && !!n2 && !!n4);
      const src = n2 && n2.querySelector('.lucid-flow__handle.source');
      const dst = n4 && n4.querySelector('.lucid-flow__handle.target');
      check('contract-C3C4C5', !!src && !!dst
        && /connectable connectableend/.test(String(src.getAttribute('class')))
        && src.getAttribute('data-id') === 'lwf-n2-out-source' && dst.getAttribute('data-id') === 'lwf-n4-in-target');
      const e0 = FS.edges.length;
      fDbg = { connect: 0, cancel: 0, start: 0 };
      if (src && dst) {
        const sp = src.getBoundingClientRect(), dp = dst.getBoundingClientRect();
        fire(src, 'pointerdown', sp.x + 5, sp.y + 5);
        await frames(2); fire(document, 'mousemove', (sp.x + dp.x) / 2, (sp.y + dp.y) / 2 + 20);
        await frames(2); const dmid = fConnEl().getAttribute('d');
        await frames(2); fire(document, 'mousemove', dp.x + 5, dp.y + 5);
        await frames(2); fire(document, 'mouseup', dp.x + 5, dp.y + 5);
        await frames(6);
        const okc = FS.edges.length === e0 + 1 && FS.edges.some(e => e.source === 'n2' && e.target === 'n4');
        if (!okc) {   // 失败时把 vendor 侧证据带进 title(onConnect 是否被调 / isValid 判成什么 / 命中元素是谁)
          const evP = new MouseEvent('mousemove', { view: window, clientX: dp.x + 5, clientY: dp.y + 5 });
          let probe = 'ERR';
          try {
            const r = xy().XYHandle.isValid(evP, { handle: null, connectionMode: 'loose', fromNodeId: 'n2',
              fromHandleId: 'out', fromType: 'source', doc: document, lib: FLOW_LIB, flowId: FLOW_ID, nodeLookup: flookup });
            probe = JSON.stringify({ v: r.isValid, c: r.connection, hh: !!r.handleDomNode });
          } catch (e) { probe = 'EX:' + String((e as Error).message).slice(0, 24); }
          const hit = document.elementFromPoint(dp.x + 5, dp.y + 5);
          res.push('[dbg c=' + fDbg.connect + ' x=' + fDbg.cancel + ' s=' + fDbg.start
            + ' z=' + FS.view.zoom.toFixed(2) + ' hit=' + String((hit && (hit.getAttribute('class') || hit.tagName)) || 'NULL').slice(0, 22)
            + ' dp=' + Math.round(dp.x) + ',' + Math.round(dp.y) + ' ' + probe + ']');
        }
        check('connect+1', okc);
        check('connPath-drawn', !!dmid);
        check('connPath-cleared', !fConnEl().getAttribute('d'));
      } else { res.push('✗connect(no-handle)'); }
      fDbg = null;
      const n3 = fNodeEl(bN);                              // 拖 n3(不与刚连的 n2→n4 端点混在一起)
      if (n3) {
        const p0 = { ...FS.nodes.find(n => n.id === bN)!.position }, r0 = n3.getBoundingClientRect();
        fire(n3, 'mousedown', r0.x + 20, r0.y + 8);
        for (const k of [4, 10, 16, 22]) { fire(window, 'mousemove', r0.x + 20 + k, r0.y + 8 + k / 2); await frames(3); }
        fire(window, 'mouseup', r0.x + 42, r0.y + 19); await frames(6);
        const p1 = FS.nodes.find(n => n.id === bN)!.position;
        check('drag-move', Math.abs(p1.x - p0.x - 22) < 6 && Math.abs(p1.y - p0.y - 11) < 6);
      } else { res.push('✗drag(no-node)'); }
      const z0 = FS.view.zoom;
      fire(fPane(), 'wheel', 300, 300, { deltaY: -240 });
      await frames(10);
      check('zoom', FS.view.zoom !== z0 && /scale\(/.test(String(fVp().style.transform)));
      refreshFlowScript();
      check('gen', /export const meta/.test($<HTMLElement>('fScript').textContent || '') && $<HTMLElement>('fErr').hidden);
      document.title = 'SMOKE ' + (res.every(r => r[0] === '✓') ? 'OK ' : 'FAIL ') + res.join(' ');
    } catch (e) {
      document.title = 'SMOKE CRASH ' + String((e as Error)?.message ?? e) + ' ' + res.join(' ');
    }
  })();
}
if (typeof location !== 'undefined' && String(location.href || '').indexOf('flowsmoke') >= 0) flowSmoke();
