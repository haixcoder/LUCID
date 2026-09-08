// 编排器契约套件(dev-guide §7 C1–C10 + §8.3):无头桩加载**真实编译产物**,配 @xyflow/system 的**替身**
// 驱动「vendor 会怎么调我们」这一整类断言(C7 回调不许抛 / C8 六回调 / 坑⑤ getFromHandle 守卫 / C10 手测注入),
// C1–C6 直接断言渲染出的 DOM 契约;§6 语义映射表逐行做成生成器断言(字面量走 round-trip 求值,不比对文本噪音)。
// 桩没有布局引擎,给不出 elementFromPoint / 真实吸附 —— 连线吸附、拖拽阈值、滚轮缩放这三件由浏览器
// headless 五断言(?flowsmoke=1,dev-guide §8.5)覆盖,本文件不假装能测它们。
import fs from 'node:fs';
import { load, makeCk, payload, querySelectorEl, visibleText, ARTIFACT, RUN_DONE, SESSION_FIX } from './harness.ts';
const { ck, done } = makeCk();

// ── vendor 替身:记录"我们喂给它的参数",并按真实语义回调 ──
const rec: Record<string, any> = { pz: null, pzCount: 0, pzUpdates: [], vp: [], drags: [], dragUpdates: [], destroys: 0, handle: null, bezier: [], addEdge: 0, adopt: 0 };
const XY = {
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  ConnectionMode: { Strict: 'strict', Loose: 'loose' },
  XYPanZoom(p: any) {
    rec.pz = p; rec.pzCount++;
    return {
      update: (o: any) => { rec.pzUpdates.push(o); }, destroy() {}, getViewport: () => ({ x: 1, y: 2, zoom: 3 }),
      setViewport: (v: any) => { rec.vp.push(v); return Promise.resolve(); },
      setViewportConstrained: () => Promise.resolve(), setScaleExtent() {}, setTranslateExtent() {},
      scaleTo: () => Promise.resolve(true), scaleBy: () => Promise.resolve(true), syncViewport() {}, setClickDistance() {},
    };
  },
  XYDrag(p: any) {
    rec.drags.push(p);
    return { update: (o: any) => { rec.dragUpdates.push(o); }, destroy() { rec.destroys++; } };
  },
  XYHandle: {
    onPointerDown(_ev: any, p: any) { rec.handle = p; },
    isValid: () => ({ isValid: true, connection: null, handleDomNode: null, toHandle: null }),
  },
  // 真实 addEdge 的口径:同一 (source,target) 不重复追加
  addEdge(e: any, edges: any[]) {
    rec.addEdge++;
    return edges.some((x: any) => x.source === e.source && x.target === e.target) ? edges : edges.concat([e]);
  },
  getBezierPath(o: any) { rec.bezier.push(o); return ['M1,2C3,4 5,6 7,8', 7, 8, 4, 5]; },
  // 忠实模拟 vendor 的 adoptUserNodes:**checkEquality 默认 true** —— 节点对象引用没变就沿用旧 internals
  // (1.2.49 拖拽漂移的根因就藏在这条语义里:原地改 position 的节点会被判"没变")。
  adoptUserNodes(nodes: any[], lookup: Map<string, any>, _parents: any, opts: any) {
    rec.adopt++;
    const prev = new Map(lookup);
    lookup.clear();
    for (const n of nodes) {
      const old = prev.get(n.id);
      if (old && old.internals?.userNode === n) { lookup.set(n.id, old); continue; }
      lookup.set(n.id, { id: n.id, internals: { positionAbsolute: { x: n.position.x, y: n.position.y }, userNode: n }, measured: n.measured, position: n.position });
    }
  },
};

// ── fetch 桩:草稿两端点 + 主视图夹具(可变响应:冲突/回载/版本各案)──
const posts: any[] = [];
let draftsResp: any = { drafts: [] };
let saveResp: any = { ok: true, msg: '已保存', path: '/home/u/.claude/cc-viewer/drafts/fix-abc123/demo-research.js', sha: 'abc12345' };
const base = payload([JSON.parse(JSON.stringify(RUN_DONE))], [JSON.parse(JSON.stringify(SESSION_FIX))]);
const fetchFor = (url: string, init?: any) => {
  if (url.indexOf('/api/draft/save') === 0) { posts.push(JSON.parse(String(init && init.body))); return saveResp; }
  if (url.indexOf('/api/drafts') === 0) return draftsResp;
  return base(url);
};
const mkEnv = (ls?: Record<string, string>, confirmAns = false) =>
  load({ globals: { XYFlowSystem: XY, confirm: () => confirmAns }, fetchFor, localStorage: ls });

const N = (id: string, type: string, x: number, y: number, data: any = {}) => ({ id, type, position: { x, y }, data });
const E = (id: string, s: string, t: string) => ({ id, source: s, sourceHandle: 'out', target: t, targetHandle: 'in' });
const dft = (nodes: any[], edges: any[], extra: any = {}) =>
  ({ v: 1, name: 'demo', desc: 'd', cwd: '/work/fix', nodes, edges, next: 99, view: { x: 0, y: 0, zoom: 1 }, ...extra });

