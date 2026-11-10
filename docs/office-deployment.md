# Office production deployment

## Latest infrastructure update: public ACME TLS (2026-11-09)

- User authorized office TLS maintenance via acme.sh, explicitly after collect TLS migration completed. Waited for the collector owner to confirm no remaining ACME/Nginx work before changing office.
- Replaced office's shared Cloudflare Origin CA certificate with an independent Let's Encrypt ECC ec-256 certificate for `office.falsita.cn`, using existing root `/root/.acme.sh/acme.sh` v3.1.5 and `dns_cf` DNS-01. Existing private account configuration reused in place, never printed/copied; no DNS proxy mode, account credentials, HTTP redirects or application settings changed.
- Installed files: `/etc/nginx/ssl/office.falsita.cn/{fullchain.pem,key.pem}`, root:root 0600, parent root:root 0700. Certificate expires **2027-02-07 09:00:16 UTC**; acme.sh recorded next renewal **2027-01-07 18:57:13 UTC**.
- Existing root cron retained: daily at server-local 03:17, `/root/.acme.sh/acme.sh --cron --home /root/.acme.sh > /var/log/acme.sh.cron.log 2>&1`. Per-domain install paths and `nginx -t && systemctl reload nginx` hook saved by `--install-cert`. Future renewal not forced or simulated; configuration and current install/reload verified.
- Changed only office's two certificate directives and explanatory comment; all other vhost hashes checked unchanged. Nginx syntax test/reload passed, office PID stayed **3335717**, no application/collector restart. Repository Nginx template updated to avoid restoring Origin CA paths on future releases.
- Initial probe immediately after reload failed certificate verification and automatically restored the prior office vhost. Installed chain verified against the system trust store and key matched; a subsequent bounded post-reload wait succeeded. TLS verification was never disabled.
- External HTTPS both forced directly to `124.220.74.235` and via normal DNS: 200, certificate verify 0. Direct and normal-DNS office WSS upgrades: 101, trusted certificate for office.falsita.cn, Let's Encrypt issuer YE2. Existing collect public readiness remained 200 with TLS verify 0.
- Backup/audit: `/srv/backups/agent-office-tls.NnkBTA` holds original office vhost, pre-change vhost checksums, application PID evidence and private ACME logs. Original shared Origin CA files and other domains' certificates retained.
- Rollback: restore that office vhost, `nginx -t`, reload Nginx only. Do not remove shared Origin CA files or change collect/other vhosts; if permanently reverting, separately adjust office's acme install hook to match intended operations. The failed first attempt exercised configuration restoration, not future certificate-renewal failure handling.

## Latest application release: compact rooms and overflow actors (2026-11-10)

- User authorized committing, pushing and deploying the reviewed office presentation. Application source `326920d` was pushed to main before activation. DevOps / hotspot backend identity wiring remains deferred; no new interface or private mapping was added.
- Release: `/opt/agent-office/releases/20261110T103000Z-office-layout`; rollback: `/opt/agent-office/releases/20261109T104111Z-empty-circle`. Full source commit is recorded in `SOURCE_COMMIT`.
- Includes 20-seat stacked rooms, unified door geometry, visible framed windows, equal-scale responsive floor, removal of geometric placeholder plants, and overflow child/team actors. Overflow idle uses walking artwork; working remains a standing fallback until tablet artwork is supplied.
- Local `npm run check`: **262 tests passed**, asset integrity passed, TypeScript and production build passed. The npm test command now explicitly uses development mode so React mounted tests work when the parent terminal exports production mode. VPS production dependencies installed with lifecycle scripts disabled; **15 backend tests passed** before activation.
- Archive SHA256: `d83b4e79a58b2517493bbe086b750f6a9a56f035f94e54139d2669951df12504`. Release permissions normalized and readability checked as both the service and Nginx users. Dependencies installed within the release, not linked to a previous release.
- Atomically switched current and restarted **only agent-office**. No Nginx reload, TLS/config changes or collector operations. All Nginx vhost and private office consumer configuration checksums remained unchanged. Health and presence read endpoints succeeded after restart; an initial health retry during startup was expected and recovered.
- Public HTTPS HTML referenced `index-Do_2Aykm.js`; JS, `index-BFKfWknL.css`, DevOps and hotspot seated WebP samples returned 200 with byte hashes matching local build. Certificate verification remained enabled.
- Public WSS delivered initial, change and heartbeat snapshots with continuous sequence (1–7 during observation) and complete identity coverage. Observed 12 retained instances; this is not an inventory guarantee. No raw task payloads or credentials were printed, and no upstream state was written to manufacture a test case.
- Browser production visual acceptance was not performed in this deployment. Screenshot-driven local refinements and automated tests do not guarantee every sprite/door occlusion or extreme overflow case.
- Backup/audit: `/opt/agent-office/deployment-backups/20261110T103000Z-office-layout`. Activation had an error trap to restore the previous symlink and restart agent-office; rollback was not required. To revert, atomically restore the rollback release and restart only agent-office; leave Nginx, TLS and collector unchanged.

