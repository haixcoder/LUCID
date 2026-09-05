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
interface Step { msgId: string; tools: string[]; text: string; model: string | null; tokIn: number; tokOut: number; ts: string | null }
interface Subagent {
  agentId: string; label: string; agentType?: string | null; description?: string;
  model?: string | null; kind: string; teamName?: string | null; color?: string | null;
  state: string; lastTool?: string | null; pendingTools: string[]; toolCalls: number;
  tokens: Tok; lastActivityAt: number; prompt: string; lastText: string;
}
interface SessionState {
  sessionId: string; project: string; cwd: string; title: string; status: string; alive: boolean;
  pid?: number | null; kind?: string | null; version?: string | null; startedAt: number; lastActivityAt: number;
  ageSec: number; model?: string | null; stopReason?: string | null; permissionMode?: string | null;
  waitReason?: string | null; waitTool?: string | null;  // status=input_required 时的成因:ask|permission|turn
  tokens: Tok; pendingTools: string[]; toolCalls: number; lastPrompt: string; lastText: string;
  lastTextMid?: string;  // lastText 所在消息 id;等待行全文抽屉 data-src=main#<id> 的回取锚点
  steps: Step[]; subagents: Subagent[];
}
interface RunsResp { now: number; ver?: string; recentDays?: number; runs: Run[] }
interface SessionsResp { now: number; sessions: SessionState[] }
interface Conf { enabled: boolean; format: string; url: string; insecure: boolean; port: number; recentDays: number; notifyInput: string }
interface LastHook { at: number; ok: boolean | null; status: string; reply: string }
interface ConfResp { conf: Conf; last: LastHook }
interface SaveResp { ok?: boolean; msg?: string; reloc?: string; conf?: Conf }
interface TestResp { ok?: boolean; msg?: string; last?: LastHook }
interface FullResp { prompt: string; result: string; miss?: boolean }
// 全文抽屉缓存值(p=输入/工具入参, r=输出/结果; r 是否 in 决定 截断预览/全文 标签; m=超出留存不可回取)
type Fu = Partial<{ p: string; r: string; m: boolean }>;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
