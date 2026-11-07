# Status-driven whole office

`LiveOffice` consumes an injected `OfficeAdapter` and renders the same calibrated room, private-office boundary, child desks, team desks, shared table, travel routes, and eight approved action atlases as `WholeOfficeDemo`. The original 26-second standalone demo remains a separate view and still plays only once.

## Renderer entry point

Use `src/react.ts` for React components. The `src/index.ts` entry remains renderer-safe plain TypeScript for contracts, configuration, binding, and bridge helpers. Node host code does not need to import TSX or CSS.

```tsx
import { useMemo } from 'react';
import { LiveOffice } from './src/react';
import { createBridgeAdapter, parseOfficeConfig } from './src/index';
import type { OfficeBridgeApi } from './src/index';

function Office({ api, config }: { api: OfficeBridgeApi; config: unknown }) {
  const officeConfig = useMemo(() => parseOfficeConfig(config), [config]);
  const adapterFactory = useMemo(() => () => createBridgeAdapter(api), [api]);
  return <LiveOffice
    adapterFactory={adapterFactory}
    officeConfig={officeConfig}
    modeLabel="已配置的数据源"
  />;
}
```

The application obtains `api` from the explicit preload API described in [electron-integration.md](electron-integration.md). This component does not discover hosts, read environment credentials, import Electron, or call an upstream service. Keep the factory stable between renders. A changed factory or explicit reconnect creates a new subscription generation and cancels the old view state.

Supply **exactly one** of:

- `officeConfig`: recommended for production. Each received normalized snapshot goes through `bindOffice`. Explicit source, instance, epoch policy, persona, logical seats, and topology determine presentation. Unique epoch replacement rebinds to the new actual identity and cancels old animation and request state. Ambiguous, incomplete `follow-unique`, and unmatched bindings remain empty with visible warnings. An empty configured seat retains its configured human-readable label.
- `topology`: for hosts that already bind normalized agent IDs and explicit personas. The host must update the topology when actual IDs change. The component also detects identity changes when an ID is reused with a new source/instance/epoch.

`modeLabel` is display text, not proof of a live connection. Use an accurate label. `characters` is an optional asset override intended for testing and compatible atlas integrations.

## Status and motion semantics

| Normalized/display state | Motion |
| --- | --- |
| New fresh explicit `working`, `idle`, `waiting`, or `stopping` presence | One arrival and sit sequence, then the newest status. |
| Fresh `working` after seating | Approved seated work frames 0/1 and active monitor/keyboard. |
| Fresh `idle` or `waiting` | Seated idle frames 6/7. No coffee/slack frames. |
| Fresh `stopping` | Neutral seated frame 6 and explicit stopping label. No error frames. |
| Unknown, stale, connecting, or disconnected | No phantom working animation. An existing observed actor is neutral, or an unbound/unobserved seat remains empty. |
| Missing snapshot entry, including partial coverage | Uncertainty, never an asserted exit. An already-bound ID can retain a neutral presentation; an unresolved configuration binding remains empty. |
| Explicit `offline` | An already-seated actor stands and exits once. Initial offline data remains an empty seat with an offline label. An interrupted arrival is canceled. |
| Unsupported/unknown persona | Neutral `?` placeholder. Never substitute the purple self persona. |

The live controller does not call the demo reducer or replay a demo lifecycle. Repeated observations update state without restarting entry. Seat reassignment and rapid offline/return changes cancel obsolete travel rather than creating duplicate actors. Travel uses the calibrated logical geometry slot, while DOM identity and inspector selection use the actual normalized agent ID.

A single cancellable RAF drives transitions and actual active/idle cycles. Pausing freezes the exact current pose and position; it does not teleport to a reduced-motion endpoint. System reduced-motion preference settles transitions without animation. Freshness continues on a separate monotonic timer while animation is paused. Phase-only repeats of the same snapshot do not renew its freshness. Adapter callbacks are generation-guarded, and subscriptions, asset handlers, timers, media listeners, and RAF handles are released on unmount/reconnect.

## Provider/model switch cue

The consumer treats a provider/model change as display metadata on the **same identity**. A cue is admitted only when `sourceId + instanceId + collectorEpoch` is unchanged and two observations both report a non-null model signature that differs. The first observation, missing model data, an epoch replacement, a reused ID, or a missing poll never fabricates a switch.

- The seat and DOM actor ID stay put. The previous persona dissolves upward while the new persona rematerializes, with an accent ring, scan line, and particles around the actor.
- A same-provider model change still pulses the cue without inventing a persona change; there is no extra text badge over the character.
- The inspector's `选定模型` line re-enters when the reported model changes. The cue itself is decorative, so the model text remains the accessible source.
- Reduced motion skips the overlay and updates the persona immediately. The `暂停状态动画` control pauses the cue's CSS animations as well.