// 链式:Start → A → B → Return
const CHAIN = {
  nodes: [N('n1', 'start', 0, 0, { note: '输入' }),
    N('n2', 'agent', 200, 0, { label: 'A', phase: 'P1', prompt: '第一步 {{n1}}', model: '', schemaText: '' }),
    N('n3', 'agent', 400, 0, { label: 'B', phase: 'P2', prompt: '第二步', model: '', schemaText: '' }),
    N('n4', 'return', 600, 0, { ret: '{ r: n3 }' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')],
};
// 扇出 + 汇聚(菱形):Start → A → (B1,B2) → C → Return
const FAN = {
  nodes: [N('n1', 'start', 0, 0, { note: 'q' }),
    N('n2', 'agent', 200, 0, { label: 'A', phase: 'P1', prompt: '拆', model: '', schemaText: '' }),
    N('n3', 'agent', 400, -80, { label: 'B1', phase: 'P2', prompt: 'b1 {{n2}}', model: '', schemaText: '' }),
    N('n4', 'agent', 400, 80, { label: 'B2', phase: 'P2', prompt: 'b2 {{n2}}', model: 'sonnet', schemaText: '{"type":"object","properties":{"x":{"type":"string"}},"required":["x"]}' }),
    N('n5', 'agent', 600, 0, { label: 'C', phase: 'P3', prompt: '汇 {{n3}} {{n4}}', model: '', schemaText: '' }),
    N('n6', 'return', 800, 0, { ret: '' })],
  edges: [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n2', 'n4'), E('e4', 'n3', 'n5'), E('e5', 'n4', 'n5'), E('e6', 'n5', 'n6')],
};

(async function main() {
  const html = fs.readFileSync(ARTIFACT, 'utf8');
  // ── 引入顺序契约:vendor 是经典脚本,必须在主块之前(全局先就绪) ──
  const iVend = html.indexOf('<script src="/static/xyflow.system.umd.js"></script>');
  ck('C0 vendor 以 <script src> 引入且排在主脚本块之前', iVend > 0 && iVend < html.lastIndexOf('<script>\n'), JSON.stringify([iVend, html.lastIndexOf('<script>\n')]));
  ck('C1 画布契约类名在骨架里', /id="fPane" class="lucid-flow__pane"/.test(html) && /id="fViewport" class="xyflow__viewport lucid-flow__viewport"/.test(html));
  ck('编辑器住独立容器 #flow(默认关闭,排在 #list 之后)', /<div id="flow" hidden>/.test(html));

  const env = mkEnv();
  await env.flush();
  ck('boot:加载真实产物无异常(顶层不碰 XYFlowSystem)', env.errs.length === 0, env.errs.join('|'));
  ck('boot:编辑器未打开(画布未初始化)', env.$('flow').hidden === true && rec.pz === null);

  // ── 入口按项目(1.2.44 需求):选「◆ 全部项目」时**不该有**编排入口,只有选中具体项目才出现 ──
  const envE = mkEnv();
  await envE.flush();
  ck('未选项目:入口隐藏 + tooltip 直接交代下一步(不是灰着让人猜)',
     envE.$('btnFlow').hidden === true && /先在上方选一个具体项目/.test(envE.$('btnFlow').title), envE.$('btnFlow').title);
  envE.run('void openFlow("")');
  await envE.flush(10);
  ck('openFlow("") 被拒(第二道守卫:绕开入口也写不出"无项目"草稿)',
     envE.$('flow').hidden === true && envE.get('flowVisible') === false && rec.pz === null);
  envE.run('fproj = "/work/fix"; renderAnchored()');
  await envE.flush();
  ck('选中具体项目:入口出现,tooltip 指名该项目',
     envE.$('btnFlow').hidden === false && envE.$('btnFlow').title.includes('/work/fix'), envE.$('btnFlow').title);
  envE.run('fproj = ""; renderAnchored()');
  await envE.flush();
  ck('切回「全部项目」:入口立即消失(判定只有一个函数,按钮/守卫/tooltip 三处同源)', envE.$('btnFlow').hidden === true);
  envE.run('fproj = "/work/fix"; renderAnchored()');
  await envE.flush();
  envE.run("document.getElementById('langsel').value='en'; document.getElementById('langsel').onchange({target:{value:'en'}});");
  await envE.flush();
  ck('切语言后 tooltip 同步换语(动态文案也在 T() 层内)', /Pick a specific project|Compose a Workflow/.test(envE.$('btnFlow').title), envE.$('btnFlow').title);

  // ── 打开编辑器(后端无草稿 → seed 起手图)──
  env.run('void openFlow("/work/fix")');
  await env.flush(30);
  ck('openFlow 后 XYPanZoom 构造一次且每节点一个 XYDrag', rec.pz !== null && rec.drags.length === 7 && env.get('fdrag.size') === 7, String(rec.drags.length));
  ck('C8 XYPanZoom 四个构造期回调全传(缺则 UMD 内 "o is not a function")',
     ['onPanZoom', 'onPanZoomStart', 'onPanZoomEnd', 'onDraggingChange'].every(k => typeof rec.pz[k] === 'function'),
     JSON.stringify(Object.keys(rec.pz || {})));
  ck('C8 onTransformChange 也在 update 参数里(第二个无防护点)', typeof rec.pzUpdates[0].onTransformChange === 'function');
  ck('C8 panzoom 参数含 domNode/min/max/translateExtent/viewport',
     !!rec.pz.domNode && rec.pz.minZoom === 0.2 && rec.pz.maxZoom === 2.5 && Array.isArray(rec.pz.translateExtent) && !!rec.pz.viewport);
  ck('C6 noPanClassName/noWheelClassName/lib 三件传齐(panzoom 排除节点/滚轮区)',
     rec.pzUpdates[0].noPanClassName === 'nopan' && rec.pzUpdates[0].noWheelClassName === 'nowheel' && rec.pzUpdates[0].lib === 'lucid');
  const nodes = env.$qa('.wfnode');
  ck('seed 起手图渲染 7 张节点卡', nodes.length === 7, String(nodes.length));
  ck('C2 节点契约类名 + data-nodeid + nopan',
     nodes.every(n => /lucid-flow__node/.test(n.attrs.class || '') && !!n.attrs['data-nodeid'] && /nopan/.test(n.attrs.class || '')));
  const handles = env.$qa('#fViewport div.lucid-flow__handle.source.connectable.connectableend[data-handleid][data-handlepos][data-nodeid][data-id]');
  ck('C3+C4 source handle 属性全齐(缺 connectable/connectableend → isValid 恒 false)', handles.length === 6, String(handles.length));
  ck('C5 data-id = ${flowId}-${nodeId}-${handleId}-${type}', handles.every(h => {
    const m = /^([^-]+)-([^-]+)-([^-]+)-([^-]+)$/.exec(String(h.attrs['data-id']));
    return !!m && m[1] === 'lwf' && m[2] === h.attrs['data-nodeid'] && m[3] === h.attrs['data-handleid'] &&
      m[4] === (h.classList.contains('source') ? 'source' : 'target');
  }), handles[0] && handles[0].attrs['data-id']);
  ck('C6 节点内可编辑控件全带 nodrag(编辑不拖走)',
     env.$qa('#fViewport input').concat(env.$qa('#fViewport textarea'), env.$qa('#fViewport select'), env.$qa('#fViewport .tag'))
       .every(e => /nodrag/.test(e.attrs.class || '')));
  ck('C2 拓扑合理性:start 无 target 把、return 无 source 把',
     env.$q('.wfnode.t-start .lucid-flow__handle.target') === null && env.$q('.wfnode.t-return .lucid-flow__handle.source') === null);
  ck('每个 handle 都注册了 pointerdown(连线起点)', handles.every(h => !!(h._l || {}).pointerdown));
  ck('XYDrag 参数含 getStoreItems;update 含阈值与 noDragClassName',
     typeof rec.drags[0].getStoreItems === 'function' && rec.dragUpdates[0].nodeClickDistance === 3 && rec.dragUpdates[0].noDragClassName === 'nodrag');

  // ── C10 手写测量注入(adoptUserNodes 之后覆盖 internals.handleBounds)──
  env.run(`(function(){
    FS.view = { x: 0, y: 0, zoom: 2 };
    const el = document.querySelector('.wfnode[data-nodeid="n2"]');
    el._rect = { top: 20, bottom: 120, left: 100, right: 300, height: 100 };
    const h = el.querySelector('.lucid-flow__handle.source');
    h._rect = { top: 60, bottom: 71, left: 294, right: 305, height: 11 };
    measureFlow();
  })()`);
  ck('C10 handleBounds 已注入 nodeLookup.internals(vendor 吸附读的就是它)',
     !!env.get('(function(){const it=flookup.get("n2");return it&&it.internals&&it.internals.handleBounds?1:0})()'));
  const bnd = JSON.parse(env.get('JSON.stringify(fbounds.get("n2").source[0])'));
  ck('C10 测量按 zoom 归一((294-100)/2 = 97, 11/2 = 5.5)', Math.abs(bnd.x - 97) < 0.01 && Math.abs(bnd.width - 5.5) < 0.01, JSON.stringify(bnd));
  ck('C10 边端点 = 节点坐标 + 归一 handle 中心(不含视口平移缩放)',
     Math.abs(env.get('handlePoint("n2","out","source").x') - (env.get('FS.nodes.find(n=>n.id==="n2").position.x') + 99.75)) < 0.01, JSON.stringify(bnd));

  // ── 连线:真实 DOM 事件 → vendor 参数包 → 回调驱动(坑③⑤ + C7)──
  // 1.2.47 根因:在 pointerdown 上调 preventDefault,浏览器**就不再派发兼容鼠标事件**(mousedown/mousemove/
  // mouseup —— Chrome 实测),而 vendor 的连线拖拽全靠 document 上的 mousemove/mouseup → 拖拽期间零回调、
  // 松手不收尾(真实反馈「连线没有结束」)。合成事件绕过了浏览器的 pointer→mouse 派生逻辑,测不到这层,
  // 所以这里直接钉"我们不许取消 pointerdown"。
  let pdCalls = 0;
  querySelectorEl(env.rootEl, '.wfnode[data-nodeid="n2"] .lucid-flow__handle.source')
    .fire('pointerdown', { preventDefault: () => { pdCalls++; }, clientX: 300, clientY: 70 });
  ck('连线起点不许 preventDefault pointerdown(取消它会掐掉 vendor 依赖的兼容鼠标事件)',
     pdCalls === 0, 'preventDefault×' + pdCalls);
  ck('pointerdown → XYHandle.onPointerDown 收到完整参数包',
     !!rec.handle && rec.handle.lib === 'lucid' && rec.handle.flowId === 'lwf' && rec.handle.connectionRadius === 40
     && rec.handle.nodeId === 'n2' && rec.handle.handleId === 'out' && rec.handle.isTarget === false && !!rec.handle.nodeLookup,
     JSON.stringify(Object.keys(rec.handle || {})));
  ck('坑⑤ onConnectStart 之前 getFromHandle() 为 null(不许伪造起点)', rec.handle.getFromHandle() === null);
  rec.handle.onConnectStart({}, { nodeId: 'n2', handleId: 'out', handleType: 'source' });
  ck('坑⑤ onConnectStart 之后必须回吐非空(vendor 每帧拿它当守卫,空则立即取消连接)', !!rec.handle.getFromHandle(), JSON.stringify(rec.handle.getFromHandle()));
  rec.handle.updateConnection({ fromHandle: { nodeId: 'n2', id: 'out', type: 'source' }, toHandle: null, pointer: { x: 400, y: 300 } });
  ck('updateConnection 画出临时连线(d 非空)', !!env.$('fConn').attrs.d, String(env.$('fConn').attrs.d));
  // ── 坐标系口径(1.2.46,真实反馈「选中节点连线时虚线会漂移」)──
  // vendor 的 connection.pointer 是 **pane 相对屏幕像素**(XYHandle 内 q(e,domNode) = clientX - paneRect.left),
  // 而 #fConn 画在被 translate+scale 变换的 #fViewport 里 → 终点必须换算成流坐标,否则随平移/缩放漂移。
  // 判据不看中间量,看**屏幕上钉不钉在光标**:视口怎么变,虚线自由端都得落在 pointer 那个屏幕点上。
  const anchor = (vp: any, label: string): void => {
    env.run(`FS.view = ${JSON.stringify(vp)}`);
    rec.handle.updateConnection({ fromHandle: { nodeId: 'n2', id: 'out', type: 'source' }, toHandle: null, pointer: { x: 400, y: 300 } });
    const b = rec.bezier[rec.bezier.length - 1];
    const sx = vp.x + b.targetX * vp.zoom, sy = vp.y + b.targetY * vp.zoom;
    ck(`虚线自由端在屏幕上钉住 pointer(${label} zoom=${vp.zoom} 平移=${vp.x},${vp.y})`,
       Math.abs(sx - 400) < 0.01 && Math.abs(sy - 300) < 0.01, `屏幕(${sx},${sy}) ← 流(${b.targetX},${b.targetY})`);
  };
  anchor({ x: 0, y: 0, zoom: 1 }, '恒等');
  anchor({ x: 0, y: 0, zoom: 2 }, '缩放');
  anchor({ x: -120, y: 45, zoom: 1.5 }, '平移+缩放');
  const hp = JSON.parse(env.get('JSON.stringify(handlePoint("n2","out","source"))'));
  const bLast = rec.bezier[rec.bezier.length - 1];
  ck('虚线起点 = handle 流坐标(与 renderEdges 同口径;视口变换只作用于终点,起点再除一次 zoom 就是二次变换)',
     bLast.sourceX === hp.x && bLast.sourceY === hp.y, JSON.stringify([bLast.sourceX, bLast.sourceY, hp]));
  rec.handle.updateConnection({ fromHandle: { nodeId: 'n2', id: 'out', type: 'source' },
    toHandle: { nodeId: 'n3', id: 'in', type: 'target' }, pointer: { x: 9999, y: 9999 } });
  const b3 = rec.bezier[rec.bezier.length - 1], h3 = JSON.parse(env.get('JSON.stringify(handlePoint("n3","in","target"))'));
  ck('悬停目标 handle:虚线终点吸附 handle 流坐标(pointer 此时仍是屏幕坐标,不许漏进来)',
     b3.targetX === h3.x && b3.targetY === h3.y && b3.targetX !== 9999, JSON.stringify([b3.targetX, b3.targetY, h3]));
  // 换算本身(单点直测):FS.view 此时是上面最后一档 { x:-120, y:45, zoom:1.5 }
  const pf = JSON.parse(env.get('JSON.stringify(paneToFlow(300, 150))'));
  ck('paneToFlow 单点:屏幕(pane 相对)→ 流坐标 = ((300+120)/1.5, (150-45)/1.5)',
     Math.abs(pf.x - 280) < 0.01 && Math.abs(pf.y - 70) < 0.01, JSON.stringify(pf));
  ck('isValidConnection 拒自连、放行正常连',
     rec.handle.isValidConnection({ source: 'n2', target: 'n2', sourceHandle: 'out', targetHandle: 'in' }) === false
     && rec.handle.isValidConnection({ source: 'n2', target: 'n7', sourceHandle: 'out', targetHandle: 'in' }) === true);
  // 注意:n2 → n5 在起手图里已存在(拆解→检索C),拿它测"加边"会被去重规则静默吃掉 → 用新的一对节点
  const e0 = env.get('FS.edges.length');
  rec.handle.onConnect({ source: 'n2', sourceHandle: 'out', target: 'n7', targetHandle: 'in' });
  await env.flush(8);
  ck('onConnect → 加边(id=e\\d+,发号只前进)',
     env.get('FS.edges.length') === e0 + 1 && /^e\d+$/.test(String(env.get('FS.edges[FS.edges.length-1].id'))), String(env.get('FS.edges.length')));
  rec.handle.onConnect({ source: 'n2', sourceHandle: 'out', target: 'n7', targetHandle: 'in' });
  ck('同一对节点不叠边(addEdge 单点去重)', env.get('FS.edges.length') === e0 + 1, String(env.get('FS.edges.length')));
  rec.handle.onConnectEnd();
  ck('onConnectEnd 清掉临时连线(不留残影)', !env.$('fConn').attrs.d, String(env.$('fConn').attrs.d));
  // C7:把每个喂给 vendor 的回调都用坏参数调一遍 —— 任何一处向外抛都算违规(会打断 vendor 自身监听注册)
  let threw = '';
  for (const k of Object.keys(rec.handle)) {
    if (typeof rec.handle[k] !== 'function') continue;
    for (const junk of [undefined, null, {}, { fromHandle: null, toHandle: null }]) {
      try { rec.handle[k](junk, junk, junk); } catch (e) { threw += k + ':' + String((e as Error).message) + ' '; }
    }
  }
  ck('C7 全部 vendor 回调对坏参数不抛', threw === '', threw.slice(0, 200));
  env.run("safely('t', function(){ throw new Error('boom') })()");
  ck('C7 异常写进 #fErr 可见(不静默)', /boom/.test(env.$('fErr').textContent) && env.$('fErr').hidden === false, env.$('fErr').textContent.slice(0, 60));

  // ── 拖拽位移回写 / 视口变换 ──
  const store = rec.drags[0].getStoreItems();
  ck('dragStore 供 vendor 需要的全套字段',
     ['nodes', 'nodeLookup', 'edges', 'transform', 'nodeExtent', 'domNode', 'panBy', 'unselectNodesAndEdges', 'updateNodePositions', 'onError']
       .every(k => k in store), JSON.stringify(Object.keys(store)));
  const bx = env.get('FS.nodes.find(n => n.id === "n3").position.x');
  const nb0 = rec.bezier.length;
  store.updateNodePositions(new Map([['n3', { position: { x: bx + 50, y: 9 } }]]));
  ck('updateNodePositions 写回状态 + style + 重画边',
     env.get('FS.nodes.find(n => n.id === "n3").position.x') === bx + 50
     && querySelectorEl(env.rootEl, '.wfnode[data-nodeid="n3"]').style.left === (bx + 50) + 'px' && rec.bezier.length > nb0);
  // 1.2.49 根因守卫:applyDrag 原地改 position → vendor 的 adoptUserNodes(checkEquality=true)会沿用旧
  // internals → 下一次拖拽的基线仍是旧坐标(真机症状「拖拽节点会漂移」)。钉住"每次 syncLookup 后派生缓存
  // 必须等于真值"——桩里已忠实模拟 checkEquality,所以这条断言在漏刷新时会挂。
  env.run('FS.nodes.find(n => n.id === "n3").position = { x: 999, y: 888 }; flowRender()');
  const absN3 = JSON.parse(env.get('JSON.stringify(flookup.get("n3").internals.positionAbsolute)'));
  ck('syncLookup 把 positionAbsolute 刷成真值(原地改 position 后不得陈旧;1.2.49 拖拽漂移根因)',
     Math.abs(absN3.x - 999) < 0.01 && Math.abs(absN3.y - 888) < 0.01, JSON.stringify(absN3));
  env.run('FS.sel.add("n2"); refreshSel()');
  store.unselectNodesAndEdges();
  ck('unselectNodesAndEdges 清选择集与 .sel 类', env.get('FS.sel.size') === 0 && !/ sel/.test(String(querySelectorEl(env.rootEl, '.wfnode[data-nodeid="n2"]').attrs.class)));
  ck('panBy 交给 vendor 的是 async no-op(未暴露 API → 关 autoPan,不喂 undefined)',
     typeof store.panBy === 'function' && (await store.panBy(1, 2)) === false);
  const adopt0 = rec.adopt, bez0 = rec.bezier.length;
  rec.pz.onPanZoom(null, { x: 5, y: 6, zoom: 1.5 });
  ck('onPanZoom 只改一个 style(边与节点同在 viewport 层 → 变换零重绘)',
     /translate\(5px,6px\) scale\(1\.5\)/.test(String(env.$('fViewport').style.transform)), String(env.$('fViewport').style.transform));
  ck('平移缩放不重测不重绘(每帧重测 = 大画布掉帧的根源)', rec.adopt === adopt0 && rec.bezier.length === bez0);

  // ── 增删与键位 ──
  const n0 = env.get('FS.nodes.length');
  const idNew = String(env.get('flowAddNode("agent", { x: 40, y: 420 })'));
  ck('flowAddNode 发号 n\\d+ 并渲染出卡', /^n\d+$/.test(idNew) && env.get('FS.nodes.length') === n0 + 1 && !!env.$q(`.wfnode[data-nodeid="${idNew}"]`), idNew);
  ck('每类起止节点各一个(第二个 return 被拒并给可见提示)',
     env.get('flowAddNode("return", { x: 0, y: 0 })') === '' && /已存在/.test(env.$('fErr').textContent));
  env.run('FS.sel.clear(); FS.sel.add("' + idNew + '"); refreshSel()');
  const en0 = env.get('FS.edges.length');
  env.run('flowKeydown({ key: "Delete", preventDefault: function(){} })');
  ck('Del 删除选中节点(连带其边)', !env.get('FS.nodes.some(n => n.id === "' + idNew + '")'));
  ck('删除后不再有指向它的边', env.get('FS.edges.every(e => e.source !== "' + idNew + '" && e.target !== "' + idNew + '")'));
  ck('删边数与节点相关(级联清边)', env.get('FS.edges.length') <= en0);
  ck('焦点在输入框时 Del 不删(让位给文本编辑)', (function () {
    const b2 = env.get('FS.nodes.length');
    env.run('FS.sel.add(FS.nodes[0].id)');
    (env.doc as any).activeElement = { tagName: 'TEXTAREA' };
    env.run('flowKeydown({ key: "Delete", preventDefault: function(){} })');
    (env.doc as any).activeElement = null;
    return env.get('FS.nodes.length') === b2;
  })());
  env.run('flowKeydown({ key: "s", metaKey: true, preventDefault: function(){ window.__pd = 1 } })');
  await env.flush(20);
  ck('⌘/Ctrl+S = 保存草稿且抢下浏览器默认', env.get('window.__pd') === 1 && posts.length > 0);
  ck('点连线即删边', (function () {
    const b3 = env.get('FS.edges.length');
    const p = env.$qa('#fEdges path.e')[0];
    p.fire('click', {});
    return env.get('FS.edges.length') === b3 - 1;
  })());
  env.run('flowKeydown({ key: "Escape", preventDefault: function(){} })');
  ck('Esc 关闭编辑器', env.$('flow').hidden === true && env.get('flowVisible') === false);
  env.run('void openFlow("/work/fix")');
  await env.flush(20);
  ck('重开编辑器不重复建画布(XYPanZoom 单实例,接线只一次)', rec.pzCount === 1 && env.get('flowVisible') === true);
  // 拖拽创建(用户要的"通过拖拽的方式创建 workflow"):dragstart 带类型 → drop 落点建节点,坐标要过视口变换
  ck('拖拽创建:组件拖到画布落点即建节点(按平移+缩放反算坐标)', (function () {
    const pal = querySelectorEl(env.rootEl, '#fPalette .pal[data-t="agent"]'), pane = env.$('fPane');
    pane._rect = { top: 100, bottom: 700, left: 200, right: 1200, height: 600 };
    const store: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] || '' };
    pal.fire('dragstart', { dataTransfer: dt });
    env.run('FS.view = { x: 30, y: 20, zoom: 2 }');
    const before = Number(env.get('FS.nodes.length'));
    pane.fire('dragover', { preventDefault: () => {} });
    pane.fire('drop', { preventDefault: () => {}, dataTransfer: dt, clientX: 430, clientY: 220 });
    const last = JSON.parse(env.get('JSON.stringify(FS.nodes[FS.nodes.length - 1].position)'));
    const okDrop = Number(env.get('FS.nodes.length')) === before + 1 && last.x === (430 - 200 - 30) / 2 && last.y === (220 - 100 - 20) / 2;
    const stillThere = !!env.$q(`.wfnode[data-nodeid="${String(env.get('FS.nodes[FS.nodes.length-1].id'))}"]`);
    env.run('flowRemoveNode(FS.nodes[FS.nodes.length - 1].id); FS.view = { x: 20, y: 10, zoom: 1 }');   // 复原,别污染后续断言
    return store['text/plain'] === 'agent' && okDrop && stillThere;
  })());

  // ── 生成器:§6 语义映射表逐行对案(在编辑器已打开的 env 里直接调纯函数,零 DOM)──
  const G = (ns: any[], es: any[], extra: any = {}) => env.get('flowGenerate(' + JSON.stringify(dft(ns, es, extra)) + ')') as string;
  const V = (ns: any[], es: any[], extra: any = {}) => env.get('JSON.stringify(flowValidate(' + JSON.stringify(dft(ns, es, extra)) + '))') as string;
  const lit = (js: string, vars: Record<string, string> = {}): string => {
    const m = /agent\((`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*")/.exec(js);
    const keys = Object.keys(vars);
    return String(new Function(...keys, 'return (' + (m ? m[1] : '""') + ')')(...keys.map(k => vars[k])));
  };
  const chain = G(CHAIN.nodes, CHAIN.edges);
  ck('gen/链式 = 顺序 await,无 parallel',
     chain.includes('const n2 = await agent(') && chain.includes('const n3 = await agent(') && !chain.includes('parallel('), chain);
  ck('gen/meta 纯字面量 + phases 与 phase() 一一对应(首现去重)',
     /export const meta = \{\n  name: "demo",\n  description: "d",\n  phases: \[\{ title: "P1" \}, \{ title: "P2" \}\],\n\}/.test(chain)
     && (chain.match(/^phase\("/gm) || []).length === 2, chain.split('\n').slice(3, 9).join('\n'));
  ck('gen/start 提供 args 入口 Q(空 note → 空串兜底)',
     chain.includes("const Q = (typeof args === 'string' && args.trim()) || \"输入\""), chain);
  ck('gen/{{nX}} → ${nX};引用 start → ${Q}', lit(chain, { Q: '输入' }) === '第一步 输入', lit(chain, { Q: '输入' }));
  ck('gen/{{start}} 别名同样插到 Q',
     lit(G([N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'agent', 1, 0, { label: 'A', prompt: 'X {{start}}' }), N('n3', 'return', 2, 0, { ret: '' })],
       [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')]), { Q: 'QQ' }) === 'X QQ');
  ck('gen/return 表达式原样落盘', chain.trim().endsWith('return { r: n3 }'), chain.slice(-40));
  ck('gen/产物不含 Date.now / Math.random(沙箱禁用且破 resume)', !/Date\.now|Math\.random|new Date\(\)/.test(chain));
  ck('gen/首行注明目标项目与用法(可看全:绝对路径由后端返回)', /^\/\/ 由 Lucid 编排器生成 —— 目标项目: \/work\/fix$/m.test(chain), chain.split('\n')[0]);
  const fan = G(FAN.nodes, FAN.edges);
  ck('gen/层内多 agent → parallel 栅栏,每个带 opts.phase(防全局 phase 竞争)',
     fan.includes('const [n3, n4] = await parallel([')
     && /\(\) => agent\(`b1 \$\{n2\}`, \{ label: "B1", phase: "P2" \}\),/.test(fan)
     && /\(\) => agent\(`b2 \$\{n2\}`, \{ label: "B2", phase: "P2", model: "sonnet", schema: SCHEMA_n4 \}\),/.test(fan), fan);
  ck('gen/schemaText → 顶部 SCHEMA 常量(在 async 体外,合法 JS)', /^const SCHEMA_n4 = \{"type":"object"/m.test(fan), fan.split('\n').slice(7, 9).join('\n'));
  ck('gen/汇聚节点在下一层单 await(多入边 = 栅栏而非流水线)',
     /const n5 = await agent\(`汇 \$\{n3\} \$\{n4\}`, \{ label: "C", phase: "P3" \}\)/.test(fan), fan);
  ck('gen/return 空 → 兜底"最后一个含 agent 的层"(末层是 Return 时不得输出空 results)',
     fan.includes('return { results: [n5].filter(Boolean) }'), fan.slice(-60));
  ck('gen/兜底对链式图同样取末个 agent 层',
     G([N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'agent', 1, 0, { label: 'A', prompt: 'a' }), N('n3', 'return', 2, 0, { ret: '' })],
       [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')]).includes('return { results: [n2].filter(Boolean) }'));
  ck('gen/多起点(两个入度 0 的 agent 与 start 同层)→ parallel',
     G([N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'agent', 1, 0, { label: 'X', phase: 'P', prompt: 'x' }),
        N('n3', 'agent', 1, 90, { label: 'Y', phase: 'P', prompt: 'y' }), N('n4', 'return', 2, 0, { ret: '' })],
       [E('e1', 'n2', 'n4'), E('e2', 'n3', 'n4'), E('e3', 'n1', 'n4')]).includes('const [n2, n3] = await parallel(['));
  const tricky = '路径 C:\\tmp `code` ${literal} 与 {{n1}}';
  const tjs = G([N('n1', 'start', 0, 0, { note: 'Q' }), N('n2', 'agent', 1, 0, { label: 'A', phase: 'P', prompt: tricky }), N('n3', 'return', 2, 0, { ret: '' })],
    [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')]);
  ck('gen/转义集 \\ ` ${ 全覆盖:求值 round-trip 等于原文(含未转义的 ${literal})',
     lit(tjs, { Q: 'Q' }) === tricky.replace('{{n1}}', 'Q'), JSON.stringify(lit(tjs, { Q: 'Q' })));
  ck('gen/单行无引用 → JSON 字符串;含换行 → 模板字面量',
     /agent\("第二步", \{ label: "B", phase: "P2" \}\)/.test(chain) && /agent\(`a\nb`/.test(G([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A', prompt: 'a\nb' }), N('n3', 'return', 2, 0)], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')])));
  ck('gen/flowMetaPhases 与脚本内 meta.phases 同一单点(预览与产物不漂移)',
     env.get('JSON.stringify(flowMetaPhases(' + JSON.stringify(dft(FAN.nodes, FAN.edges)) + '))') === '[{"title":"P1"},{"title":"P2"},{"title":"P3"}]'
     && fan.includes('phases: [{ title: "P1" }, { title: "P2" }, { title: "P3" }],'),
     String(env.get('JSON.stringify(flowMetaPhases(' + JSON.stringify(dft(FAN.nodes, FAN.edges)) + '))')));
  // 校验:结构 / 引用 / 载荷三类错误逐条对案
  ck('val/缺 Start', /缺 Start/.test(V(CHAIN.nodes.slice(1), CHAIN.edges.slice(1))));
  ck('val/缺 Return', /缺 Return/.test(V(CHAIN.nodes.slice(0, 3), CHAIN.edges.slice(0, 2))));
  ck('val/无执行步骤(纯 start/return)', /至少需要一个执行步骤/.test(V([N('n1', 'start', 0, 0), N('n2', 'return', 1, 0)], [])));
  ck('val/环:报错并列出成员', /环.*n2, n3/.test(V(CHAIN.nodes, [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e9', 'n3', 'n2'), E('e3', 'n3', 'n4')])),
     V(CHAIN.nodes, [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e9', 'n3', 'n2'), E('e3', 'n3', 'n4')]));
  ck('val/孤立节点(无任何连线)', /孤立.*n9/.test(V(CHAIN.nodes.concat([N('n9', 'agent', 9, 9, { label: 'orphan' })]), CHAIN.edges)));
  ck('val/引用不存在的节点', /不存在.*n7/.test(V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A', prompt: '{{n7}}' }), N('n3', 'return', 2, 0)], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')])));
  ck('val/引用下游节点(非上游)', /不是它的上游/.test(V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A', prompt: '{{n3}}' }),
     N('n3', 'agent', 2, 0, { label: 'B', prompt: '' }), N('n4', 'return', 3, 0, { ret: '' })], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4')])));
  ck('val/引用旁支(不可达)', /不是它的上游/.test(V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A', prompt: 'a' }),
     N('n3', 'agent', 2, 0, { label: 'B', prompt: '{{n9}}' }), N('n9', 'agent', 2, 90, { label: 'C', prompt: 'c' }), N('n4', 'return', 3, 0, { ret: '' })],
     [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n3', 'n4'), E('e9', 'n1', 'n9')])));
  ck('val/自引用', /自身/.test(V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A', prompt: '{{n2}}' }), N('n3', 'return', 2, 0)], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')])));
  ck('val/schema 非法 JSON', /schema 不是合法 JSON/.test(V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A', schemaText: '{bad' }), N('n3', 'return', 2, 0)], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')])));
  ck('val/schema 非对象(数组)', /需为 JSON 对象/.test(V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A', schemaText: '[1]' }), N('n3', 'return', 2, 0)], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')])));
  ck('val/model 白名单外', /不在白名单/.test(V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A', model: 'gpt-4' }), N('n3', 'return', 2, 0)], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')])));
  ck('val/model 空(inherit)与合法档放行',
     V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A', model: 'opus' }), N('n3', 'return', 2, 0)], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')]) === '[]');
  ck('val/两个 Start 报错', /至多一个/.test(V([N('n1', 'start', 0, 0), N('n9', 'start', 5, 5), N('n2', 'agent', 1, 0, { label: 'A' }), N('n3', 'return', 2, 0)], [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3')])));
  ck('val/合法图 = 空清单', V(CHAIN.nodes, CHAIN.edges) === '[]' && V(FAN.nodes, FAN.edges) === '[]', V(CHAIN.nodes, CHAIN.edges));
  ck('val/非法图时 flowGenerate 抛错而非出残码', (function () {
    try { env.get('flowGenerate(' + JSON.stringify(dft([N('n1', 'start', 0, 0)], [])) + ')'); return false; } catch { return true; }
  })());
  ck('val/自环连线明确报错(不许静默忽略后当没看见)',
     /自环.*n2 → n2/.test(V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A' }), N('n3', 'return', 2, 0)],
        [E('e1', 'n1', 'n2'), E('e2', 'n2', 'n3'), E('e3', 'n2', 'n2')])));
  ck('val/Start 未连任何步骤 = args 入口空转,单独报错',
     /Start 节点未连到任何步骤/.test(V([N('n1', 'start', 0, 0), N('n2', 'agent', 1, 0, { label: 'A' }), N('n3', 'return', 2, 0)],
        [E('e2', 'n2', 'n3')])));

  // ── 保存 / 回载 / 自动存 ──
  const env2 = mkEnv();
  await env2.flush();
  env2.run('void openFlow("/work/fix")');
  await env2.flush(20);
  ck('编辑即自动存盘:按项目键已写入(防误关)', env2.localStorage.getItem('wfo-flow-autosave-/work/fix') !== null
     && JSON.parse(String(env2.localStorage.getItem('wfo-flow-autosave-/work/fix'))).nodes.length === 7);
  env2.run('saveFlowDraft(false)');
  await env2.flush(20);
  const body = posts[posts.length - 1] || {};
  ck('保存:POST /api/draft/save 带 name/draft(v=2)/script/overwrite=false',
     body.name === 'demo-research' && body.draft && body.draft.v === 2
     && /^\/\/ 由 Lucid 编排器生成/m.test(String(body.script)) && /export const meta = \{/.test(String(body.script))
     && body.overwrite === false,
     JSON.stringify(Object.keys(body)));
  ck('保存:脚本 == 生成器产物(单一真相,服务端不重编译)', body.script === env2.get('flowGenerate(flowDraft())'));
  ck('保存成功 → 回显可复制的执行命令(绝对路径,防 ~ 展开坑)',
     env2.$('fRun').hidden === false && /Workflow\(\{ scriptPath: '\/home\/u\/\.claude\/cc-viewer\/drafts\/fix-abc123\/demo-research\.js', args: '<输入>' \}\)/.test(env2.$('fRunCmd').textContent),
     env2.$('fRunCmd').textContent);
  ck('显式保存成功后清掉自动存盘键(下次开编辑器不再问恢复)', env2.localStorage.getItem('wfo-flow-autosave-/work/fix') === null);
  saveResp = { ok: true, msg: '已保存', path: '/x/drafts/fix-abc123/demo-research-deadbeef.js', sha: 'deadbeef' };
  env2.run('saveFlowDraft(false)');
  await env2.flush(20);
  ck('同名异内容 → 后端并存,UI 亮出「覆盖原稿」(默认宁并存不覆盖)', env2.$('fOver').hidden === false && /并存/.test(env2.$('fNote').textContent));
  env2.run('saveFlowDraft(true)');
  await env2.flush(20);
  ck('点「覆盖原稿」→ overwrite=true', posts[posts.length - 1].overwrite === true);
  saveResp = { ok: false, msg: '名称非法:\'' };
  env2.run('saveFlowDraft(false)');
  await env2.flush(20);
  ck('后端拒绝时红字说明可见(不假装成功)', /名称非法/.test(env2.$('fNote').textContent));
  saveResp = { ok: true, msg: '已保存', path: '/x/drafts/fix-abc123/demo-research.js', sha: 'abc12345' };
  env2.run('FS.nodes = FS.nodes.filter(n => n.type !== "start")');
  const nb = posts.length;
  env2.run('saveFlowDraft(false)');
  await env2.flush(20);
  ck('存在错误时拒绝发请求(不往盘上丢非法草稿)+ 红条不裁',
     posts.length === nb && env2.$('fErr').hidden === false && /缺 Start/.test(env2.$('fErr').textContent));
  // 回载:有草稿 → 开空画布 + 下拉可载入;未知版本提示不猜
  const savedDraft = dft(CHAIN.nodes, CHAIN.edges, { name: 'loaded-one', desc: 'from server', next: 9 });
  draftsResp = { drafts: [{ name: 'loaded-one', meta: { name: 'loaded-one', desc: 'from server' }, mtime: 1, js: '/x/loaded-one.js', draft: savedDraft }] };
  const env3 = mkEnv();
  await env3.flush();
  env3.run('void openFlow("/work/fix")');
  await env3.flush(20);
  ck('后端已有草稿时不硬塞示例(开空画布并列出草稿)', env3.get('FS.nodes.length') === 0 && /loaded-one/.test(env3.$('fDraft').innerHTML));
  env3.run('(function(){const s=document.getElementById("fDraft");s.value="loaded-one";s.onchange({target:s})})()');
  await env3.flush(10);
  ck('载入草稿 → 图被替换为后端内容(回载再编辑)', env3.get('FS.nodes.length') === 4 && env3.get('FS.name') === 'loaded-one');
  ck('载入后发号器只前进(不与旧 id 撞车)', env3.get('FS.next') >= 10, String(env3.get('FS.next')));
  ck('载入后脚本预览与新图一致', /loaded-one/.test(env3.$('fScript').textContent) && /const n2 = await agent\(/.test(env3.$('fScript').textContent));
  ck('载入后头部输入框同步(名字/描述可见可改)', env3.$('fName').value === 'loaded-one' && env3.$('fDesc').value === 'from server');
  draftsResp = { drafts: [{ name: 'v9', meta: { name: 'v9' }, mtime: 1, js: '/x/v9.js', draft: { v: 9, name: 'v9', nodes: [], edges: [] } }] };
  const env4 = mkEnv();
  await env4.flush();
  env4.run('void openFlow("/work/fix")');
  await env4.flush(20);
  env4.run('(function(){const s=document.getElementById("fDraft");s.value="v9";s.onchange({target:s})})()');
  ck('未知草稿版本 → 提示不猜(§3.1 规则:图状态保持原样,不做猜测性读取)',
     /未知草稿版本/.test(env4.$('fNote').textContent) && env4.get('FS.nodes.length') === 0 && env4.get('FS.name') === '',
     env4.$('fNote').textContent);
  // ── 草稿 v2(1.2.50 · Phase 1):whenToUse 头部输入 + 阶段带可编辑(title/detail)+ 双端版本判定同改 ──
  // 为什么两件事同一相位:v2 是"持久化 + 载入"两层的最小切片,漏改任一端就是"存了却看不见"(1.2.35 类)。
  draftsResp = { drafts: [] };
  const envV = mkEnv();
  await envV.flush();
  envV.run('void openFlow("/work/fix")');
  await envV.flush(30);
  ck('v2/头部有 whenToUse 输入框(meta.whenToUse 的唯一入口)', !!envV.$('fWhen'));
  const wIn = envV.$('fWhen');
  wIn.value = '需要并行审计多个路由时';
  wIn.oninput!({ target: wIn });
  await envV.flush(4);
  ck('v2/输入 whenToUse → 脚本 meta 立即出现该字段',
     /whenToUse: "需要并行审计多个路由时"/.test(envV.$('fScript').textContent), envV.$('fScript').textContent.slice(0, 160));
  ck('v2/flowDraft() 出 v=2 且带 whenToUse(保存载荷即 v2)',
     envV.get('flowDraft().v') === 2 && envV.get('flowDraft().whenToUse') === '需要并行审计多个路由时',
     String(envV.get('JSON.stringify({v: flowDraft().v, w: flowDraft().whenToUse})')));
  // 阶段带:留空 → 推导三枚;编辑标题 → 物化为显式(推导 → 用户顺序)
  const chips0 = envV.$qa('#fPhases .ph');
  ck('v2/阶段带留空时按推导渲染三枚芯片(Scope/Search/Verify)',
     chips0.length === 3 && chips0[0].querySelector('input.ph-t')!.value === 'Scope'
     && chips0[2].querySelector('input.ph-t')!.value === 'Verify',
     JSON.stringify(chips0.map(c => c.querySelector('input.ph-t')!.value)));
  ck('v2/阶段芯片 = 标题输入 + 说明输入(可编辑,不是只读文本)',
     !!chips0[0].querySelector('input.ph-t') && !!chips0[0].querySelector('input.ph-d'));
  const t0 = querySelectorEl(envV.rootEl, '#fPhases .ph input.ph-t');
  t0.value = '扫描';
  t0.fire('input', { target: t0 });
  await envV.flush(4);
  ck('v2/编辑标题 → FS.phases 物化(推导转显式)且脚本 meta.phases 跟着变',
     envV.get('JSON.stringify(flowDraft().phases)') === '[{"title":"扫描","detail":""},{"title":"Search","detail":""},{"title":"Verify","detail":""}]'
     && /phases: \[\{ title: "扫描" \}, \{ title: "Search" \}, \{ title: "Verify" \}\]/.test(envV.$('fScript').textContent),
     String(envV.get('JSON.stringify(flowDraft().phases)')) + ' | ' + envV.$('fScript').textContent.slice(0, 200));
  ck('v2/编辑阶段带不重建该带(逐键重绘 = 焦点每键丢一次)', envV.$qa('#fPhases .ph input.ph-t')[0] === t0);
  const d0 = querySelectorEl(envV.rootEl, '#fPhases .ph input.ph-d');
  d0.value = '每文件一个审计代理';
  d0.fire('input', { target: d0 });
  await envV.flush(4);
  ck('v2/编辑说明 → detail 落到 meta.phases(逐字)',
     /phases: \[\{ title: "扫描", detail: "每文件一个审计代理" \}/.test(envV.$('fScript').textContent),
     envV.$('fScript').textContent.slice(0, 220));
  ck('v2/阶段带编辑即时自动存盘(防误关丢 whenToUse/phases)',
     JSON.parse(String(envV.localStorage.getItem('wfo-flow-autosave-/work/fix'))).phases[0].title === '扫描');
  // 保存载荷带 v2 全字段
  envV.run('saveFlowDraft(false)');
  await envV.flush(20);
  const vbody = posts[posts.length - 1] || {};
  ck('v2/保存载荷 = v2 全字段(whenToUse + phases[].title/detail)',
     vbody.draft && vbody.draft.v === 2 && vbody.draft.whenToUse === '需要并行审计多个路由时'
     && JSON.stringify(vbody.draft.phases) === '[{"title":"扫描","detail":"每文件一个审计代理"},{"title":"Search","detail":""},{"title":"Verify","detail":""}]',
     JSON.stringify(vbody.draft && vbody.draft.phases));
  // 回载:v2 草稿 → 头部 + 阶段带逐字还原
  const v2draft = dft(CHAIN.nodes, CHAIN.edges, { v: 2, name: 'v2-one', whenToUse: '只在需要审计时', phases: [{ title: '扫描', detail: '每文件一个' }, { title: '汇总' }] });
  draftsResp = { drafts: [{ name: 'v2-one', meta: { name: 'v2-one' }, mtime: 1, js: '/x/v2-one.js', draft: v2draft }] };
  const envV2 = mkEnv();
  await envV2.flush();
  envV2.run('void openFlow("/work/fix")');
  await envV2.flush(20);
  envV2.run('(function(){const s=document.getElementById("fDraft");s.value="v2-one";s.onchange({target:s})})()');
  await envV2.flush(10);
  ck('v2/回载:v=2 草稿被接受且 whenToUse 逐字还原到头部',
     envV2.get('FS.name') === 'v2-one' && envV2.$('fWhen').value === '只在需要审计时', envV2.$('fWhen').value);
  ck('v2/回载:阶段带按显式清单还原(title + detail 逐字)',
     envV2.get('JSON.stringify(FS.phases)') === '[{"title":"扫描","detail":"每文件一个"},{"title":"汇总","detail":""}]'
     && envV2.$qa('#fPhases .ph input.ph-t').map(e => e.value).join(',') === '扫描,汇总'
     && envV2.$qa('#fPhases .ph input.ph-d').map(e => e.value).join(',') === '每文件一个,',
     envV2.get('JSON.stringify(FS.phases)') + ' | ' + envV2.$qa('#fPhases .ph input.ph-t').map(e => e.value).join(','));
  ck('v2/回载后生成脚本与 UI 逐字一致', /whenToUse: "只在需要审计时"/.test(envV2.$('fScript').textContent)
     && /phases: \[\{ title: "扫描", detail: "每文件一个" \}, \{ title: "汇总" \}\]/.test(envV2.$('fScript').textContent),
     envV2.$('fScript').textContent.slice(0, 240));
  // v1 兼容:老草稿原样载入,新字段缺省为空(不塞默认值 = 不改变既有产物)
  draftsResp = { drafts: [{ name: 'v1-one', meta: { name: 'v1-one' }, mtime: 1, js: '/x/v1-one.js', draft: dft(CHAIN.nodes, CHAIN.edges, { name: 'v1-one' }) }] };
  const envV1 = mkEnv();
  await envV1.flush();
  envV1.run('void openFlow("/work/fix")');
  await envV1.flush(20);
  envV1.run('(function(){const s=document.getElementById("fDraft");s.value="v1-one";s.onchange({target:s})})()');
  await envV1.flush(10);
  ck('v1/v=1 老草稿原样载入,whenToUse/phases 缺省为空(不猜不塞)',
     envV1.get('FS.name') === 'v1-one' && envV1.$('fWhen').value === '' && envV1.get('FS.phases.length') === 0,
     envV1.get('JSON.stringify({n: FS.name, w: FS.whenToUse, p: FS.phases})'));
  ck('v1/载入后产物与旧版一致(meta 无 whenToUse,phases 走推导)',
     !/whenToUse/.test(envV1.$('fScript').textContent) && /phases: \[\{ title: "P1" \}, \{ title: "P2" \}\]/.test(envV1.$('fScript').textContent),
     envV1.$('fScript').textContent.slice(0, 200));
  // 未知版本仍拒绝且状态不动(只加宽 v1→v2,不放松"未知不猜")
  draftsResp = { drafts: [{ name: 'v3', meta: { name: 'v3' }, mtime: 1, js: '/x/v3.js', draft: { v: 3, name: 'v3', nodes: [], edges: [] } }] };
  const envV3 = mkEnv();
  await envV3.flush();
  envV3.run('void openFlow("/work/fix")');
  await envV3.flush(20);
  envV3.run('(function(){const s=document.getElementById("fDraft");s.value="v3";s.onchange({target:s})})()');
  ck('v3/未知版本(v=3)拒绝并给可读提示,图状态不动',
     /未知草稿版本/.test(envV3.$('fNote').textContent) && envV3.get('FS.nodes.length') === 0 && envV3.get('FS.name') === '',
     envV3.$('fNote').textContent);

  // ── args 契约面板(1.2.51 · Phase 2):schema 文本 + 示例 JSON + 必填开关 → 生成前置校验块 ──
  draftsResp = { drafts: [] };                       // 清掉上面 v3 案的夹具,否则开编辑器时走"有草稿→空画布"分支
  const envA = mkEnv();
  await envA.flush();
  envA.run('void openFlow("/work/fix")');
  await envA.flush(30);
  ck('args 面板三件套在(根须 schema 文本 / 示例 JSON / 必填开关)',
     !!envA.$('fArgS') && !!envA.$('fArgE') && !!envA.$('fArgR'),
     JSON.stringify([!!envA.$('fArgS'), !!envA.$('fArgE'), !!envA.$('fArgR')]));
  const aS = envA.$('fArgS'), aE = envA.$('fArgE'), aR = envA.$('fArgR');
  aS.value = '{"type":"object","properties":{"paths":{"type":"array"}},"required":["paths"]}';
  aS.oninput!({ target: aS });
  aR.checked = true;
  aR.onchange!({ target: aR });
  aE.value = '{"paths":["a.ts"]}';
  aE.oninput!({ target: aE });
  await envA.flush(4);
  ck('args/填 schema + 勾必填 → 脚本出现解析块与前置校验块',
     /const ARGS = \(typeof args === 'string'\) \? JSON\.parse\(args\) : args/.test(envA.$('fScript').textContent)
     && /args 缺少字段:paths/.test(envA.$('fScript').textContent), envA.$('fScript').textContent.slice(0, 200));
  ck('args/flowDraft() 出 argsSpec 三字段(持久化面)',
     envA.get('JSON.stringify(flowDraft().argsSpec)') === '{"schemaText":"{\\"type\\":\\"object\\",\\"properties\\":{\\"paths\\":{\\"type\\":\\"array\\"}},\\"required\\":[\\"paths\\"]}","exampleText":"{\\"paths\\":[\\"a.ts\\"]}","required":true}',
     envA.get('JSON.stringify(flowDraft().argsSpec)'));
  ck('args/编辑即时自动存盘(防误关丢 argsSpec)',
     JSON.parse(String(envA.localStorage.getItem('wfo-flow-autosave-/work/fix'))).argsSpec.required === true);
  aE.value = '{bad';
  aE.oninput!({ target: aE });
  await envA.flush(4);
  ck('args/非法示例 JSON → 内联报错且不出码',
     /args 示例不是合法 JSON/.test(envA.$('fErr').textContent) && /存在错误,无法生成/.test(envA.$('fScript').textContent),
     envA.$('fErr').textContent.slice(0, 120));
  const nbA = posts.length;
  envA.run('saveFlowDraft(false)');
  await envA.flush(20);
  ck('args/非法时不发保存请求(不往盘上丢坏草稿)', posts.length === nbA, String(posts.length - nbA));
  aE.value = '{"paths":["a.ts"]}';
  aE.oninput!({ target: aE });
  await envA.flush(4);
  envA.run('saveFlowDraft(false)');
  await envA.flush(20);
  const abody = posts[posts.length - 1] || {};
  ck('args/保存载荷带 argsSpec(schemaText/exampleText/required 逐字)',
     abody.draft && abody.draft.argsSpec && abody.draft.argsSpec.required === true
     && /"paths"/.test(abody.draft.argsSpec.schemaText) && abody.draft.argsSpec.exampleText === '{"paths":["a.ts"]}',
     JSON.stringify(abody.draft && abody.draft.argsSpec));
  // 回载:argsSpec 逐字还原到面板
  draftsResp = { drafts: [{ name: 'args-one', meta: { name: 'args-one' }, mtime: 1, js: '/x/args-one.js',
    draft: dft(CHAIN.nodes, CHAIN.edges, { name: 'args-one', argsSpec: { schemaText: '{"type":"object","properties":{"x":{}},"required":["x"]}', exampleText: '{"x":1}', required: true } }) }] };
  const envA2 = mkEnv();
  await envA2.flush();
  envA2.run('void openFlow("/work/fix")');
  await envA2.flush(20);
  envA2.run('(function(){const s=document.getElementById("fDraft");s.value="args-one";s.onchange({target:s})})()');
  await envA2.flush(10);
  ck('args/回载:面板三字段逐字还原',
     envA2.$('fArgS').value === '{"type":"object","properties":{"x":{}},"required":["x"]}'
     && envA2.$('fArgE').value === '{"x":1}' && envA2.$('fArgR').checked === true,
     JSON.stringify([envA2.$('fArgS').value, envA2.$('fArgE').value, envA2.$('fArgR').checked]));
  ck('args/回载后脚本与面板一致(生成器读的是同一份 argsSpec)',
     /args 缺少字段:x/.test(envA2.$('fScript').textContent) && envA2.$('fErr').hidden === true);
  // ── 运行与分发命令区(1.2.52 · Phase 3):首次 / 恢复 / 分发三条 + 边界文案(写边界不撒谎)──
  draftsResp = { drafts: [] };
  saveResp = { ok: true, msg: '已保存', path: '/home/u/.claude/cc-viewer/drafts/fix-abc123/demo-research.js', sha: 'abc12345' };
  const envC = mkEnv();
  await envC.flush();
  envC.run('void openFlow("/work/fix")');
  await envC.flush(30);
  const cS = envC.$('fArgS'), cE = envC.$('fArgE');
  cS.value = '{"type":"object","properties":{"paths":{"type":"array"}},"required":["paths"]}';
  cS.oninput!({ target: cS });
  cE.value = '{"paths":["a.ts"]}';
  cE.oninput!({ target: cE });
  envC.run('saveFlowDraft(false)');
  await envC.flush(20);
  const P = '/home/u/.claude/cc-viewer/drafts/fix-abc123/demo-research.js';
  ck('命令区三条命令齐(首次 / 恢复 / 分发)',
     envC.$('fRun').hidden === false && !!envC.$('fRunCmd') && !!envC.$('fCmdResume') && !!envC.$('fCmdDist'),
     JSON.stringify([envC.$('fRun').hidden, !!envC.$('fRunCmd'), !!envC.$('fCmdResume'), !!envC.$('fCmdDist')]));
  ck('首次命令 = Workflow({ scriptPath: 绝对路径, args: 示例 })',
     envC.$('fRunCmd').textContent === `Workflow({ scriptPath: '${P}', args: {"paths":["a.ts"]} })`,
     envC.$('fRunCmd').textContent);
  ck('恢复命令附 resumeFromRunId 占位且与首次同 scriptPath',
     /resumeFromRunId: 'wf_…'/.test(envC.$('fCmdResume').textContent) && envC.$('fCmdResume').textContent.indexOf(P) > 0,
     envC.$('fCmdResume').textContent);
  ck('分发命令给出项目与个人两处 cp 目标(个人用 $HOME——单引号会掐掉 ~ 展开)',
     new RegExp('cp \'' + P + '\' \'/work/fix/\\.claude/workflows/demo-research\\.js\'').test(envC.$('fCmdDist').textContent)
     && /cp '.*' "\$HOME\/\.claude\/workflows\/demo-research\.js"/.test(envC.$('fCmdDist').textContent),
     envC.$('fCmdDist').textContent);
  ck('首次/恢复命令不含任何写 .claude/workflows 的动作(分发是用户手动的 cp,不是服务写盘)',
     !/\.claude\/workflows/.test(envC.$('fRunCmd').textContent) && !/\.claude\/workflows/.test(envC.$('fCmdResume').textContent));
  ck('命令区写明写边界与服务不做控制面(服务只写 cc-viewer/,执行/恢复/停止在终端 /workflows)',
     /cc-viewer/.test(envC.$('fRunNote').textContent) && /\/workflows/.test(envC.$('fRunNote').textContent)
     && /仅同会话|同一会话/.test(envC.$('fRunNote').textContent), envC.$('fRunNote').textContent.slice(0, 200));
  envC.$('fCopyCmd').onclick!({});
  await envC.flush(3);
  ck('一键复制首条命令(复用 copyText)', envC.clipboard[envC.clipboard.length - 1] === envC.$('fRunCmd').textContent,
     String(envC.clipboard[envC.clipboard.length - 1]).slice(0, 60));
  envC.$('fCopyResume').onclick!({});
  envC.$('fCopyDist').onclick!({});
  await envC.flush(3);
  ck('恢复/分发命令同样一键复制(三条各自独立按钮)',
     envC.clipboard[envC.clipboard.length - 2] === envC.$('fCmdResume').textContent
     && envC.clipboard[envC.clipboard.length - 1] === envC.$('fCmdDist').textContent);
  // ── 保存即分发(1.2.59):后端把执行件写进项目 .claude/workflows/ 时,界面要说清楚 ──
  saveResp = { ok: true, msg: '已保存', path: P, sha: 'abc12345', wfPath: '/work/fix/.claude/workflows/demo-research.js', wfErr: '' };
  envC.run('saveFlowDraft(false)');
  await envC.flush(20);
  ck('保存即分发/成功 → 状态行写明"已写入项目 workflow"及绝对路径',
     /已写入项目 workflow/.test(envC.$('fNote').textContent) && /\/work\/fix\/\.claude\/workflows\/demo-research\.js/.test(envC.$('fNote').textContent),
     envC.$('fNote').textContent);
  ck('保存即分发/命令区只剩个人位置 cp(项目那份已自动写好,不重复给命令)',
     envC.$('fCmdDist').textContent.indexOf('/work/fix/.claude/workflows') < 0 && /\$HOME/.test(envC.$('fCmdDist').textContent),
     envC.$('fCmdDist').textContent);
  saveResp = { ok: true, msg: '已保存', path: P, sha: 'abc12345', wfPath: '', wfErr: '拒绝写入:项目下 .claude 或 .claude/workflows 是软链' };
  envC.run('saveFlowDraft(false)');
  await envC.flush(20);
  ck('保存即分发/失败 → 红字说明原因(草稿本身仍算保存成功)',
     /未写入|软链/.test(envC.$('fNote').textContent) && envC.$('fNote').style.color === 'var(--rd)', envC.$('fNote').textContent);
  ck('保存即分发/失败时命令区恢复给两条 cp(回落到手动分发)', /\/work\/fix\/\.claude\/workflows/.test(envC.$('fCmdDist').textContent),
     envC.$('fCmdDist').textContent);
  saveResp = { ok: true, msg: '已保存', path: P, sha: 'abc12345' };
  envC.run('saveFlowDraft(false)');
  await envC.flush(20);
  envC.run("document.getElementById('langsel').value='en'; document.getElementById('langsel').onchange({target:{value:'en'}});");
  await envC.flush();
  ck('切语言后命令区文案同步刷新(动态拼接的标签与说明也走 T())',
     !/[一-鿿]/.test(envC.$('fRun').textContent) && /first run|Resume|Distribute/i.test(envC.$('fRun').textContent),
     envC.$('fRun').textContent.slice(0, 200));
  ck('切语言不丢命令内容(scriptPath 是数据,不参与翻译)', envC.$('fRunCmd').textContent.indexOf(P) > 0);

  draftsResp = { drafts: [] };
  const autoKey = 'wfo-flow-autosave-/work/fix';
  const autoVal = JSON.stringify(dft(FAN.nodes, FAN.edges, { name: 'recovered' }));
  const env5 = mkEnv({ [autoKey]: autoVal }, true);
  await env5.flush();
  env5.run('void openFlow("/work/fix")');
  await env5.flush(30);
  ck('误关后有自动存盘 → confirm 则恢复(不静默塞示例)', env5.get('FS.name') === 'recovered' && env5.get('FS.nodes.length') === 6, env5.get('FS.name'));
  const env6 = mkEnv({ [autoKey]: autoVal }, false);
  await env6.flush();
  env6.run('void openFlow("/work/fix")');
  await env6.flush(30);
  ck('拒绝恢复 → 回到起手示例(尊重用户选择)', env6.get('FS.name') === 'demo-research' && env6.get('FS.nodes.length') === 7);
  const env7 = mkEnv();
  await env7.flush();
  env7.run('void openFlow("")');
  await env7.flush(20);
  // 1.2.44 口径变更:编排按项目,空 cwd **不开编辑器**(旧行为"空项目也开、键落 __no_cwd__"是错的,已废)
  ck('空 cwd 不开编辑器,也不留 __no_cwd__ 自动存盘键',
     env7.$('flow').hidden === true && env7.localStorage.getItem('wfo-flow-autosave-__no_cwd__') === null,
     String(env7.$('flow').hidden));
  env7.run('void openFlow("/work/fix")');
  await env7.flush(20);
  ck('开编辑器时顶栏显示的就是那个项目(不再有「未选项目」占位口径)',
     env7.$('fCwd').textContent === '/work/fix' && !/未选项目/.test(env7.$('fCwd').textContent), env7.$('fCwd').textContent);
  ck('自动存盘键按项目落点(与后端 drafts/<slug> 同一"项目"概念)',
     env7.localStorage.getItem('wfo-flow-autosave-/work/fix') !== null);

  // ── 执行件可跑性:拿沙箱替身(agent/parallel/phase/args)真跑一遍生成脚本 ──
  // 为什么值得跑:前面全是"文本求值"级别的断言,而 .js 是要被 Workflow 工具执行的产物——
  // 转义漏一个字符、phase 顺序错、parallel 少个 opts.phase,只有**跑起来**才暴露(比人工终端闭环便宜且不烧 token)。
  async function runJs(js: string, args: unknown): Promise<{ phases: string[]; calls: { prompt: string; opts: any }[]; ret: any }> {
    const stripped = js.replace('export const meta', 'const meta');
    const phases: string[] = [], calls: { prompt: string; opts: any }[] = [];
    const agent = async (prompt: string, opts: any): Promise<string> => { calls.push({ prompt, opts }); return 'R(' + String((opts && opts.label) || '?') + ')'; };
    const parallel = async (thunks: any[]): Promise<any[]> => Promise.all(thunks.map(t => t()));
    const phase = (t: string): void => { phases.push(t); };
    const fn = new Function('args', 'phase', 'agent', 'parallel', 'log', 'return (async () => {' + stripped + '})()');
    return { phases, calls, ret: await fn(args, phase, agent, parallel, () => {}) };
  }
  const metaBlock = (js: string): string => (/export const meta = \{[\s\S]*?\n\}/.exec(js) || [''])[0];
  ck('run/meta 纯字面量(无插值/无调用/无 await——沙箱硬要求)',
     !/`|args|\bawait\b|=>|\bMath\b/.test(metaBlock(chain)) && metaBlock(chain).startsWith('export const meta = {'), metaBlock(chain));
  const r1 = await runJs(chain, '我的题');
  ck('run/链式按序跑两个 agent,phase 序列 = P1,P2',
     r1.calls.length === 2 && r1.phases.join(',') === 'P1,P2' && r1.calls[0].opts.label === 'A' && r1.calls[1].opts.label === 'B',
     JSON.stringify({ p: r1.phases, c: r1.calls.map(c => c.opts.label) }));
  ck('run/args 注入 start 入口(占位符真的插进了运行时)', r1.calls[0].prompt === '第一步 我的题', r1.calls[0].prompt);
  ck('run/链式产物 = return 表达式所写', JSON.stringify(r1.ret) === '{"r":"R(B)"}', JSON.stringify(r1.ret));
  const r1b = await runJs(chain, '   ');
  ck('run/args 空串 → 回落 Start 说明作默认输入', r1b.calls[0].prompt === '第一步 输入', r1b.calls[0].prompt);
  const r2 = await runJs(fan, 'Q');
  ck('run/每个 agent 都带自己的 phase(1.2.56 起单节点层也发;并行层更要发——防全局 phase 竞争)',
     r2.calls.length === 4 && r2.calls[1].opts.phase === 'P2' && r2.calls[2].opts.phase === 'P2'
     && r2.calls[0].opts.phase === 'P1' && r2.calls[3].opts.phase === 'P3',
     JSON.stringify(r2.calls.map(c => [c.opts.label, c.opts.phase])));
  ck('run/汇聚步拿到的是两个并行分支的返回值', /R\(B1\)[\s\S]*R\(B2\)/.test(r2.calls[3].prompt), r2.calls[3].prompt);
  ck('run/schema 传入对象(非字符串),model 生效', typeof r2.calls[2].opts.schema === 'object' && r2.calls[2].opts.model === 'sonnet',
     JSON.stringify(r2.calls[2].opts));
  ck('run/兜底 return 给出末层结果数组(agent 可能返回 null → filter(Boolean))',
     JSON.stringify(r2.ret) === '{"results":["R(C)"]}', JSON.stringify(r2.ret));
  ck('run/顺序阶段的 agent 也带 phase(1.2.56 口径变更:phase 恒发,不再只靠全局 phase())',
     r2.calls[3].opts.phase === 'P3');
  // 末层两条并行分支 + 空 return → 兜底必须 filter(Boolean)(技能明训:被跳过/挂掉的 agent 返回 null)
  const PAIR = {
    nodes: [N('n1', 'start', 0, 0, { note: 'q' }), N('n2', 'agent', 200, -60, { label: 'A', phase: 'P', prompt: 'a' }),
      N('n3', 'agent', 200, 60, { label: 'B', phase: 'P', prompt: 'b' }), N('n4', 'return', 400, 0, { ret: '' })],
    edges: [E('e1', 'n1', 'n2'), E('e2', 'n1', 'n3'), E('e3', 'n2', 'n4'), E('e4', 'n3', 'n4')],
  };
  ck('run/末层分支返回 null 不炸图,兜底 results 只留有值的(null 被 filter 掉)', (async () => {
    const js3 = G(PAIR.nodes, PAIR.edges);
    const stripped = js3.replace('export const meta', 'const meta');
    const fn = new Function('args', 'phase', 'agent', 'parallel', 'log', 'return (async () => {' + stripped + '})()');
    const ret = await fn('q', () => {}, async (p: string, o: any) => (o && o.label === 'B' ? null : 'OK-A'), async (ts: any[]) => Promise.all(ts.map(x => x())), () => {});
    return JSON.stringify(ret) === '{"results":["OK-A"]}';
  })());

  // ── 与轮询 / 语言共存(item 12/13)──
  const envL = mkEnv();
  await envL.flush();
  envL.run('void tick()');
  await envL.flush();
  envL.run('void openFlow("/work/fix")');
  await envL.flush(20);
  const nB = envL.get('FS.nodes.length');
  envL.run("document.getElementById('langsel').value='en'; document.getElementById('langsel').onchange({target:{value:'en'}});");
  await envL.flush();
  ck('setLang 后编辑器静态文案转英', /Compose Workflow/.test(visibleText(envL.$('flow'))) && envL.$('btnFlow').textContent === '✦ Compose', envL.$('btnFlow').textContent);
  ck('setLang 不清图状态(FS 不被误清)', envL.get('FS.nodes.length') === nB && envL.get('flowVisible') === true);
  ck('外壳文案零汉字(节点卡内 prompt 是用户数据,不参与翻译)',
     ((visibleText(envL.$('fPalette')) + String(envL.$q('.flow-head') ? visibleText(envL.$q('.flow-head') as any) : '')).match(/[一-鿿]/g) || []).length === 0,
     ((visibleText(envL.$('fPalette')) + visibleText(envL.$q('.flow-head') as any)).match(/[一-鿿]/g) || []).slice(0, 8).join(''));
  ck('编辑器不进 diffPaint 池(#flow 内无 data-rid;主视图卡片数不变)',
     envL.$('flow').querySelectorAll('[data-rid]').length === 0 && envL.$('list').querySelectorAll('[data-rid]').length === 1);
  envL.run('void tick()');
  await envL.flush();
  ck('编辑器打开期间轮询照常且无渲染异常', envL.errs.length === 0 && envL.$('list').querySelectorAll('[data-rid]').length === 1, envL.errs.join('|'));

  // ── map / merge 节点 DOM 契约(1.2.53 · Phase 4)──
  draftsResp = { drafts: [] };
  const envD = mkEnv();
  await envD.flush();
  envD.run('void openFlow("/work/fix")');
  await envD.flush(30);
  ck('组件面板含 Map 与 Merge 两个入口',
     !!envD.$q('#fPalette .pal[data-t="map"]') && !!envD.$q('#fPalette .pal[data-t="merge"]'));
  const mid = String(envD.get('flowAddNode("map", { x: 10, y: 10 })'));
  const midEl = querySelectorEl(envD.rootEl, `.wfnode[data-nodeid="${mid}"]`);
  ck('map 卡片 = MAP 徽章 + items 输入 + 回调模板(textarea.f-prompt)',
     /MAP/.test(midEl.querySelector('.hd b')!.textContent) && !!midEl.querySelector('input.f-items') && !!midEl.querySelector('textarea.f-prompt'),
     midEl.textContent.slice(0, 60));
  ck('map 的 handle 与 agent 同形(in/out),data-id 拼法不变',
     midEl.querySelector('.lucid-flow__handle.source')!.getAttribute('data-id') === `lwf-${mid}-out-source`
     && midEl.querySelector('.lucid-flow__handle.target')!.getAttribute('data-id') === `lwf-${mid}-in-target`);
  const gid = String(envD.get('flowAddNode("merge", { x: 10, y: 200 })'));
  ck('merge 可加多个且无执行字段(汇合点自身不跑代理)',
     !!gid && !!envD.get('flowAddNode("merge", { x: 10, y: 300 })') && !querySelectorEl(envD.rootEl, `.wfnode[data-nodeid="${gid}"]`).querySelector('textarea.f-prompt'));
  const bid = String(envD.get('flowAddNode("branch", { x: 10, y: 400 })'));
  const bidEl = querySelectorEl(envD.rootEl, `.wfnode[data-nodeid="${bid}"]`);
  ck('branch 卡片 = BRANCH 徽章 + 条件输入 + true/false 两个出把',
     /BRANCH/.test(bidEl.querySelector('.hd b')!.textContent) && !!bidEl.querySelector('input.f-cond')
     && bidEl.querySelectorAll('.lucid-flow__handle.source').length === 2
     && bidEl.querySelector('.h-true')!.getAttribute('data-handleid') === 'true'
     && bidEl.querySelector('.h-false')!.getAttribute('data-handleid') === 'false',
     bidEl.textContent.slice(0, 60));
  ck('branch 的 data-id 拼法不变(新增 handle 只增加 handleId 取值,AD-2)',
     bidEl.querySelector('.h-true')!.getAttribute('data-id') === `lwf-${bid}-true-source`
     && bidEl.querySelector('.h-false')!.getAttribute('data-id') === `lwf-${bid}-false-source`);
  const gEl = querySelectorEl(envD.rootEl, `.wfnode[data-nodeid="${gid}"]`);
  ck('merge 两个入把 in / in2(data-id 不撞,两个圆点才点得准)',
     gEl.querySelectorAll('.lucid-flow__handle.target').length === 2
     && gEl.querySelector('.h-in')!.getAttribute('data-id') === `lwf-${gid}-in-target`
     && gEl.querySelector('.h-in2')!.getAttribute('data-id') === `lwf-${gid}-in2-target`);
  ck('map 卡片写明"下游每级 = pipeline 的一级"这条语义(不撒谎)',
     /pipeline/.test(visibleText(midEl)), visibleText(midEl).slice(0, 120));
  // ── loop 卡片与成本条(1.2.55 · Phase 6)──
  const lid = String(envD.get('flowAddNode("loop", { x: 10, y: 500 })'));
  const lidEl = querySelectorEl(envD.rootEl, `.wfnode[data-nodeid="${lid}"]`);
  ck('loop 卡片 = LOOP 徽章 + cond + maxRounds + 预算守卫开关',
     /LOOP/.test(lidEl.querySelector('.hd b')!.textContent) && !!lidEl.querySelector('input.f-cond')
     && !!lidEl.querySelector('input.f-rounds') && !!lidEl.querySelector('input.f-guard'),
     lidEl.textContent.slice(0, 60));
  ck('loop 的 body/out 两个出把 data-id 拼法不变',
     lidEl.querySelector('.h-body')!.getAttribute('data-id') === `lwf-${lid}-body-source`
     && lidEl.querySelector('.h-out')!.getAttribute('data-id') === `lwf-${lid}-out-source`);
  ck('maxRounds 输入框默认 1 且 type=number(min=1)', lidEl.querySelector('input.f-rounds')!.value === '1'
     && lidEl.querySelector('input.f-rounds')!.getAttribute('min') === '1');
  ck('成本条显示代理数估算与并发上限(口径来自 flowAgentEstimate 单点)',
     /◆\d+/.test(envD.$('fCost').textContent) && /16/.test(envD.$('fCost').textContent), envD.$('fCost').textContent);
  envD.run('FS.nodes = [{id:"n1",type:"start",position:{x:0,y:0},data:{note:"q"}},'
    + '...Array.from({length:25},(_,i)=>({id:"a"+i,type:"agent",position:{x:0,y:0},data:{label:"a",prompt:"x"}})),'
    + '{id:"n9",type:"return",position:{x:0,y:0},data:{ret:""}}]; FS.edges = []; refreshFlowScript()');
  ck('≥25 个代理 → 成本条变红(.over)且写清"官方会告警"(估算不撒谎)',
     /◆25/.test(envD.$('fCost').textContent) && /over/.test(String(envD.$('fCost').attrs.class))
     && /Large workflow/.test(envD.$('fCost').title), envD.$('fCost').textContent + ' | ' + envD.$('fCost').title.slice(0, 80));

  // ── agent 选项 / retry / log(1.2.56 · Phase 7)──
  const envR = mkEnv();
  await envR.flush();
  envR.run('void openFlow("/work/fix")');
  await envR.flush(30);
  const agEl = querySelectorEl(envR.rootEl, '.wfnode.t-agent');
  ck('agent 卡片 = effort 五档下拉 + agentType(带 datalist) + retry 两框 + isolation 开关',
     agEl.querySelectorAll('select.f-effort option').length === 6
     && agEl.querySelector('input.f-atype')!.getAttribute('list') === 'fATypes'
     && !!agEl.querySelector('input.f-rn') && !!agEl.querySelector('input.f-rms') && !!agEl.querySelector('input.f-iso'));
  ck('effort 下拉选项 = inherit + low/medium/high/xhigh/max(与生成器白名单同源)',
     agEl.querySelectorAll('select.f-effort option').map(o => o.value || o.textContent).join(',') === 'inherit,low,medium,high,xhigh,max',
     agEl.querySelectorAll('select.f-effort option').map(o => o.textContent).join(','));
  const eSel = agEl.querySelector('select.f-effort')!;
  eSel.value = 'low';
  eSel.fire('input', { target: eSel });
  const atIn = agEl.querySelector('input.f-atype')!;
  atIn.value = 'code-reviewer';
  atIn.fire('input', { target: atIn });
  const rnIn = agEl.querySelector('input.f-rn')!;
  rnIn.value = '2';
  rnIn.fire('input', { target: rnIn });
  await envR.flush(4);
  ck('选项编辑落到脚本(opts + $retry 助手一次生成)',
     /effort: "low"/.test(envR.$('fScript').textContent) && /agentType: "code-reviewer"/.test(envR.$('fScript').textContent)
     && /async function \$retry\(/.test(envR.$('fScript').textContent)
     && (envR.$('fScript').textContent.match(/async function \$retry\(/g) || []).length === 1,
     envR.$('fScript').textContent.slice(0, 200));
  ck('agentType 候选来自 /api/agents(取不到就空,不挡自由文本)', envR.fetchCalls.some(u => u.indexOf('/api/agents') === 0));
  // 把 log 接进链路(孤立节点会被校验拦下):末个 agent → log → return
  const lid2 = String(envR.run(`(function(){
    const id = flowAddNode("log", { x: 10, y: 600 });
    const last = FS.nodes.filter(n => n.type === "agent").pop().id;
    const ret = FS.nodes.find(n => n.type === "return").id;
    FS.edges = FS.edges.filter(e => !(e.source === last && e.target === ret));
    FS.edges.push({ id: 'e' + (FS.next++), source: last, sourceHandle: 'out', target: id, targetHandle: 'in' });
    FS.edges.push({ id: 'e' + (FS.next++), source: id, sourceHandle: 'out', target: ret, targetHandle: 'in' });
    flowRender(); return id;
  })()`));
  const lidEl2 = querySelectorEl(envR.rootEl, `.wfnode[data-nodeid="${lid2}"]`);
  ck('log 卡片 = LOG 徽章 + 文本域', /LOG/.test(lidEl2.querySelector('.hd b')!.textContent) && !!lidEl2.querySelector('textarea.f-text'));
  const lt = lidEl2.querySelector('textarea.f-text')!;
  lt.value = '已确认 {{n2}} 条';
  lt.fire('input', { target: lt });
  await envR.flush(4);
  ck('log 文本 {{nX}} 在生成物里解析成模板插值', /log\(`已确认 \$\{n2\} 条`\)/.test(envR.$('fScript').textContent), envR.$('fScript').textContent.slice(0, 200));

  // ── code / subflow 卡片与警告区(1.2.57 · Phase 8)──
  // 手工建一张含 code/subflow 的图(孤立节点会被校验拦下,所以必须连进链路)
  draftsResp = { drafts: [{ name: 'triage-issues', meta: { name: 'triage-issues' }, mtime: 1, js: '/x/t.js',
    draft: { v: 2, name: 'triage-issues', nodes: [{ id: 'a1', type: 'agent', data: {} }], edges: [] } }] };
  const envC2 = mkEnv();
  await envC2.flush();
  envC2.run('void openFlow("/work/fix")');
  await envC2.flush(30);
  envC2.run(`(function(){
    FS.nodes = [
      { id: 'n1', type: 'start', position: { x: 0, y: 0 }, data: { note: 'q' } },
      { id: 'n2', type: 'agent', position: { x: 200, y: 0 }, data: { label: 'A', phase: 'P', prompt: 'a' } },
      { id: 'n3', type: 'code', position: { x: 400, y: 0 }, data: { code: 'return 1' } },
      { id: 'n4', type: 'subflow', position: { x: 600, y: 0 }, data: { ref: 'triage-issues', argsExpr: '' } },
      { id: 'n5', type: 'return', position: { x: 800, y: 0 }, data: { ret: '{ v: n4 }' } }];
    FS.edges = [
      { id: 'e1', source: 'n1', sourceHandle: 'out', target: 'n2', targetHandle: 'in' },
      { id: 'e2', source: 'n2', sourceHandle: 'out', target: 'n3', targetHandle: 'in' },
      { id: 'e3', source: 'n3', sourceHandle: 'out', target: 'n4', targetHandle: 'in' },
      { id: 'e4', source: 'n4', sourceHandle: 'out', target: 'n5', targetHandle: 'in' }];
    flowRender();
  })()`);
  await envC2.flush(6);
  const cidEl = querySelectorEl(envC2.rootEl, '.wfnode[data-nodeid="n3"]');
  ck('code 卡片 = CODE 徽章 + 醒目的"不参与可视化语义"提示 + 等宽编辑区',
     /CODE/.test(cidEl.querySelector('.hd b')!.textContent) && !!cidEl.querySelector('.codehint')
     && !!cidEl.querySelector('textarea.f-code') && /不参与可视化语义/.test(visibleText(cidEl)));
  const sidEl = querySelectorEl(envC2.rootEl, '.wfnode[data-nodeid="n4"]');
  ck('subflow 卡片 = ref(带草稿 datalist)+ 参数表达式 + 一层嵌套提示',
     !!sidEl.querySelector('input.f-ref') && sidEl.querySelector('input.f-ref')!.getAttribute('list') === 'fDraftRefs'
     && !!sidEl.querySelector('input.f-args') && /一层/.test(visibleText(sidEl)));
  ck('草稿下拉与 subflow ref 候选同源(renderDraftOptions 一处刷两处)',
     /triage-issues/.test(envC2.$('fDraftRefs').innerHTML) && /triage-issues/.test(envC2.$('fDraft').innerHTML),
     envC2.$('fDraftRefs').innerHTML.slice(0, 80));
  // 警告区:未知全局只提示、不拦生成
  const cta = cidEl.querySelector('textarea.f-code')!;
  cta.value = 'return agents(n2)';
  cta.fire('input', { target: cta });
  await envC2.flush(4);
  ck('警告区显示未知全局(code 片段是唯一会引入幻觉 API 的地方)',
     /未知全局/.test(envC2.$('fWarn').textContent) && envC2.$('fWarn').hidden === false, envC2.$('fWarn').textContent.slice(0, 120));
  ck('警告不拦生成(#fErr 仍空,脚本照出)', envC2.$('fErr').hidden === true && /export const meta/.test(envC2.$('fScript').textContent),
     envC2.$('fErr').textContent.slice(0, 80));
  cta.value = 'return 1';
  cta.fire('input', { target: cta });
  await envC2.flush(4);
  ck('改成合法片段后警告消失(同一次 flowWarnings 调用出结果)', envC2.$('fWarn').hidden === true);
  draftsResp = { drafts: [] };
  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
