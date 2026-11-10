import type { ResidentOfficeTopology as OfficeTopology } from './residentLayout.ts';
import { residentPersona } from './residentVisuals.ts';
import type { OfficePresentation } from './residentVisuals.ts';
import { residentSeatReport as liveOfficeSeatReport } from './residentLayout.ts';
import { fixedOfficeSeats } from './wholeOfficeGeometry.ts';
import type { OfficeSceneSeat } from './WholeOfficeScene';

/** Overlay explicit identities on permanent furniture. No provider/hostname/role inference. */
export function liveOfficeSeats(topology: OfficeTopology, agents: readonly OfficePresentation[]): OfficeSceneSeat[] {
  const report = liveOfficeSeatReport(topology);
  const byGeometry = new Map(Object.entries(report.assignments).map(([id, physicalId]) => [physicalId, id]));
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const usedIds = new Set([...agents.map(agent => agent.id), topology.selfAgentId, ...topology.childAgentIds, ...topology.team.memberIds, ...[topology.githubAgentId, topology.devopsAgentId, topology.hotspotAgentId].filter((id): id is string => id !== undefined)]);
  return fixedOfficeSeats().map(template => {
    const id = byGeometry.get(template.id);
    if (id === undefined) {
      let emptyId = JSON.stringify(['empty-office-seat', template.id]);
      while (usedIds.has(emptyId)) emptyId += '_';
      usedIds.add(emptyId);
      return { ...template, id: emptyId, geometryId: template.id, persona: 'unknown', label: template.residentRole ? template.label : '空位', empty: true, isLeader: false };
    }
    const agent = byId.get(id);
    const isLeader = template.kind === 'team' && topology.team.layout === 'leader-desks' && id === topology.team.leaderId;
    return { ...template, id, geometryId: template.id, empty: false, persona: residentPersona(id, agent?.character ?? 'unknown', topology), label: agent?.name ?? id,
      isLeader, role: template.residentRole ? template.role : template.kind === 'owner' ? '独立办公室 · 专属席位' : template.kind === 'simulated-child' ? '子 Agent · 显式配置'
        : isLeader ? '团队任务负责人' : template.sharedTable ? '公共协作桌 · 显式成员' : '独立工位 · 同级办公' };
  });
}
