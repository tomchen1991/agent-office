/** Renderer-safe reusable API. Node adapter is separately imported from server/collect.ts. */
export type { AgentIdentity, UserRequestSummary, OfficeAgent, OfficeSnapshot, OfficeTopology, AdapterState, OfficeAdapter, CharacterId, OfficeStatus } from './core.ts';
export { freshness, displayStatus, validateTopology } from './core.ts';
export { parseOfficeConfig, importOfficeConfig, exportOfficeConfig } from './config.ts';
export type { OfficeConfig, SeatConfig, EpochPolicy } from './config.ts';
export { bindOffice } from './binding.ts';
export type { BoundOffice, BindingWarning } from './binding.ts';
export { enrichOfficeSnapshot } from './enrichment.ts';
export type { OfficeEnrichment, UserRequestEnrichment, EnrichmentResult } from './enrichment.ts';
export { createMockAdapter, demoTopology } from './mock.ts';
export { createBridgeAdapter } from './bridge.ts';
export type { OfficeBridgeApi } from './bridgeProtocol.ts';
