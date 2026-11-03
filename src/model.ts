import { MAX_VISIBLE_CHILD_AGENTS } from './core.ts';
export type AgentStatus = 'idle' | 'working' | 'waiting' | 'offline';
export type CharacterId = 'self' | 'deepseek' | 'chatgpt' | 'grok';
export type TeamLayout = 'leader-desks' | 'peer-table';
export interface AgentSnapshot {
  id: string;
  character: CharacterId;
  name: string;
  status: AgentStatus;
  latestUserRequest: { summary: string; receivedAt: string } | null;
  childAgentIds: readonly string[];
}
// 这里只是展示模型，不是已接入的采集 API 合约。
export function childSeats(ids: readonly string[]) {
  return { visible: ids.slice(0, MAX_VISIBLE_CHILD_AGENTS), overflow: Math.max(0, ids.length - MAX_VISIBLE_CHILD_AGENTS) };
}
export function requestSummary(agent: AgentSnapshot): string {
  return agent.latestUserRequest?.summary.trim() || '尚无用户请求';
}
export const statusLabels: Record<AgentStatus, string> = {
  idle: '待机', working: '工作中', waiting: '等待输入', offline: '离线',
};
