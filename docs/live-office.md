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

The live controller does not call the demo reducer or replay a demo lifecycle. Repeated observations update state without restarting entry. Layout changes and rapid offline/return changes cancel obsolete travel rather than creating duplicate actors. Travel uses the calibrated logical geometry slot, while DOM identity and inspector selection use the actual normalized agent ID.

A single cancellable RAF drives transitions and actual active/idle cycles. Pausing freezes the exact current pose and position; it does not teleport to a reduced-motion endpoint. System reduced-motion preference settles transitions without animation. Freshness continues on a separate monotonic timer while animation is paused. Phase-only repeats of the same snapshot do not renew its freshness. Adapter callbacks are generation-guarded, and subscriptions, asset handlers, timers, media listeners, and RAF handles are released on unmount/reconnect.

## Topology and inspection

- Self-office privilege and team leadership are separate explicit concepts.
- Independent desks, leader desks, and peer-table layouts all use the approved spatial scene.
- At most three child seats are expanded, with an explicit `+N` badge.
- The approved physical team scene has three seats. Additional configured team members remain in the complete inspector list and an overflow notice; a configured leader is included in the visible three.
- Status labels are independent of whether an actor is present, so an initial offline/unknown/stale observation is not mislabeled as missing data.
- The inspector separates effective status, source-reported status, source, connection, freshness, and observed time.
- Latest user request text, request time, and request source come only from `latestUserRequest`. Null stays explicitly unavailable. Replies, activities, model names, and former-epoch requests never become synthesized user requests.

## Browser example and verification

The “状态驱动办公室” tab runs `LiveOfficeExample`, which publishes explicitly labeled synthetic normalized DTOs through an `OfficeAdapter`. Manual controls demonstrate status changes, missing/partial coverage, stale state, epoch replacement, and all three topology modes. It has no network calls, real credentials, host connection, random status loop, or automatic narrative cycle. The page clearly says that no actual host is connected.

`tests/live-office-motion.test.ts` covers semantic transitions, missing data, reduced motion, epoch replacement, canceled departures, persona safety, child bounds, leadership, and geometry mapping. `tests/live-office-mounted.test.ts` mounts the actual React component under Strict Mode with an injected adapter and controlled scheduler. It covers the shared scene, latest-request truthfulness, mid-arrival/mid-sit pause, rapid status changes, monotonic expiry while paused, disconnect, offline exit, config rebinding, partial coverage, unknown persona, late callbacks, and complete teardown. Existing whole-office tests verify the shared presentation still preserves the 26-second demo and its geometry.

These are mounted DOM and deterministic contract tests, not an actual Electron installation or real-host end-to-end test. See [electron-integration.md](electron-integration.md) for that remaining host integration boundary.
