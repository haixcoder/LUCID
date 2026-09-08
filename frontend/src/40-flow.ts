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
const FLOW_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];   // agent(opts.effort) 五档(官方技能)

interface FlowStore { name: string; desc: string; cwd: string; whenToUse: string; phases: FlowPhase[]; argsSpec: FlowArgsSpec; nodes: FlowNode[]; edges: FlowEdge[]; next: number; sel: Set<string>; view: FlowView }
let FS: FlowStore = { name: '', desc: '', cwd: '', whenToUse: '', phases: [], argsSpec: { schemaText: '', exampleText: '', required: false }, nodes: [], edges: [], next: 1, sel: new Set(), view: { x: 20, y: 10, zoom: 1 } };
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
// hid/pos 可覆盖(1.2.54:branch 的 true/false 双出把、merge 的双入把);默认仍是 out/right 与 in/left。
// data-id 拼法**不变**(`${flowId}-${nodeId}-${handleId}-${type}`)——新增 handle 只增加 handleId 取值(AD-2)。
function handleHTML(n: FlowNode, type: 'source' | 'target', hid?: string, pos?: string): string {
  const id = hid || (type === 'source' ? 'out' : 'in'), position = pos || (type === 'source' ? 'right' : 'left');
  // connectable + connectableend = isConnectable 的隐藏契约:缺任一 → isValid 恒 false → 连线静默失效(C4)
  return `<div class="${FLOW_LIB}-flow__handle ${type}${hid ? ' h-' + hid : ''} nodrag connectable connectableend" data-handleid="${id}"` +
    ` data-handlepos="${position}" data-nodeid="${n.id}" data-id="${FLOW_ID}-${n.id}-${id}-${type}" title="${type}"></div>`;
}
function nodeHTML(n: FlowNode): string {
  const d = n.data, t = n.type;
  const label = t === 'agent' ? 'AGENT' : t === 'map' ? 'MAP' : t === 'branch' ? 'BRANCH' : t === 'loop' ? 'LOOP' : t === 'log' ? 'LOG' : t === 'code' ? 'CODE' : t === 'subflow' ? 'SUBFLOW' : t === 'merge' ? 'MERGE' : t === 'start' ? 'START' : 'RETURN';
  let fields = '';
  if (t === 'start') fields = `<label>${T('说明(生成 args 入口)')}</label><input class="nodrag f-note" value="${esc(d.note || '')}" placeholder="${esc(T('如:调研选题'))}">`;
  if (t === 'agent') fields =
    `<label>${T('label / phase')}</label><div class="frow"><input class="nodrag f-label" value="${esc(d.label || '')}" placeholder="label"><input class="nodrag f-phase" value="${esc(d.phase || '')}" placeholder="phase"></div>` +
    `<label>${T('prompt(可引用 {{nX}})')}</label><textarea class="nodrag f-prompt" rows="3">${esc(d.prompt || '')}</textarea>` +
    `<label>${T('model / schema(可空)')}</label><div class="frow"><select class="nodrag f-model"><option value="">inherit</option>${FLOW_MODELS.map(m => `<option${d.model === m ? ' selected' : ''}>${m}</option>`).join('')}</select><textarea class="nodrag f-schema" rows="1" placeholder="{JSON Schema}">${esc(d.schemaText || '')}</textarea></div>` +
    `<label>${T('effort / agentType(可空)')}</label><div class="frow"><select class="nodrag f-effort"><option value="">inherit</option>${FLOW_EFFORTS.map(e => `<option${d.effort === e ? ' selected' : ''}>${e}</option>`).join('')}</select><input class="nodrag f-atype" list="fATypes" value="${esc(d.agentType || '')}" placeholder="agentType"></div>` +
    `<label>${T('retry(n / 退避 ms;0 = 不重试)')}</label><div class="frow"><input class="nodrag f-rn" type="number" min="0" value="${esc(String(d.retryN === undefined || d.retryN === '' ? 0 : d.retryN))}"><input class="nodrag f-rms" type="number" min="0" value="${esc(String(d.retryMs === undefined || d.retryMs === '' ? 1000 : d.retryMs))}"></div>` +
    `<label class="ck"><input type="checkbox" class="nodrag f-iso"${d.isolation ? ' checked' : ''}><span>${T('isolation:worktree(贵;仅并行改文件时用)')}</span></label>`;
  if (t === 'map') fields =
    `<label>${T('label / phase')}</label><div class="frow"><input class="nodrag f-label" value="${esc(d.label || '')}" placeholder="label"><input class="nodrag f-phase" value="${esc(d.phase || '')}" placeholder="phase"></div>` +
    `<label>${T('items 表达式(如 ARGS.paths)')}</label><input class="nodrag f-items" value="${esc(d.items || '')}" placeholder="ARGS.paths">` +
    `<label>${T('回调模板({{item}} / {{index}})')}</label><textarea class="nodrag f-prompt" rows="2">${esc(d.prompt || '')}</textarea>` +
    `<div class="fnote">${T('下游每级 = pipeline 的一级(逐条目、无栅栏);要汇总请用汇合点之后的节点')}</div>`;
  if (t === 'branch') fields =
    `<label>${T('label')}</label><input class="nodrag f-label" value="${esc(d.label || '')}" placeholder="label">` +
    `<label>${T('条件表达式')}</label><input class="nodrag f-cond" value="${esc(d.cond || '')}" placeholder="n2.length === 0">` +
    `<div class="fnote">${T('true / false 各接一条分支,必须汇于同一个 merge(或同一个 return)')}</div>`;
  if (t === 'loop') fields =
    `<label>${T('label')}</label><input class="nodrag f-label" value="${esc(d.label || '')}" placeholder="label">` +
    `<label>${T('条件表达式')}</label><input class="nodrag f-cond" value="${esc(d.cond || '')}" placeholder="dry < 2">` +
    `<label>${T('循环上界 maxRounds')}</label><input class="nodrag f-rounds" type="number" min="1" value="${esc(String(d.maxRounds === undefined || d.maxRounds === '' ? 1 : d.maxRounds))}">` +
    `<label class="ck"><input type="checkbox" class="nodrag f-guard"${d.budgetGuard ? ' checked' : ''}><span>${T('预算守卫(剩余不足时提前收束)')}</span></label>` +
    `<div class="fnote">${T('循环体:body 出把接进去,体末连回本节点;out 接循环之后的步骤')}</div>`;
  if (t === 'log') fields = `<label>${T('log 文本(可引用 {{nX}})')}</label><textarea class="nodrag f-text" rows="2">${esc(d.text || '')}</textarea>`;
  if (t === 'code') fields =
    `<div class="codehint">⚠ ${T('此段不参与可视化语义(CODE 逃生舱),沙箱内执行、返回值绑定本节点')}</div>` +
    `<textarea class="nodrag f-code" rows="5" spellcheck="false" placeholder="const seen = new Set(); return found.filter(x => !seen.has(x))">${esc(d.code || '')}</textarea>`;
  if (t === 'subflow') fields =
    `<label>${T('引用的工作流(ref)')}</label><input class="nodrag f-ref" list="fDraftRefs" value="${esc(d.ref || '')}" placeholder="${esc(T('已保存的名字或 /abs/x.js'))}">` +
    `<label>${T('参数表达式(args,可空)')}</label><input class="nodrag f-args" value="${esc(d.argsExpr || '')}" placeholder="{ issues: ARGS.ids }">` +
    `<div class="fnote">${T('子流只允许一层:被引用的工作流里不能再有 subflow')}</div>`;
  if (t === 'merge') fields = `<div class="fnote">${T('汇合点:扇出/分支在此收束,自身不执行')}</div>`;
  if (t === 'return') fields = `<label>${T('return 表达式')}</label><textarea class="nodrag f-ret" rows="2">${esc(d.ret || '')}</textarea>`;
  // 徽章 = 脚本里的变量名:下游 prompt 要敲的 {{nX}} 就是它(结构即信息,不是装饰)
  const sub = (t === 'agent' || t === 'map' || t === 'branch' || t === 'loop') && d.label ? `<span>${esc(d.label)}</span>` : '';
  const hs = t === 'branch' ? handleHTML(n, 'target') + handleHTML(n, 'source', 'true', 'right') + handleHTML(n, 'source', 'false', 'right')
    : t === 'loop' ? handleHTML(n, 'target') + handleHTML(n, 'source', 'body', 'right') + handleHTML(n, 'source', 'out', 'right')
    : t === 'merge' ? handleHTML(n, 'target', 'in', 'left') + handleHTML(n, 'target', 'in2', 'left') + handleHTML(n, 'source')
    : (t !== 'start' ? handleHTML(n, 'target') : '') + (t !== 'return' ? handleHTML(n, 'source') : '');
  return `<div class="wfnode t-${t} ${FLOW_LIB}-flow__node nopan${FS.sel.has(n.id) ? ' sel' : ''}" data-nodeid="${n.id}" style="left:${n.position.x}px;top:${n.position.y}px">` +
    `<div class="hd"><b>${label}</b><i>${n.id}</i>${sub}<span class="tag nodrag" title="${T('删除节点')}">✕</span></div>${fields}` + hs + `</div>`;
}
function fNodeEl(id: string): HTMLElement | null {
  return fVp().querySelector<HTMLElement>(`.wfnode[data-nodeid="${id}"]`);
}
// 坐标系换算**唯一实现**:屏幕(pane 相对像素)→ 流坐标。
// 为什么必须有它:节点/边/临时虚线都住 #fViewport,而 #fViewport 被 translate+scale 变换过 —— 只有
// **流坐标**能在里面直接画;凡是从"鼠标/元素"来的像素(vendor 的 connection.pointer、拖放落点、pane 中心)
// 都得先过这里。实测漏换算的后果(1.2.46,真实反馈「选中节点连线时虚线会漂移」):虚线自由端比光标偏
// 一个 (view.x + px·(zoom-1), view.y + py·(zoom-1)) —— 平移多少偏多少,缩放越大偏得越狠。
function paneToFlow(x: number, y: number): FlowPos {
  const v = FS.view;
  return { x: (x - v.x) / v.zoom, y: (y - v.y) / v.zoom };
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
// 把**派生缓存**刷成真值:lookup 是喂给 vendor 的缓存,FS.nodes 才是唯一真相。
// ⚠ adoptUserNodes 默认 checkEquality=true —— 节点对象**引用没变**就沿用旧 internals;而 applyDrag 是
// 原地改 n.position(不做不可变更新),于是 positionAbsolute 会停在上一次拖拽前的值。vendor 的拖拽基线
// (distance = 指针 − positionAbsolute)与最近 handle 搜索都读它,后果是"拖过一次后再拖,节点跳回上一次的
// 位移量"(1.2.49 真实反馈「拖拽节点会漂移」;第二次拖拽的净位移被跳变抵消,看起来像拖不动)。
// nodeOrigin=[0,0] 且无父节点 ⇒ positionAbsolute 恒等于 position。**新增派生字段先想它要不要在这里刷。**
function syncLookup(): void {
  xy().adoptUserNodes(FS.nodes, flookup, fparents, { nodeOrigin: [0, 0], nodeExtent: FLOW_EXTENT });
  for (const n of FS.nodes) {
    const it = flookup.get(n.id); if (!it) continue;
    if (fbounds.has(n.id)) it.internals.handleBounds = fbounds.get(n.id);
    it.internals.positionAbsolute = { x: n.position.x, y: n.position.y };
  }
}
function flowRender(): void {
  if (!flowWired) return;                                 // 未打开时不碰 DOM(编辑器元素虽在壳里,但画布尚未初始化)
  for (const i of fdrag.values()) i.destroy();
  fdrag.clear();
  fVp().querySelectorAll('.wfnode').forEach(el => el.remove());
  fVp().insertAdjacentHTML('beforeend', FS.nodes.map(nodeHTML).join(''));
  const empty = $<HTMLElement>('fEmpty');
  if (empty) empty.hidden = FS.nodes.length > 0;      // 空画布给一条"从哪儿开始",不留白
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
        (n.data as Record<string, unknown>)[key] = f.value;   // maxRounds 存原文(number|string 联合),解析在校验器一处
        if (key === 'label') { const sp = el.querySelector('.hd span'); if (sp) sp.textContent = String(n.data.label || ''); }
        refreshFlowScript(); autosaveFlow();
      });
    };
    bind('.f-label', 'label'); bind('.f-phase', 'phase'); bind('.f-prompt', 'prompt');
    bind('.f-model', 'model'); bind('.f-schema', 'schemaText'); bind('.f-ret', 'ret'); bind('.f-note', 'note');
    bind('.f-items', 'items'); bind('.f-cond', 'cond'); bind('.f-rounds', 'maxRounds');
    bind('.f-effort', 'effort'); bind('.f-atype', 'agentType'); bind('.f-rn', 'retryN'); bind('.f-rms', 'retryMs'); bind('.f-text', 'text');
    bind('.f-code', 'code'); bind('.f-ref', 'ref'); bind('.f-args', 'argsExpr');
    const iso = el.querySelector<HTMLInputElement>('.f-iso');
    if (iso) iso.addEventListener('change', () => { n.data.isolation = iso.checked; refreshFlowScript(); autosaveFlow(); });
    const guard = el.querySelector<HTMLInputElement>('.f-guard');
    if (guard) guard.addEventListener('change', () => { n.data.budgetGuard = guard.checked; refreshFlowScript(); autosaveFlow(); });
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
// ⚠ 这里**绝不许** ev.preventDefault():取消 pointerdown 会让浏览器不再派发兼容鼠标事件
// (mousedown/mousemove/mouseup,Chrome 实测),而 vendor 的拖拽全靠 document 上的 mousemove/mouseup ——
// 症状是拖拽期间零回调、松手不收尾,松手后一动鼠标手势才"迟到地"开始并跟着光标跑(1.2.47 真实反馈
// 「连线没有结束」)。防选中改由 CSS 承担(#fPane user-select:none,表单控件再放行),不碰事件默认行为。
function startConnect(ev: PointerEvent, handleDomNode: Element, nodeId: string, isTarget: boolean): void {
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
  // 两个终点分支的坐标系不同,别混:悬停到 handle → 我们自己的流坐标;未悬停 → vendor 的 pane 相对
  // 屏幕像素,**必须过 paneToFlow**(不过 = 虚线自由端随平移/缩放漂移,1.2.46)。
  const pt = to || { ...paneToFlow(st.pointer?.x ?? 0, st.pointer?.y ?? 0), pos: 'left' };
  const [d] = xy().getBezierPath({ sourceX: from.x, sourceY: from.y, sourcePosition: from.pos, targetX: pt.x, targetY: pt.y, targetPosition: pt.pos });
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
  // 只有 Start / Return 是"每图一个";agent / map / branch / merge 可任意多个(1.2.53)
  if ((type === 'start' || type === 'return') && FS.nodes.some(n => n.type === type)) { flowErr(T('每类起止节点各一个(%1 已存在)', type)); return ''; }
  const id = 'n' + (FS.next++);
  const data: FlowNodeData = type === 'agent' ? { label: T('步骤') + id, phase: '', prompt: '', model: '', schemaText: '' }
    : type === 'map' ? { label: T('逐条目') + id, phase: '', prompt: '', items: '' }
    : type === 'branch' ? { label: T('分支') + id, cond: '' }
    : type === 'loop' ? { label: T('循环') + id, cond: '', maxRounds: 1, budgetGuard: false }
    : type === 'log' ? { text: '' }
    : type === 'code' ? { code: '' } : type === 'subflow' ? { ref: '', argsExpr: '' }
    : type === 'start' ? { note: '' } : type === 'merge' ? {} : { ret: '' };
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
  const p = fPane(), c = paneToFlow(p.clientWidth / 2, p.clientHeight / 2);
  return { x: c.x - 125, y: c.y - 40 };                    // 减半卡宽/一截卡高:新节点落在画布正中偏上
}

