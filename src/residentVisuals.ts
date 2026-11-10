import type { CharacterId } from './core.ts';
import type { ResidentOfficeTopology as OfficeTopology } from './residentLayout.ts';
export type ResidentRole = 'main' | 'auto-fix' | 'devops' | 'hotspot';
import type { DemoCharacter } from './demoAssets.ts';

/** Renderer-only persona IDs. The transport DTO and provider metadata stay unchanged. */
export type OfficePersona = CharacterId | DemoCharacter['id'];
export interface OfficePresentation { id: string; name: string; character: OfficePersona }

/** Dedicated identities own artwork, even when their provider/model changes. */
export function residentPersona(id: string, fallback: OfficePersona, topology: OfficeTopology): OfficePersona {
  if (id === topology.devopsAgentId) return 'devops';
  if (id === topology.hotspotAgentId) return 'hotspot';
  return fallback;
}

/** Sleep is visual-only and belongs to the four explicitly assigned resident desks. */
export function nightRestPersona(seat: { kind: string; persona: OfficePersona }): 'self' | 'github' | 'devops' | 'hotspot' | undefined {
  if (seat.kind === 'owner' && seat.persona === 'self') return 'self';
  if (seat.kind === 'github' && seat.persona === 'github') return 'github';
  if (seat.kind === 'devops' && seat.persona === 'devops') return 'devops';
  if (seat.kind === 'hotspot' && seat.persona === 'hotspot') return 'hotspot';
  return undefined;
}
