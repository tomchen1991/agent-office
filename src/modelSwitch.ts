import type { CharacterId } from './core.ts';

/** Display-only observation used to detect a provider/model change on one instance. */
export interface ModelSwitchObservation {
  id: string;
  /** Full source/instance/epoch identity; a reused ID with a new epoch is not a model switch. */
  identityKey: string | null;
  /** Combined provider/model signature. Null means the source reported no model identity. */
  model: string | null;
  /** Currently displayed persona, which may come from explicit configuration. */
  character: CharacterId;
}

export interface ModelSwitchMark {
  identityKey: string | null;
  model: string | null;
  character: CharacterId;
}

export interface ModelSwitchRecord {
  token: number;
  fromCharacter: CharacterId;
  toCharacter: CharacterId;
  fromModel: string;
  toModel: string;
  at: number;
}

export interface ModelSwitchScan {
  marks: Map<string, ModelSwitchMark>;
  changes: Record<string, ModelSwitchRecord>;
}

const sameIdentity = (previous: string | null, next: string | null) => previous === next;

/**
 * Compare one observation set with the previous marks. A switch needs the same
 * instance identity on both sides and two reported model signatures. Missing
 * model data is uncertainty, never an implied reset to a default model.
 */
export function detectModelSwitches(
  previous: ReadonlyMap<string, ModelSwitchMark>,
  observations: readonly ModelSwitchObservation[],
  options: { at: number; nextToken: () => number },
): ModelSwitchScan {
  const marks = new Map(previous);
  const changes: Record<string, ModelSwitchRecord> = {};
  for (const observation of observations) {
    const before = previous.get(observation.id);
    if (before && sameIdentity(before.identityKey, observation.identityKey) &&
        before.model && observation.model && before.model !== observation.model) {
      changes[observation.id] = {
        token: options.nextToken(),
        fromCharacter: before.character,
        toCharacter: observation.character,
        fromModel: before.model,
        toModel: observation.model,
        at: options.at,
      };
    }
    marks.set(observation.id, { identityKey: observation.identityKey, model: observation.model, character: observation.character });
  }
  return { marks, changes };
}