// ── 阶段带(1.2.50 起可编辑)──
// 显示清单走 flowBandPhases 单点(显式优先/空则推导,与生成脚本同一口径);
// 编辑即物化(推导 → 显式)并即时落 autosave;重绘按**内容签名**跳过——否则每敲一键都重建 DOM,焦点必丢。
let phSig = '';
function renderPhaseBand(force = false): void {
  const box = $<HTMLElement>('fPhases'); if (!box) return;
  const list = flowBandPhases(flowDraft());
  const sig = JSON.stringify(list);
  if (!force && sig === phSig) return;
  phSig = sig;
  box.innerHTML = `<span class="fh-k">PHASES</span>` + (list.length
    ? list.map(p => `<span class="ph"><input class="ph-t" value="${esc(p.title)}" placeholder="${esc(T('阶段标题'))}">`
        + `<input class="ph-d" value="${esc(p.detail || '')}" placeholder="${esc(T('阶段说明'))}"></span>`).join('')
    : '<i>—</i>');
  box.querySelectorAll<HTMLElement>('.ph').forEach((el, i) => {
    const t = el.querySelector<HTMLInputElement>('.ph-t'), d = el.querySelector<HTMLInputElement>('.ph-d');
    const apply = (): void => {
      const raw = flowBandPhases(flowDraft()).map(x => ({ ...x }));
      raw[i] = { title: t?.value ?? '', detail: d?.value ?? '' };
      FS.phases = raw;                                   // 推导 → 显式物化(用户编辑过就归用户)
      phSig = JSON.stringify(flowBandPhases(flowDraft()));  // 先认账:refreshFlowScript 才不会重建本带(否则每键丢焦点)
      refreshFlowScript(); autosaveFlow();
    };
    t?.addEventListener('input', apply);
    d?.addEventListener('input', apply);
  });
}
// ── 脚本预览 + 校验(铁律 7:错误清单不裁,定高滚动)+ 两块读数 ──
// 阶段条数据只读 flowMetaPhases 单点(与生成脚本用的是同一个函数:编排时看到的 == 跑起来看到的);
// 读数全用数字与符号(行数/字节/段数),不新增文案。
// 成本/上限预估条(1.2.55):估算值来自 flowAgentEstimate 单点;阈值 25 对齐官方 `Large workflow` 告警。
const FLOW_LARGE_AGENTS = 25;
// 警告区(1.2.57):与错误分开显示——错误拦生成,警告只提示(如 code 片段的未知全局)。
function renderWarns(list: string[]): void {
  const el = $<HTMLElement>('fWarn'); if (!el) return;
  el.textContent = list.length ? '⚠ ' + list.join('\n⚠ ') : '';
  el.hidden = !list.length;
}
function renderCost(d: FlowDraft): void {
  const el = $<HTMLElement>('fCost'); if (!el) return;
  const n = flowAgentEstimate(d);
  const loops = [...flowLoopRegions(d).values()];
  const maxR = loops.reduce((m, l) => Math.max(m, l.maxRounds), 0);
  const parts = [`◆${n}`, T('并发≤16')];
  if (maxR) parts.push(T('循环上界≤%1', maxR));
  if (loops.some(l => l.budgetGuard)) parts.push(T('预算守卫'));
  el.textContent = parts.join(' · ');
  el.classList.toggle('over', n >= FLOW_LARGE_AGENTS);
  el.title = n >= FLOW_LARGE_AGENTS
    ? T('预计代理数 ≥%1:官方在 >25 个代理时会给 Large workflow 告警(建议性,不拦)', FLOW_LARGE_AGENTS)
    : T('估算值:agent 数 × 所在循环的 maxRounds;并发上限 16、单次运行代理总数上限 1000');
}
function refreshFlowScript(): void {
  const out = $<HTMLElement>('fScript'), d = flowDraft(), ctx = flowCtx(), errs = flowValidate(d, ctx);
  renderPhaseBand(); renderCost(d);
  renderWarns(flowWarnings(d));
  const stat = $<HTMLElement>('fStat'), label = $<HTMLElement>('fOut');
  if (label) label.setAttribute('data-t', 'OUT · ' + T('运行产物'));
  let js = '';
  if (errs.length) {
    out.textContent = '// ' + T('存在错误,无法生成');
    flowErr(T('存在错误,无法生成') + '\n· ' + errs.join('\n· '));
    if (stat) stat.textContent = '·';
    return;
  }
  try { js = flowGenerate(d, ctx); flowErr(''); }
  catch (e) { out.textContent = '// ' + T('存在错误,无法生成'); flowErr(String((e as Error)?.message ?? e)); if (stat) stat.textContent = '·'; return; }
  out.textContent = js;
  if (stat) {
    const n = js.length, bytes = n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';
    // 读数只用 L(行数)/字节数/◆段数三个技术符号(与页面上 SYSTEM CONFIG、OUT 同一口径,不进翻译层)
    stat.textContent = `L${js.split('\n').length} · ${bytes} · ◆${flowMetaPhases(d).length}`;
  }
}
// 命令区重绘(保存成功/切语言时调):三种形态全部由 flowCommands 单点产出,这里只做文案与落 DOM。
// 边界文案不是客套:用户会以为"页面能给的就是全部",所以要写明服务只写 cc-viewer/、执行在终端。
let fRunPath = '';
function renderRunBox(): void {
  if (!fRunPath || !$<HTMLElement>('fRun')) return;
  const c = flowCommands(fRunPath, FS.name.trim(), FS.cwd, FS.argsSpec.exampleText);
  $<HTMLElement>('fRunCmd').textContent = c.first;
  $<HTMLElement>('fCmdResume').textContent = c.resume;
  $<HTMLElement>('fCmdDist').textContent = c.dist;
  $<HTMLElement>('fRunNote').textContent =
    T('服务只写 ~/.claude/cc-viewer/;执行、恢复、停止都在你的终端(/workflows)。') + '\n' +
    T('恢复仅限同一会话,恢复前先在 /workflows 停掉旧 run;分发是复制命令,由你在终端执行。');
}
// 校验上下文单点(草稿列表 → FlowCtx):让"引用不存在的子流 / 二层嵌套"在生成前拦下。
// nested 的口径只在这里算一次(草稿 JSON 里有没有 subflow 节点)。
function flowCtx(): FlowCtx {
  return { drafts: fDrafts.map(d => ({ name: d.name, nested: !!(d.draft as FlowDraft)?.nodes?.some(n => n.type === 'subflow') })) };
}
function flowDraft(): FlowDraft {
  // v=2(1.2.50):纯加宽——whenToUse/phases/argsSpec 为空时产物与 v1 逐字节一致(黄金钉死),不空时才有码
  return { v: 2, name: FS.name.trim() || 'untitled', desc: FS.desc, cwd: FS.cwd,
    whenToUse: FS.whenToUse, phases: FS.phases.map(p => ({ ...p })), argsSpec: { ...FS.argsSpec },
    nodes: FS.nodes, edges: FS.edges, next: FS.next, view: FS.view };
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
  FS.whenToUse = String(d.whenToUse || '');
  // v1 草稿没有这两项 → 缺省空(不猜不塞默认值;空 = 沿用推导,与旧行为逐字节一致)
  FS.phases = (Array.isArray(d.phases) ? d.phases : []).map(p => ({ title: String(p?.title ?? ''), detail: String(p?.detail ?? '') }));
  const as = d.argsSpec || ({} as Partial<FlowArgsSpec>);
  FS.argsSpec = { schemaText: String(as.schemaText ?? ''), exampleText: String(as.exampleText ?? ''), required: !!as.required };
  FS.nodes = (d.nodes || []).map(n => ({ id: String(n.id), type: n.type, position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 }, data: { ...n.data } }));
  FS.edges = (d.edges || []).map(e => ({ id: String(e.id), source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target, targetHandle: e.targetHandle ?? null }));
  // 发号器只前进不回退:存盘 next 与现存 id 尾号取大 +1(重号会让 vendor 的 data-id 反查串节点)
  FS.next = Math.max(Number(d.next) || 0, ...FS.nodes.map(n => tailNum(n.id)), ...FS.edges.map(e => tailNum(e.id))) + 1;
  if (d.view && typeof d.view.zoom === 'number') FS.view = { x: Number(d.view.x) || 0, y: Number(d.view.y) || 0, zoom: Number(d.view.zoom) || 1 };
  FS.sel.clear();
}
async function saveFlowDraft(overwrite: boolean): Promise<void> {
  const d = flowDraft(), ctx = flowCtx(), errs = flowValidate(d, ctx);
  if (errs.length) { flowErr(T('存在错误,无法生成') + '\n· ' + errs.join('\n· ')); flowNote(T('先修复生成错误'), false); return; }
  flowNote(T('保存中…'), true);
  let r: DraftSaveResp;
  try {
    r = await (await fetch('/api/draft/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FS.name.trim(), draft: d, script: flowGenerate(d, ctx), overwrite }) })).json() as DraftSaveResp;
  } catch (e) { flowNote(T('保存失败:%1', String((e as Error)?.message ?? e)), false); return; }
  if (!r.ok) { flowNote(T('保存失败:%1', String(r.msg || '')), false); return; }
  const alt = String(r.path || '').split('/').pop() || '';
  const conflicted = alt !== FS.name.trim() + '.js';
  flowNote(conflicted ? T('已并存为 %1(同名草稿内容不同)', alt) : T('已保存: %1', String(r.path)), true);
  fRunPath = String(r.path || '');
  const box = $<HTMLElement>('fRun');
  if (box && fRunPath) { box.hidden = false; renderRunBox(); }
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
  const dl = $<HTMLElement>('fDraftRefs');                 // subflow 的 ref 候选 = 已保存草稿名
  if (dl) dl.innerHTML = fDrafts.map(x => `<option value="${esc(x.name)}"></option>`).join('');
}
// agentType 候选(1.2.56):后端只读枚举本机 + 插件 agents;取不到就静默回落自由文本(下拉只是起点,不是约束)
let fATypes: string[] = [];
function renderATypes(): void {
  const dl = $<HTMLElement>('fATypes');
  if (dl) dl.innerHTML = fATypes.map(t => `<option value="${esc(t)}"></option>`).join('');
}
async function loadAgentTypes(): Promise<void> {
  try { fATypes = ((await (await fetch('/api/agents')).json() as { types?: string[] }).types) || []; }
  catch { fATypes = []; }
  renderATypes();
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
    // 载入版本白名单与后端 save_draft 的 draft_ver_ok 同一口径(1.2.50:v1 兼容 + v2);未知版本提示而非猜测读取
    if (!j || (j.v !== 1 && j.v !== 2)) { flowNote(T('未知草稿版本,不猜'), false); return; }
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
  if (!flowCanCompose(cwd)) return;          // 第二道守卫:入口已隐藏,这里防任何绕过入口的调用把草稿写进"无项目"目录
  const root = $<HTMLElement>('flow');
  root.hidden = false; flowVisible = true;
  document.body.classList.add('flow-open');
  if (!flowWired) { wireShell(); flowWired = true; }
  initFlowCanvas();
  FS.cwd = cwd || '';
  $<HTMLElement>('fCwd').textContent = cwd || T('(未选项目)');
  $<HTMLElement>('fRun').hidden = true;
  fRunPath = '';                                             // 命令区跟着「本次会话保存过的草稿」走,重开即清
  $<HTMLElement>('fOver').hidden = true;
  flowErr('');
  await loadFlowDrafts(FS.cwd);
  void loadAgentTypes();
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
  FS = { name: '', desc: '', cwd: FS.cwd, whenToUse: '', phases: [], argsSpec: { schemaText: '', exampleText: '', required: false },
    nodes: [], edges: [], next: 1, sel: new Set(), view: { x: 20, y: 10, zoom: 1 } };
}
function syncHeadInputs(): void {
  $<HTMLInputElement>('fName').value = FS.name;
  $<HTMLInputElement>('fDesc').value = FS.desc;
  $<HTMLInputElement>('fWhen').value = FS.whenToUse;
  $<HTMLTextAreaElement>('fArgS').value = FS.argsSpec.schemaText;
  $<HTMLTextAreaElement>('fArgE').value = FS.argsSpec.exampleText;
  $<HTMLInputElement>('fArgR').checked = FS.argsSpec.required;
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
  $<HTMLElement>('fCopyResume').onclick = () => { void copyText($<HTMLElement>('fCmdResume').textContent || '', T('命令已复制')); };
  $<HTMLElement>('fCopyDist').onclick = () => { void copyText($<HTMLElement>('fCmdDist').textContent || '', T('分发命令已复制')); };
  $<HTMLInputElement>('fName').oninput = e => { FS.name = (e.target as HTMLInputElement).value; refreshFlowScript(); autosaveFlow(); };
  $<HTMLInputElement>('fDesc').oninput = e => { FS.desc = (e.target as HTMLInputElement).value; refreshFlowScript(); autosaveFlow(); };
  $<HTMLInputElement>('fWhen').oninput = e => { FS.whenToUse = (e.target as HTMLInputElement).value; refreshFlowScript(); autosaveFlow(); };
  $<HTMLTextAreaElement>('fArgS').oninput = e => { FS.argsSpec.schemaText = (e.target as HTMLTextAreaElement).value; refreshFlowScript(); autosaveFlow(); };
  $<HTMLTextAreaElement>('fArgE').oninput = e => { FS.argsSpec.exampleText = (e.target as HTMLTextAreaElement).value; refreshFlowScript(); autosaveFlow(); };
  $<HTMLInputElement>('fArgR').onchange = e => { FS.argsSpec.required = !!(e.target as HTMLInputElement).checked; refreshFlowScript(); autosaveFlow(); };
  document.querySelectorAll<HTMLElement>('#fPalette .pal').forEach(p => {
    const add = (): void => { flowAddNode((p.dataset.t || 'agent') as FlowKind, flowCenter()); };
    p.addEventListener('click', add);
    p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(); } });   // tabindex 给了焦点,回车/空格必须真的能加节点
    p.addEventListener('dragstart', e => (e as DragEvent).dataTransfer?.setData('text/plain', String(p.dataset.t || '')));
  });
  const pane = fPane();
  pane.addEventListener('dragover', e => e.preventDefault());
  pane.addEventListener('drop', e => {
    e.preventDefault();
    const t = (e as DragEvent).dataTransfer?.getData('text/plain'); if (!t) return;
    const r = pane.getBoundingClientRect();
    flowAddNode(t as FlowKind, paneToFlow((e as DragEvent).clientX - r.left, (e as DragEvent).clientY - r.top));
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
  phSig = '';                                               // 阶段带的 placeholder 是动态拼的:清签名逼重绘
  renderRunBox();                                           // 命令区标签/边界文案同样是动态拼的
  flowRender();                                             // 内部会重跑 refreshFlowScript(错误清单同语言)
}
// ── 入口可见性单点:编排是**按项目**的事,没有"全部项目"的 workflow ──
// 草稿落点(drafts/<项目 slug>)、提示词上下文、终端执行目录都要求一个确定的 cwd;
// 选了「◆ 全部项目」时根本没有目标项目 → 入口不该存在(不是灰着让人猜)。
// 判定只住这里,展示面(按钮显隐 / openFlow 守卫 / tooltip)一律调它——铁律 8。
const flowCanCompose = (cwd: string): boolean => !!String(cwd || '').trim();
function syncFlowEntry(): void {
  const b = $<HTMLElement>('btnFlow'); if (!b) return;
  const on = flowCanCompose(fproj);
  b.hidden = !on;
  b.title = on ? T('对选中项目「%1」编排 Workflow(拖节点连线,保存后在该项目终端执行)', fproj) : T('先在上方选一个具体项目,才能编排 Workflow');
}
$<HTMLElement>('btnFlow').onclick = () => { if (flowCanCompose(fproj)) void openFlow(fproj); };
syncFlowEntry();   // 启动即定态:fproj 在 30-app 顶层已从 localStorage 恢复(本文件在其后拼接)

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
      // 无头 dump 的虚拟时钟遇**无限 CSS 动画**永不空闲 → --dump-dom 挂死(实测:#fConn 常驻 fdash)。
      // 冒烟是测试通道,关掉动画不动任何断言,却让文档里那条命令真的能跑完。
      const noanim = document.createElement('style');
      noanim.textContent = '#flow,#fConn,.wfnode,.pal{animation:none!important}';
      document.head.appendChild(noanim);
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
        const mx = (sp.x + dp.x) / 2, my = (sp.y + dp.y) / 2 + 20;
        fire(src, 'pointerdown', sp.x + 5, sp.y + 5);
        await frames(2); fire(document, 'mousemove', mx, my);
        await frames(2); const dmid = fConnEl().getAttribute('d');
        // 虚线自由端必须钉在光标上(1.2.46,真实反馈「连线时虚线会漂移」):#fConn 画在被 translate+scale
        // 变换的 #fViewport 内,而 vendor 的 connection.pointer 是 pane 相对屏幕像素 → 终点必须换算回流坐标。
        const pr = fPane().getBoundingClientRect(), vv = FS.view;
        const dn = String(dmid || '').match(/-?\d+(?:\.\d+)?/g) || [];
        const tx = Number(dn[dn.length - 2]), ty = Number(dn[dn.length - 1]);   // getBezierPath 末两数 = targetX,targetY
        const anchored = dn.length >= 2 && Math.abs(vv.x + tx * vv.zoom - (mx - pr.left)) < 2
          && Math.abs(vv.y + ty * vv.zoom - (my - pr.top)) < 2;
        if (!anchored) res.push('[anchor d=' + String(dmid).slice(0, 44) + ' v=' + JSON.stringify(vv)
          + ' m=' + Math.round(mx - pr.left) + ',' + Math.round(my - pr.top) + ']');
        check('connPath-anchored', anchored);
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
      // 拖拽创建:真实 HTML5 DataTransfer —— 用户要的"通过拖拽建 workflow"这条只有浏览器能实证
      const pal = document.querySelector('#fPalette .pal[data-t="agent"]');
      if (pal) {
        const dt = new DataTransfer();
        pal.dispatchEvent(new DragEvent('dragstart', { view: window, bubbles: true, dataTransfer: dt }));
        const n0 = FS.nodes.length, r = fPane().getBoundingClientRect(), x = r.left + 140, y = r.bottom - 90;
        fPane().dispatchEvent(new DragEvent('dragover', { view: window, bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        fPane().dispatchEvent(new DragEvent('drop', { view: window, bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        await frames(6);
        const addId = FS.nodes.length > n0 ? FS.nodes[FS.nodes.length - 1].id : '__none__';
        check('drag-add', FS.nodes.length === n0 + 1 && dt.getData('text/plain') === 'agent' && !!fNodeEl(addId));
        flowRemoveNode(addId);                               // 孤立卡会挡校验:复原后再验生成器
        await frames(4);
      } else { res.push('✗drag-add(no-palette)'); }
      // 1.2.50 草稿 v2:whenToUse 头部输入 + 可编辑阶段带——真实 DOM 里才验得到"输入框真的在、值真的回填"
      FS.whenToUse = 'smoke-when'; FS.phases = [{ title: 'S1', detail: 'd1' }];
      refreshFlowScript();
      const bandT = $<HTMLElement>('fPhases').querySelector<HTMLInputElement>('input.ph-t');
      check('meta-v2', !!$('fWhen') && !!bandT && bandT.value === 'S1'
        && /whenToUse: "smoke-when"/.test($<HTMLElement>('fScript').textContent || '')
        && /phases: \[\{ title: "S1", detail: "d1" \}\]/.test($<HTMLElement>('fScript').textContent || ''));
      // 1.2.53 map 节点(Phase 4):真机里走一遍"建节点 → 连线 → 出码含 pipeline"
      flowBlank();
      const sm2 = sm('start', 60, 150, { note: 'q' }), mp = sm('map', 300, 150, { items: 'ARGS.paths', prompt: '审计 {{item}}', label: 'audit:{{item}}', phase: 'Scan' });
      const ag2 = sm('agent', 540, 150, { label: '复核', phase: 'Verify', prompt: '复核 {{' + mp + '}}' }), rn2 = sm('return', 780, 150, { ret: '' });
      FS.edges.push({ id: 'e' + (FS.next++), source: sm2, sourceHandle: 'out', target: mp, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: mp, sourceHandle: 'out', target: ag2, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: ag2, sourceHandle: 'out', target: rn2, targetHandle: 'in' });
      refreshFlowScript();
      check('map-gen', new RegExp('const ' + mp + ' = await pipeline\\(ARGS\\.paths, \\(prev, item, i\\) => agent\\(`审计 \\$\\{item\\}`')
        .test($<HTMLElement>('fScript').textContent || '') && $<HTMLElement>('fErr').hidden);
      // 1.2.54 branch(Phase 5):建图 → 出码含 if/else(真机里再走一遍节点/连线/生成链路)
      flowBlank();
      const bSt = sm('start', 60, 150, { note: 'q' }), bBr = sm('branch', 300, 150, { cond: 'args === 1' });
      const bA = sm('agent', 540, 60, { label: 'A', phase: 'P', prompt: 'a' }), bB = sm('agent', 540, 240, { label: 'B', phase: 'P', prompt: 'b' });
      const bM = sm('merge', 780, 150, {}), bR = sm('return', 1020, 150, { ret: '' });
      FS.edges.push({ id: 'e' + (FS.next++), source: bSt, sourceHandle: 'out', target: bBr, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: bBr, sourceHandle: 'true', target: bA, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: bBr, sourceHandle: 'false', target: bB, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: bA, sourceHandle: 'out', target: bM, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: bB, sourceHandle: 'out', target: bM, targetHandle: 'in2' });
      FS.edges.push({ id: 'e' + (FS.next++), source: bM, sourceHandle: 'out', target: bR, targetHandle: 'in' });
      refreshFlowScript();
      const bs = $<HTMLElement>('fScript').textContent || '';
      check('branch-gen', new RegExp('let ' + bM + ';').test(bs) && /if \(args === 1\) \{/.test(bs) && /\} else \{/.test(bs) && $<HTMLElement>('fErr').hidden);
      // 1.2.55 loop(Phase 6):建图(含回边)→ 出码含 while + 成本条
      flowBlank();
      const lSt = sm('start', 60, 150, { note: 'q' }), lLp = sm('loop', 300, 150, { label: 'L', cond: 'true', maxRounds: 3, budgetGuard: true });
      const lAg = sm('agent', 560, 150, { label: 'A', phase: 'P', prompt: 'a' }), lRt = sm('return', 820, 150, { ret: '' });
      FS.edges.push({ id: 'e' + (FS.next++), source: lSt, sourceHandle: 'out', target: lLp, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: lLp, sourceHandle: 'body', target: lAg, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: lAg, sourceHandle: 'out', target: lLp, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: lLp, sourceHandle: 'out', target: lRt, targetHandle: 'in' });
      refreshFlowScript();
      const ls = $<HTMLElement>('fScript').textContent || '';
      check('loop-gen', /while \(\(true\) && round < 3\) \{/.test(ls) && /budget\.remaining\(\)/.test(ls)
        && /◆3/.test($<HTMLElement>('fCost').textContent || '') && $<HTMLElement>('fErr').hidden);
      // 1.2.57 code / subflow(Phase 8):真机里建图 → 出码含片段原文与 workflow()(路径引用免存在性检查)
      flowBlank();
      const kSt = sm('start', 60, 150, { note: 'q' }), kAg = sm('agent', 300, 150, { label: 'A', phase: 'P', prompt: 'a' });
      const kCode = sm('code', 540, 150, { code: 'return String(' + kAg + ').toUpperCase()' });
      const kSub = sm('subflow', 780, 150, { ref: '/abs/triage.js', argsExpr: '' }), kRt = sm('return', 1020, 150, { ret: '' });
      FS.edges.push({ id: 'e' + (FS.next++), source: kSt, sourceHandle: 'out', target: kAg, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: kAg, sourceHandle: 'out', target: kCode, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: kCode, sourceHandle: 'out', target: kSub, targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: kSub, sourceHandle: 'out', target: kRt, targetHandle: 'in' });
      refreshFlowScript();
      const ks = $<HTMLElement>('fScript').textContent || '';
      check('code-gen', new RegExp('const ' + kCode + ' = await \\(async \\(\\) => \\{').test(ks)
        && new RegExp('const ' + kSub + ' = await workflow\\(\\{ scriptPath: "/abs/triage\\.js" \\}\\)').test(ks)
        && $<HTMLElement>('fErr').hidden);
      refreshFlowScript();
      check('gen', /export const meta/.test($<HTMLElement>('fScript').textContent || '') && $<HTMLElement>('fErr').hidden);
      document.title = 'SMOKE ' + (res.every(r => r[0] === '✓') ? 'OK ' : 'FAIL ') + res.join(' ');
    } catch (e) {
      document.title = 'SMOKE CRASH ' + String((e as Error)?.message ?? e) + ' ' + res.join(' ');
    }
  })();
}
if (typeof location !== 'undefined' && String(location.href || '').indexOf('flowsmoke') >= 0) flowSmoke();