`tests/model-switch.test.ts` covers detection truthfulness and `tests/model-switch-mounted.test.ts` mounts the live office to verify the cross-fade, model-only cue, automatic expiry, and reduced-motion fallback.

## Topology and inspection

- Self-office privilege and team leadership are separate explicit concepts.
- The physical floor is fixed: one owner desk and two independent private child desks; two three-seat public tables plus ten independent public desks and one dedicated GitHub desk. All 20 seats exist simultaneously.
- At most two child seats are expanded, with an explicit `+N` badge.
- Common-team capacity is 16; the separate GitHub role adds one dedicated seat. Explicit `team.seatAssignments` maps configured IDs to public physical seat IDs; remaining members are assigned deterministically without changing identities. Additional members remain in the inspector and an overflow notice. Unassigned seats contain furniture only, never synthetic agents or working/error displays.
- Status labels are independent of whether an actor is present, so an initial offline/unknown/stale observation is not mislabeled as missing data.
- The inspector separates effective status, source-reported status, source, connection, freshness, and observed time.
- Latest user request text, request time, and request source come only from `latestUserRequest`. Null stays explicitly unavailable. Replies, activities, model names, and former-epoch requests never become synthesized user requests.

## Browser example and verification

The “状态驱动办公室” tab runs `LiveOfficeExample`, which publishes explicitly labeled synthetic normalized DTOs through an `OfficeAdapter`. Manual controls demonstrate status changes, missing/partial coverage, stale state, epoch replacement, and all three topology modes. It has no network calls, real credentials, host connection, random status loop, or automatic narrative cycle. The page clearly says that no actual host is connected.

`tests/live-office-motion.test.ts` covers semantic transitions, missing data, reduced motion, epoch replacement, canceled departures, persona safety, child bounds, leadership, and geometry mapping. `tests/live-office-mounted.test.ts` mounts the actual React component under Strict Mode with an injected adapter and controlled scheduler. It covers the shared scene, latest-request truthfulness, mid-arrival/mid-sit pause, rapid status changes, monotonic expiry while paused, disconnect, offline exit, config rebinding, partial coverage, unknown persona, late callbacks, and complete teardown. Existing whole-office tests verify the shared presentation still preserves the 26-second demo and its geometry.

These are mounted DOM and deterministic contract tests, not an actual Electron installation or real-host end-to-end test. See [electron-integration.md](electron-integration.md) for that remaining host integration boundary.

## Fixed physical seat assignment

The floor contains all furniture at once; legacy `team.layout` is only a fallback allocation preference, not a visible room-layout switch. `independent-desks` / `leader-desks` allocate unassigned public members to desks first; `peer-table` allocates table seats first. Explicit positions always reserve their locations before fallback allocation. Member array order is stable and does not depend on network result ordering. A leader remains a data role, never an automatic private-office occupant.

In version-1 configuration, `office.team.seatAssignments` maps logical member IDs to physical seats, for example:

```json
{
  "deepseek": "public-table-1-seat-1",
  "chatgpt": "public-desk-1",
  "grok": "public-desk-2"
}
```

Allowed destinations are `public-desk-1` through `public-desk-10`, and `public-table-1-seat-1` through `public-table-2-seat-3`. The key must identify a configured public member. Duplicate destinations, private-room destinations, unknown fields and accessors are rejected. `bindOffice` remaps logical keys to actual epoch-bound IDs; hosts supplying `topology` directly use current agent IDs as keys.

`liveOfficeSeatReport(topology)` returns physical assignments plus child/public overflow IDs. A configured but temporarily missing agent keeps its reserved slot, while source freshness governs its neutral/absent visual state. Unconfigured physical slots stay empty and cannot emit statuses, request summaries or animation targets. Overflow members remain inspectable; they do not silently replace seated members. The self office always reserves one owner seat and at most two child seats.

## Dedicated GitHub desk

Optional version-1 `office.githubSeatId` references one explicitly configured logical seat. Direct topology uses optional `githubAgentId`. These identities must be distinct from owner, children, and common-team members; the dedicated desk is not a team-leader designation. Existing four-role configs remain valid and leave it empty. Selectors and freshness rules remain unchanged. The `github` character has its own approved atlases, not a borrowed persona.

The removed `public-table-3-seat-1` through `public-table-3-seat-3` IDs are rejected with a migration error. Explicitly choose a remaining public table or desk for affected members. They are never automatically moved to `github-desk`.

### Personal prop continuity

A fresh working/waiting/stopping/offline report interrupts self's leisure by reversing pickup or putting the weapon back before the return walk. Unknown/stale/disconnected and reduced-motion transitions freeze the exact personal pose; they never move the scythe back to its stand. A collector/source/topology replacement retains one unknown visual in the owner slot. Authoritative recovery allows that visual to return the prop before admitting the new instance. It cannot show working during this cleanup. Missing rows do not imply departure. Source and RAF generations still reject disposed callbacks. All personal art must load before a new action is admitted.