## Previous application release: offline monitor empty circle (2026-11-09)

- Source `4e6edef05477219aff04dc04c2c9d09f84de1d79` was already committed and pushed; user requested checking and completing the missed deployment. Offline occupied monitors now show `○`, while idle and unknown retain their distinct symbols.
- Release: `/opt/agent-office/releases/20261109T104111Z-empty-circle`; rollback: `/opt/agent-office/releases/20261109T102354Z-monitor`. Source commit is recorded in release `SOURCE_COMMIT`.
- Mounted regression: 4 tests passed; TypeScript and production build passed. Public HTML references `index-C8S9QNQe.js`; public JS/CSS/presence API returned 200 with TLS verification 0. No production browser visual acceptance or full-suite pass claimed.
- Server sources, core and package/lock verified identical before switching static files. No application restart, Nginx reload/config change, or collector operation. Existing office PID and all vhost/private consumer config hashes unchanged.
- Archive SHA256: `e0e44171df7c5a68cccb7c6a77d721a73a62bf5322f55dda14e479df4c48bbd1`. Removed macOS AppleDouble archive sidecars before activation. First activation probe caught restrictive staging-root permissions and automatically restored the previous symlink; normalized release ownership/root permissions and successfully repeated activation.
- Backup/audit: `/opt/agent-office/deployment-backups/20261109T104111Z-empty-circle`. Dependencies link to the previous release; retain it (also still used by the unchanged running backend). Rollback is an atomic current symlink switch without restarting the backend.

## Previous application release: offline monitor reset (2026-11-09)

- User explicitly authorized commit, push and deployment after reviewing the fix. Main commits: `a1d0299` records previously deployed ACME TLS; `81d1f3d` fixes offline monitor reset and adds mounted regression tests. Both pushed before activation.
- New release: `/opt/agent-office/releases/20261109T102354Z-monitor`; rollback: `/opt/agent-office/releases/20261109T084727Z-ws`.
- Archive SHA256: `eb6d31731c785351b87b8654ab67fe6536797bfe5e82c7e6561c236ea1e45c76` (committed source plus built dist, no credentials/node_modules). Production dependencies installed in the new directory.
- Explicit offline records no longer supply task/repo text to monitors, even while retained upstream. Computers return to idle on the exit notification, without waiting for the 6-second departure animation or 10-minute cache retention. Inspector history and uncertain last observations remain available.
- Local build/typecheck and 32 targeted tests passed. New mounted regression was verified to fail before the fix and pass after; covers immediate reset, completed departure, later stale offline heartbeats, restored live state, reduced motion, and retained unknown/inspector history. VPS production-dependency backend checks: 15 passed. No claim that the previously failing full historical suite now passes.
- Verified every server source file, src/core.ts and package/lock are identical between releases. Atomically switched current for Nginx static delivery only: **no application restart, no Nginx reload or config edits**, no collector operations. Existing office PID **3335717** unchanged. All live vhost and private office config checksums unchanged, including ACME certificate paths.
- The running backend still has the old identical server code loaded from the retained old release. Keep that directory while the process uses it; the next normal service restart will load the new current path. No restart was needed for this frontend-only fix.
- Public HTML/current JS `index-BGgHGw5H.js`/CSS returned 200, TLS verify 0. Real headless Chrome ran 21 seconds with one WSS connection, initial/heartbeat updates, 11 rendered actors/sprites, no alert/exception/failed application request, and zero old HTTP polls. Counts are observations, not inventory guarantees.
- No retained offline instance was visible during the production Chrome check (0 applicable monitors). Thus production basic connectivity/rendering is verified; the specific reset behavior is covered by synthetic mounted regression, not a deliberately triggered real agent exit. No production state was written or source enabled to create a test case.
- Backup/audit: `/opt/agent-office/deployment-backups/20261109T102354Z-monitor` records previous release, config checksums, unchanged process PID. Rollback is an atomic current symlink switch to the previous release; do not alter TLS/collector/config or restart the unchanged backend merely to roll back static assets.

## Previous application release: presence WebSocket (2026-11-09)

