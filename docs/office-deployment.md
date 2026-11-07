# Office production deployment

## Latest release: presence stopping departure (2026-11-06)

- URL: https://office.falsita.cn
- Release: `/opt/agent-office/releases/20261106T074922Z`; rollback: `/opt/agent-office/releases/20261105T020224Z`.
- Backend-only release copied from the previous deployed release; only `server/presenceProxy.ts` replaced. Frontend assets, collector, Nginx and private credentials unchanged. Only `agent-office` restarted.
- Presence `stopping` maps to `offline`; offline public seat bindings survive freshness expiry to allow existing stand/exit animation to finish. Live dedicated replacements take precedence over retained offline records. See [presence-departure.md](presence-departure.md).
- 13 targeted tests and typecheck passed. Deployed source checksum matched local; deployed module mapping/binding probe passed. Service active and loopback API healthy. Public page/API returned 200 using curl; Python urllib received 403 from the public route.
- Public verification observed 9 instances (8 idle, 1 working), no stopping/offline instance, so no real departure or browser visual acceptance claimed. Broader LiveOffice mounted tests were previously attempted and failed; no full-suite pass claimed.

## Previous release: collaboration PI tables (2026-11-05)

- URL: https://office.falsita.cn
- Release: `/opt/agent-office/releases/20261105T020224Z`; rollback: `/opt/agent-office/releases/20261104T103035Z`.
- Exact registered collaboration labels (including long-term PI) and reported group names now drive two separate three-seat tables. Further groups/extra members use independent seats; details retain group metadata.
- Only `agent-office` restarted. No Nginx, consumer credentials, or collector configuration changes.
- Production build/typecheck and 24 targeted tests passed. Public HTML, current hashed JS/CSS, presence API and representative WebP asset returned 200. API verified unique seating and no mixed collaboration groups at a table.
- Observed three fresh groups, but no fresh long-term-labeled instance at verification. No browser visual acceptance or full historical suite pass claimed. See [presence-collaboration.md](presence-collaboration.md).

## Previous update: public display and first-paint optimization

Owner explicitly requested removing viewer authentication. That release `/opt/agent-office/releases/20261104T101830Z` served both display and read-only DTO publicly; anyone with the URL can view task/repo information. Consumer credentials remain private. Old viewer-password files are no longer referenced; the authenticated deployment below is historical.

- Nginx Basic authentication removed; anonymous public page/API verified 200.
- Asset cache: public, max-age=86400. HTML and live API remain no-store; gzip enabled for JS/CSS/JSON.
- Build creates lossless WebP delivery copies, preserving original source assets: 16 atlases, 15.8 → 11.1 MiB overall. Runtime requests WebP only in production.
- Load seated atlases only for observed fresh personas first; background load locomotion/extra/sleep sheets afterwards. A single missing atlas no longer blocks the whole office; each character draws when its own active sheet is loaded.
- Initial snapshot is rendered seated rather than replaying a six-second arrival. New arrivals after initial observation retain their entrance animation. Added mounted hook test verifies this distinction.
- Production backend uses fixed authenticated loopback `127.0.0.1:18788`, Host `collect.falsita.cn`, avoiding a VPS→Cloudflare→same-VPS hop. Local development continues to use HTTPS. Token never enters browser, URL or logs.
- Checks: build/typecheck passed; 10 existing targeted tests plus new hydration test passed. Anonymous public API observed at ~399ms from developer machine in one request (not a performance guarantee); same-VPS authenticated upstream read ~10ms. No claim of measured full browser first paint.

## Deployment 2026-11-04

- URL: https://office.falsita.cn
- SSH host: root@124.220.74.235 (VM-0-10-ubuntu)
- Release: `/opt/agent-office/releases/20261104T100834Z`
- Active symlink: `/opt/agent-office/current`
- Dedicated service: `agent-office.service`, unprivileged `agent-office` user, Node 24, loopback `127.0.0.1:5188` only.
- Nginx: `/etc/nginx/conf.d/office.falsita.cn.conf`; existing wildcard Cloudflare Origin CA certificate; HTTPS through Cloudflare Full (strict).
- UI entry now renders only PresenceOffice: office scene and agent detail modal. Debug navigation, camera controls, night settings and coverage messages are hidden. Read failures retain a small alert rather than silently claiming online state.
- Static `dist` is served by Nginx. No Vite development server or public source/config files.
- Only `/api/office/presence` is proxied to the Node backend. Backend reads the fixed collect-service instances endpoint with a private consumer token; browser Basic credentials are stripped by Nginx and are never forwarded upstream.

## Private configuration (never commit contents)

- Server consumer config: `/etc/agent-office/presence.json`, root:agent-office 0640.
- Server viewer password hashes: `/etc/agent-office/viewers.htpasswd`, root:www-data 0640.
- Parent directory: root:root 0711.
- Local viewer access details: `~/.config/agent-office/office-viewer.json`, 0600; independent from consumer token.
- Entire website and API require viewer Basic authentication over HTTPS. No API bypass under static routes. Access/error logs disabled for this vhost.

## Verification

- Local production build/typecheck passed; 10 targeted tests passed (presence authorization boundary/provider mapping/seating/restarts/staleness, live motion, seated leisure).
- `nginx -t` passed; existing Nginx reloaded, no other vhost modified.
- systemd service active, loopback health 200; confirmed no public 5188 listener.
- Direct origin HTTPS validated against the pinned certificate obtained via SSH, with hostname verification: anonymous page/API 401; authenticated page/API/bundled JavaScript 200.
- Public Cloudflare HTTPS authenticated page and API both 200; API returned 3 instances at verification time. Counts are observations, not expected inventory.
- No browser visual acceptance or complete historical test suite claimed for this deployment.

## Operations

- `systemctl status agent-office` / `systemctl restart agent-office`
- Runtime private config is reread on each request; no frontend build required for source/persona mapping.
- Deploy immutable release directories, change `/opt/agent-office/current`, restart only agent-office, validate health/API before declaring success.
- Rollback: point current to a previous validated release and restart agent-office. This is the first deployed release, so no older production release exists yet. Disable this vhost/service if rollback to an absent deployment is needed; do not touch collect-service.
- Seats are in-memory in this Node process; restart initializes them once. Source instances are read-only; this service does not submit heartbeat or change Agent state.
