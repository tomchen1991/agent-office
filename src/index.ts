/** Renderer-safe reusable API. Node adapter is separately imported from server/collect.ts. */
export type { AgentIdentity, UserRequestSummary, OfficeAgent, OfficeSnapshot, OfficeTopology, AdapterState, OfficeAdapter, CharacterId, OfficeStatus, PublicOfficeSeatId, OfficeSeatAssignments, OfficeSeatReport } from './core.ts';
export { MAX_VISIBLE_CHILD_AGENTS, freshness, displayStatus, validateTopology, liveOfficeSeatReport, validateSeatAssignments, PUBLIC_DESK_IDS, PUBLIC_TABLE_SEAT_IDS } from './core.ts';
export { parseOfficeConfig, importOfficeConfig, exportOfficeConfig } from './config.ts';
export type { OfficeConfig, SeatConfig, EpochPolicy } from './config.ts';
export { bindOffice } from './binding.ts';
export type { BoundOffice, BindingWarning } from './binding.ts';
export { enrichOfficeSnapshot } from './enrichment.ts';
export type { OfficeEnrichment, UserRequestEnrichment, EnrichmentResult } from './enrichment.ts';
export { createMockAdapter, demoTopology } from './mock.ts';
export { createBridgeAdapter } from './bridge.ts';
export type { OfficeBridgeApi } from './bridgeProtocol.ts';
