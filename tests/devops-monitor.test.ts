import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('visual monitor has no data integration or scheduled work', () => {
  const component = readFileSync(new URL('../src/DevopsMonitor.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|setInterval|setTimeout|snapshot|DevopsSnapshot)\b/);
  assert.doesNotMatch(component, /\/api\/|OFFICE_DEVOPS|https?:\/\//);
  assert.equal(existsSync(new URL('../src/devopsMonitor.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../server/devopsMonitor.ts', import.meta.url)), false);
});

test('compact monitor fills its query-container wrapper without desktop fixed sizing', () => {
  const css = readFileSync(new URL('../src/devops-monitor.css', import.meta.url), 'utf8');
  assert.match(css, /\.devops-monitor--compact\{height:100%;/);
  assert.match(css, /\.devops-monitor--compact \.devops-empty\{height:auto;min-height:0;flex:1;/);
  assert.match(css, /\.devops-monitor--compact header>strong\{font-size:2\.1cqw/);
  assert.match(css, /\.devops-monitor-dialog\{[^}]*font:14px/);
});
