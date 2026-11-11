import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Office deploys static assets only, without an API proxy or Node service', () => {
  const nginx = read('deploy/office.falsita.cn.conf');
  assert.ok(!nginx.includes('proxy_pass'));
  assert.match(nginx, /location \/api\/ \{ return 404; \}/);
  assert.match(nginx, /connect-src 'self' wss:\/\/collect\.falsita\.cn/);
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
