import type { OfficeAgent, OfficeTopology } from './core.ts';
import { wholeOfficeSeats } from './wholeOfficeGeometry.ts';
import type { OfficeSceneSeat } from './WholeOfficeScene';

/** Apply explicit IDs to the approved spatial slots. No provider/hostname/role inference. */
export function liveOfficeSeats(topology: OfficeTopology, agents: readonly Pick<OfficeAgent, 'id' | 'name' | 'character'>[]): OfficeSceneSeat[] {
  const templates = wholeOfficeSeats(topology.team.layout, topology.childAgentIds.length);
  const owner = templates.find(seat => seat.kind === 'owner')!;
  const children = templates.filter(seat => seat.kind === 'simulated-child');
  const team = templates.filter(seat => seat.kind === 'team');
  const teamIds = topology.team.layout === 'leader-desks'
    ? [topology.team.leaderId!, ...topology.team.memberIds.filter(id => id !== topology.team.leaderId)]
    : [...topology.team.memberIds];
  const mapped = [{ template: owner, id: topology.selfAgentId },
    ...children.map((template, index) => ({ template, id: topology.childAgentIds[index] })),
    ...team.slice(0, teamIds.length).map((template, index) => ({ template, id: teamIds[index] }))];
  return mapped.map(({ template, id }) => {
    const agent = agents.find(item => item.id === id);
    const isLeader = template.kind === 'team' && topology.team.layout === 'leader-desks' && id === topology.team.leaderId;
    return { ...template, id, geometryId: template.id, persona: agent?.character ?? 'unknown', label: agent?.name ?? id,
      isLeader, role: template.kind === 'owner' ? '独立办公室 · 专属席位' : template.kind === 'simulated-child' ? '子 Agent · 显式配置'
        : isLeader ? '团队任务负责人' : topology.team.layout === 'peer-table' ? '同级协作' : '团队成员 · 同级办公' };
  });
}