- URL: https://office.falsita.cn
- Source commit: `49abb0623636a027d1e8945d55183fbc1e51c3be` on main, pushed before deployment.
- Release: `/opt/agent-office/releases/20261109T084727Z-ws`; rollback: `/opt/agent-office/releases/20261107T095532Z`.
- Archive SHA256: `cf61f2ce00548051f57bbe4cb7d3b62f8da9f48641246a70fb7fab2b9e9db121` (committed source plus locally built dist, no credentials/node_modules).
- User authorized commit/push to main, then real integration after collector deployment, then office deployment only on success. Collector was confirmed at `/opt/collect-service/studio-releases/presence-ws-reviewed.89UuOD` before and after this office deployment; this task did not restart or modify it.
- Replaced browser 5-second HTTP polling with same-origin WS; one authorized upstream shared by viewers, full snapshots on change/15-second heartbeat, 35-second application watchdog. See [presence-websocket.md](presence-websocket.md).

### Tests before activation

- Local build/typecheck and 22 targeted tests passed; production-dependency install plus 15 backend targeted tests passed on VPS. No full historical suite pass claimed (earlier full run had 7 failures, documented in the WS implementation note).
- Using the existing office consumer config without printing payloads/credentials, public collector WSS delivered initial and heartbeat with continuous sequence/stable processId for 17 seconds.
- Candidate served only on VPS loopback:5199 as the existing unprivileged agent-office user, accessed through a temporary SSH tunnel. Real headless Chrome received initial/heartbeat and change frames, rendered CSS sprites, had no alert/runtime exception/failed request, and issued zero old presence HTTP polls. Final candidate run observed 14 actors; this is not an inventory guarantee.
- Temporary browser harness initially asserted canvas rendering, but this scene uses CSS sprites; the harness was corrected without changing application code. Early harness cleanup attempts timed out; final runs cleaned up Chrome and returned successfully. Candidate process/tunnel were stopped before production activation; loopback:5199 was absent afterwards.

### Activation and production verification

- Installed production dependencies in the new release; atomically changed current, restarted only agent-office, added only the exact office WS Nginx location, ran nginx -t and reloaded Nginx. Before changing the vhost, the script verified all other live Nginx contents matched the existing template.
- Backups: `/opt/agent-office/deployment-backups/20261109T084727Z-ws` contains original office vhost, previous release path and config checksum. Existing private consumer config checksum unchanged. Other services, collector settings and credentials untouched.
- Public HTML/current JS/CSS returned 200. Production headless Chrome received initial/change/heartbeat via exactly one WSS connection, had no office alerts or runtime exceptions, and sent zero old presence HTTP requests over 21 seconds. Rendered actor/sprite count varied with live observations (14 earlier, 1 in final run); no state was written or source enabled to manufacture a scenario.
- Cloudflare injected `static.cloudflareinsights.com` script was blocked by the existing self-only CSP. Initial strict network check reported this as a failure; final check reports it separately, with zero failed application requests. CSP/Cloudflare settings were not loosened.
- Missing/foreign WS Origin rejected 403; legacy HTTP read 200; service active, loopback health ok, only 127.0.0.1:5188 listening. No production agent change was triggered deliberately; actual observed change frames plus synthetic regression cover the update path, not all possible transitions or long-term reliability.
- Rollback: restore current to the previous release, restore the saved office vhost, restart agent-office, nginx -t then reload. Do not modify collector/database/private config. Rollback path retained, not exercised.

## Previous release: model switch animation (2026-11-07)

- URL: https://office.falsita.cn
- Release: `/opt/agent-office/releases/20261107T095532Z`; rollback: `/opt/agent-office/releases/20261106T074922Z`.
- Full frontend and source release. A provider/model change on the same presence identity now cross-fades the displayed persona with an accent ring, scan line, and particles; no text badge is rendered over the character. Same-provider model changes pulse without inventing a persona change. The release also contains the collaboration-table and stopping-departure code from the previous backend deployments.
- Build/typecheck passed. Targeted model-switch detection/mounted, live-motion, hydration, night-rest, scythe handoff, collaboration, proxy, and whole-office tests passed. The known `tests/live-office-mounted.test.ts` failures were reproduced on clean `HEAD`; no full-suite pass is claimed.
- Only `agent-office` was restarted. Public HTML, current hashed JS/CSS, API, and WebP assets returned 200; loopback `/health` and presence API returned 200. The deployed CSS/JS contain the model-switch rules and markup. A local headless-Chrome frame check confirmed the cross-fade; live model switching was not triggered through production presence during verification.

## Previous release: presence stopping departure (2026-11-06)

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
