# DevOps Agent 消费侧展示

复用已批准的 DevOps 图集与 `devops-desk`，不新增素材、采集协议或监控健康接口。

## 身份接线

- `src/presenceConfig.ts` 显式将 `devops-agent` 映射为 `devops`；该来源名与 DevOps 仓库 `config/presence.example.json` 一致，且本地交接文件 `/tmp/devops-agent-presence-handoff.md` 第 12 节记录 2026-11-13 已冷加载该来源及独立 producer scope。这是历史授权配置证据，不证明当前 publisher 已启用。实际启用配置必须保持一致，不按显示名字或模型猜身份。
- `(sourceId, instanceId)` 仍是人物键，instanceId 可以随后端进程重启变化，不硬编码 UUID。
- `presenceTopology` 选择唯一 fresh 且未退出实例；多个活跃候选保持空位。重启后保留的旧 stale/stopping 实例不抢新实例工位。仅一个保留实例时允许在原工位显示其未知/退出状态。
- DevOps 来源不占公共席位，模型外观和 provider/model 数据不改变角色身份。渲染层沿用 `residentPersona` 选择 DevOps 素材。
- working、idle、waiting、unknown 沿用采集状态；stopping 归一化为 offline，执行既有退场。失鲜和断连不得继续展示工作。
- 点击人物展示已有任务、仓库、来源与新鲜度。房间大屏仍明确未连接，人物在线不代表服务健康。

## 验证与边界

- `tests/presence.test.ts` 覆盖默认映射、模型变化、重启、歧义、失鲜、退出、公共席位隔离及不按名字猜身份。
- `tests/devops-presence-mounted.test.ts` 将合成 collector 行经真实归一化逻辑送进 React 场景，检查 DevOps 人物素材、工位、任务详情和状态切换。它是 JSDOM 挂载证据，不是生产截图或真实浏览器端到端证据。
- 2026-11-16 公开只读 HTTP 快照尚未观察到 sourceId 包含 devops 的实例。生产 producer 是否启用及 sourceId 的最终确认仍由 DevOps 侧负责；本 PR 不修改其配置或凭证。
- 同日带 `Origin: https://office.falsita.cn` 的公开 WS Upgrade 返回 403；Office 线上 CSP 仍为 `connect-src 'self'`。当前源码的纯静态跨源直连不能因此宣称已在线贯通。采集服务需要明确允许 Office Origin，发布时还需同步已有静态部署模板的 CSP。见 [直连前置条件](presence-direct.md)。
- 服务侧正在独立分支 `feat/office-presence-ws-origin` 开发 `presenceWsAllowedOrigins` 精确 Origin 配置，默认 `[]`；候选配置仅为只读 Presence WS 放行 `https://office.falsita.cn`，不改变 HTTP、producer 或 admin 权限。该配置尚未部署，不能当作已可用入口；部署后仍需真实浏览器验证。
- 本次不合并、不部署，不恢复旧 Node 代理，不清除/改写 Origin 绕过同源检查，不发送合成人物到生产采集服务。
