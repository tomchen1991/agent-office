import assert from 'node:assert/strict';

/** Operational labels are intentional; reject unrelated decorative scene prose. */
export function assertOperationalSceneCopy(world: Element): void {
  const copy = world.cloneNode(true) as Element;
  const residentNames = [...copy.querySelectorAll('.wo-resident-name b')].map(node => node.textContent);
  if (residentNames.length) assert.deepEqual(residentNames.sort(), ['主 Agent', 'Auto-fix', 'DevOps', '热点追踪'].sort());
  const title = copy.querySelector('.wo-devops-room-title');
  if (title) assert.equal(title.textContent, 'DEVOPS / 运维办公室');
  const monitor = copy.querySelector('.devops-monitor');
  if (monitor) {
    assert.equal(monitor.getAttribute('aria-label'), 'DevOps 服务监控');
    assert.match(monitor.textContent ?? '', /服务监控/);
    assert.match(monitor.textContent ?? '', /未连接|数据不可用/);
    assert.equal(monitor.querySelectorAll('.devops-services li').length, 0, 'unconfigured monitor must not fabricate service health');
  }
  copy.querySelectorAll('.layout-picker,.wo-resident-name,.wo-devops-room-title,.devops-monitor').forEach(node => node.remove());
  assert.doesNotMatch(copy.textContent ?? '', /[\p{L}]/u, 'only resident identities and operational monitor copy belong in the scene');
}
