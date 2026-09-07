// ── 39-flow-shim.ts:vendored @xyflow/system 的 ambient 声明(零运行时产物)──
// 实体文件 = scripts/ccviewer/static/xyflow.system.umd.js(@xyflow/system@0.0.82 UMD,100KB,d3 内联,全局名
// XYFlowSystem),由 template.html 在主脚本块**之前**以经典 <script> 引入;构建产物入库(铁律 1 合规,同 bin/install.js 先例)。
// 声明只覆盖本仓用到的面;字段以 dist/esm/*.d.ts 为准(实证清单见 docs/xyflow-integration-research.md §2/§4)。
// ⚠ 升级 0.0.x = 人工锁版流程(官方无 semver 承诺):换 UMD → 重跑契约表 C1–C10 + headless 五断言,见 dev-guide §9。
// 本块纯 declare,编译后不产出 JS;但业务代码不许在顶层取 XYFlowSystem 的属性(无 vendor 环境会 ReferenceError)——
// 一律经 40-flow 的 xy() 惰性取,无头测试桩因此不需要真 UMD 也能加载整块产物。
declare const XYFlowSystem: {
  Position: { Left: 'left'; Right: 'right'; Top: 'top'; Bottom: 'bottom' };
  ConnectionMode: { Strict: 'strict'; Loose: 'loose' };
  // C8:内部对 onDraggingChange / onTransformChange 无空值防护(直调)→ 六个回调必须全传,缺则 "o is not a function"
  XYPanZoom(p: {
    domNode: Element; minZoom: number; maxZoom: number; translateExtent: number[][]; viewport: FlowView;
    onPanZoom: (ev: Event | null, vp: FlowView) => void;
    onPanZoomStart: () => void; onPanZoomEnd: () => void; onDraggingChange: (v: boolean) => void;
  }): FlowPanZoom;
  // XYDrag / XYHandle 的参数包字段面广且属"内部积木",strict 下逐个精确定义性价比低:
  // 契约正确性由 tests/frontend/test_flow_editor.ts + headless 五断言钉,不靠类型钉(留白是有意为之,dev-guide §5.2)
  XYDrag(p: Record<string, unknown>): FlowDragInst;
  XYHandle: {
    onPointerDown(ev: MouseEvent, p: Record<string, unknown>): void;
    isValid(ev: MouseEvent, p: Record<string, unknown>): {
      isValid: boolean; connection: FlowConn | null; handleDomNode: Element | null; toHandle: unknown };
  };
  addEdge(e: FlowConn & { id?: string }, edges: FlowEdge[]): FlowEdge[];
  getBezierPath(p: { sourceX: number; sourceY: number; sourcePosition: string;
    targetX: number; targetY: number; targetPosition: string; curvature?: number }): [string, number, number, number, number];
  adoptUserNodes(nodes: FlowNode[], nodeLookup: Map<string, FlowIntern>, parentLookup: Map<string, unknown>,
    opts?: Record<string, unknown>): void;
};
// PanZoomInstance 全表(已核 d.ts;**无 fitView**——适配视图由包装层自算 bounds 后 setViewport)
interface FlowPanZoom {
  update(p: Record<string, unknown>): void; destroy(): void;
  getViewport(): FlowView;
  setViewport(v: FlowView, o?: { duration?: number }): Promise<unknown>;
  setViewportConstrained(x: number, y: number, z: number): Promise<unknown>;
  setScaleExtent(min: number, max: number): void; setTranslateExtent(e: number[][]): void;
  scaleTo(z: number): Promise<boolean>; scaleBy(f: number): Promise<boolean>;
  syncViewport(v: FlowView): void; setClickDistance(d: number): void;
}
interface FlowDragInst { update(p: Record<string, unknown>): void; destroy(): void }
// adoptUserNodes 写入的节点内部件:本仓只读 internals.handleBounds(vendor 用它做吸附与边端点计算)
interface FlowIntern {
  id: string;
  internals: { handleBounds?: FlowHandleBounds; positionAbsolute?: FlowPos };
  measured?: { width: number; height: number };
  hidden?: boolean;
}
// 喂回给包装层回调的三个形状(字段名以 vendor 源码为准:指针叫 pointer,不叫 pointerPos)
type FlowHandleRef = { nodeId: string; id: string | null; type: 'source' | 'target' };
type FlowFromHandle = FlowHandleRef;
interface FlowStartParam { nodeId: string; handleId: string | null; handleType: 'source' | 'target' }
interface FlowConnState {
  fromHandle: FlowHandleRef | null; toHandle: FlowHandleRef | null;
  pointer?: { x: number; y: number } | null;
}
