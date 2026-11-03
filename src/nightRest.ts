/** Local wall-clock presentation only. Never changes an adapter or running task. */
export interface NightRestConfig { version: 1; enabled: boolean; start: string; end: string }
export const DEFAULT_NIGHT_REST: Readonly<NightRestConfig> = Object.freeze({ version: 1, enabled: true, start: '22:00', end: '07:00' });
const minute = (value: unknown): number => {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Night time must be HH:mm');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
};
export function parseNightRestConfig(value: unknown): NightRestConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid night rest config');
  const config = value as Record<string, unknown>;
  if (config.version !== 1 || typeof config.enabled !== 'boolean' || Object.keys(config).some(key => !['version', 'enabled', 'start', 'end'].includes(key))) throw new Error('Invalid night rest config');
  if (minute(config.start) === minute(config.end)) throw new Error('Night window must have distinct endpoints');
  return { version: 1, enabled: config.enabled, start: config.start as string, end: config.end as string };
}
/** End exclusive; invalid dates fail closed. Date's local fields deliberately honor host timezone/DST. */
export function isNightRestTime(now: Date, config: NightRestConfig = DEFAULT_NIGHT_REST): boolean {
  const valid = parseNightRestConfig(config);
  if (!valid.enabled || !Number.isFinite(now.getTime())) return false;
  const current = now.getHours() * 60 + now.getMinutes(), start = minute(valid.start), end = minute(valid.end);
  return start < end ? current >= start && current < end : current >= start || current < end;
}
export const NIGHT_LOWER_MS = 900;
export const NIGHT_WAKE_MS = 600;
