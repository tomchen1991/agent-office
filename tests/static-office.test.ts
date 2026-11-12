import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Office deploys static assets and a constrained read-only Nginx WSS relay, without a Node service', () => {
  const nginx = read('deploy/office.falsita.cn.conf');
  assert.equal((nginx.match(/proxy_pass /g) ?? []).length, 1);
  assert.match(nginx, /location = \/api\/presence\/v1\/ws \{/);
  assert.match(nginx, /if \(\$http_origin != "https:\/\/office\.falsita\.cn"\) \{ return 403; \}/);
  assert.match(nginx, /if \(\$request_method != GET\) \{ return 405; \}/);
  assert.match(nginx, /if \(\$args != ""\) \{ return 400; \}/);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:18788;/);
  for (const header of ['Origin', 'Authorization', 'Cookie']) assert.ok(nginx.includes(`proxy_set_header ${header} "";`));
  assert.ok(nginx.indexOf('return 403') < nginx.indexOf('proxy_set_header Origin ""'));
  assert.match(nginx, /limit_conn office_ws_per_ip 4;/);
  assert.match(nginx, /limit_conn office_ws_total 12;/);
  assert.match(nginx, /proxy_read_timeout 75s;/);
  assert.match(nginx, /location \/api\/ \{ return 404; \}/);
  assert.match(nginx, /connect-src 'self';/);
  assert.ok(!read('vite.config.ts').includes('presenceProxy'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies.ws, undefined);
  for (const path of ['deploy/agent-office.service', 'server/presenceServer.ts', 'server/presenceProxy.ts', 'server/presenceStreamServer.ts']) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, `${path} must not be deployed`);
  }
  for (const path of ['src/presence.ts', 'src/presenceStream.ts', 'src/presenceConfig.ts']) {
    assert.doesNotMatch(read(path), /from ['"](?:node:|\.\.\/server\/)/);
    assert.doesNotMatch(read(path), /\/api\/office\/presence/);
  }
});
