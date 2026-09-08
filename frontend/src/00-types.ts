// ── 类型契约(与后端 ccviewer/*.py 输出对齐) ──
// 全局脚本模式:各文件按名序拼接为单个 <script>,不使用 import/export。
interface Tok { input: number; output: number; cacheRead: number; cacheWrite: number }
interface Ph { title: string }
interface Agent {
  label: string; phase?: string | null; state: string;
  tokens?: number | null; toolCalls?: number | null; durationMs?: number | null;
  lastTool?: string | null; agentId?: string; prompt: string; result: string;
}
interface Run {
  runId: string; project: string; session: string; cwd?: string; name: string; summary: string;
  status: string; live: boolean; startedAt?: number | null; durationMs?: number | null;
  tokens?: number | null; agentCount: number; phases: Ph[]; agents: Agent[]; logs: string[];
  task: string; result: string; orphan?: boolean; lastActivityAt?: number;
}
interface Step { msgId: string; turn?: string; tools: string[]; text: string; model: string | null; tokIn: number; tokOut: number; ts: string | null }  // turn=开启所在回合的真人输入记录 uuid(''=尾窗之前的输入;后端 _user_prompt 单点判定,前端不猜边界)
interface Subagent {
  agentId: string; label: string; agentType?: string | null; description?: string;
  model?: string | null; kind: string; teamName?: string | null; color?: string | null;
  state: string; lastTool?: string | null; pendingTools: string[]; toolCalls: number;
  tokens: Tok; lastActivityAt: number; prompt: string; lastText: string;
}
interface PromptEcho { u: string; t: string; ts: string; f?: number }  // u=转录记录 uuid(全文回取锚点) f=1 头扫补入的首条
interface SessionState {
  sessionId: string; project: string; cwd: string; title: string; status: string; alive: boolean;
  pid?: number | null; kind?: string | null; version?: string | null; startedAt: number; lastActivityAt: number;
  ageSec: number; model?: string | null; stopReason?: string | null; permissionMode?: string | null;
  waitReason?: string | null; waitTool?: string | null;  // 阻塞成因(input_required:ask|permission|turn;running:workflow=已交接工作流后台执行,1.2.42)
  tokens: Tok; pendingTools: string[]; toolCalls: number; lastPrompt: string; lastText: string;
  lastTextMid?: string;  // lastText 所在消息 id;等待行全文抽屉 data-src=main#<id> 的回取锚点
  prompts?: PromptEcho[];  // 卡顶「你输入 ❯」:尾窗用户输入(摘要+uuid 锚点懒拉全文)+ 头扫首条(f:1)
  turns?: number;  // 主 agent 调用任务次数(尾窗全量+头扫首条;prompts 摘要 30 条封顶不影响它)
  steps: Step[]; subagents: Subagent[];
}
interface TasksSummary { total: number; byCwd: Record<string, number> }
interface RunsResp { now: number; ver?: string; recentDays?: number; runs: Run[]; projects?: string[]; tasks?: TasksSummary }
interface SessionsResp { now: number; sessions: SessionState[] }
interface Conf { enabled: boolean; format: string; url: string; insecure: boolean; port: number; recentDays: number; notifyInput: string }
interface LastHook { at: number; ok: boolean | null; status: string; reply: string }
interface ConfResp { conf: Conf; last: LastHook }
interface SaveResp { ok?: boolean; msg?: string; reloc?: string; conf?: Conf }
interface TestResp { ok?: boolean; msg?: string; last?: LastHook }
interface FullResp { prompt: string; result: string; miss?: boolean }
// 全文抽屉缓存值(p=输入/工具入参, r=输出/结果; r 是否 in 决定 截断预览/全文 标签; m=超出留存不可回取)
type Fu = Partial<{ p: string; r: string; m: boolean }>;

// ── 编排器图契约(1.2.43;与落盘的 <name>.json 草稿 1:1 = 前后端唯一契约,见 dev-guide §3.1)──
type FlowPos = { x: number; y: number };
type FlowKind = 'start' | 'agent' | 'return';
interface FlowNodeData { label?: string; phase?: string; prompt?: string; model?: string; schemaText?: string; note?: string; ret?: string }
interface FlowNode { id: string; type: FlowKind; position: FlowPos; data: FlowNodeData; measured?: { width: number; height: number } }
interface FlowConn { source: string; sourceHandle: string | null; target: string; targetHandle: string | null }
type FlowEdge = FlowConn & { id: string };
type FlowView = { x: number; y: number; zoom: number };
type FlowPhase = { title: string; detail?: string };   // meta.phases 的一条(1.2.50:v2 可显式编辑,空数组=沿用推导)
// args 契约(1.2.51):schemaText/exampleText 存**JSON 原文**(与 agent.schemaText 同一约定——
// 编辑器是文本框,存文本才不丢"正在编辑的半截 JSON";落盘前 flowValidate 已保证合法)。
type FlowArgsSpec = { schemaText: string; exampleText: string; required: boolean };
interface FlowDraft {
  v: 1 | 2; name: string; desc: string; cwd: string;
  whenToUse?: string; phases?: FlowPhase[]; argsSpec?: FlowArgsSpec;   // v2 加宽字段(v1 草稿缺省为空 = 与旧行为逐字节一致)
  nodes: FlowNode[]; edges: FlowEdge[]; next: number; view: FlowView;
}
// handleBounds:编辑器手写测量的注入件(C10;字段口径镜像 @xyflow/system 的 getHandleBounds)
interface FlowHandleBound { id: string | null; type: 'source' | 'target'; position: string; x: number; y: number; width: number; height: number }
type FlowHandleBounds = { source: FlowHandleBound[]; target: FlowHandleBound[] };
// 草稿 API(后端 web.list_drafts / save_draft 的响应契约)
interface DraftItem { name: string; meta: { name?: string; desc?: string }; mtime: number; js: string; draft: unknown }
interface DraftsResp { drafts: DraftItem[] }
interface DraftSaveResp { ok?: boolean; msg?: string; path?: string; sha?: string }
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
