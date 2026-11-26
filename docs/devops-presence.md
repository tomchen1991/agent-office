# DevOps Agent 消费侧展示

DevOps presence 复用已批准的默认 DevOps 图集与 `devops-desk`，不新增采集协议或监控健康接口。补充动作素材的接入状态见 [角色素材](resident-sprites.md)。

## 身份接线

- `src/presenceConfig.ts` 显式将 `devops-agent` 映射为 `devops`；该来源名与 DevOps 仓库 `config/presence.example.json` 一致，且本地交接文件 `/tmp/devops-agent-presence-handoff.md` 第 12 节记录 2026-11-13 已冷加载该来源及独立 producer scope。这是历史授权配置证据，不证明当前 publisher 已启用。实际启用配置必须保持一致，不按显示名字或模型猜身份。
- DevOps 来源方已在其 PR #20 提交 `78fb3b4` 的 `docs/devops-plan/evidence/a63a-collect-integration.md` 确认约定 `sourceId=devops-agent`、仅一个长期主 Agent/单后端 publisher，无子 Agent 或多主选举字段；provider/model/repo 均可为 null。该文档包含真实 collect loopback 全状态验证，不是生产启用或 Office 浏览器验证。
- `(sourceId, instanceId)` 仍是人物键，instanceId 为每后端进程启动生成的随机 UUID，进程内稳定、重启变化，不硬编码 UUID。
- `presenceTopology` 选择唯一 fresh 且未退出实例；多个活跃候选保持空位。重启后保留的旧 stale/stopping 实例不抢新实例工位。仅一个保留实例时允许在原工位显示其未知/退出状态。
- DevOps 来源不占公共席位，模型外观和 provider/model 数据不改变角色身份。渲染层沿用 `residentPersona` 选择 DevOps 素材。
- working、idle、waiting、unknown 沿用采集状态；stopping 归一化为 offline，执行既有退场。连接正常且新鲜的显式 unknown 可直接使用中性坐姿；失鲜和断连不得继续展示工作，也不凭缓存生成新人物。
- 点击人物展示已有任务、仓库、来源与新鲜度。房间大屏仍明确未连接，人物在线不代表服务健康。

## 验证与边界

- `tests/presence.test.ts` 覆盖默认映射、模型变化、重启、歧义、失鲜、退出、公共席位隔离及不按名字猜身份。
- `tests/devops-presence-mounted.test.ts` 将合成 collector 行经真实归一化逻辑送进 React 场景，检查 DevOps 人物素材、工位、任务详情和状态切换。它是 JSDOM 挂载证据，不是生产截图或真实浏览器端到端证据。
- 2026-11-16 公开只读 HTTP 快照尚未观察到 sourceId 包含 devops 的实例。来源方现已确认 sourceId 约定；生产 producer 是否启用、当前实际 scope 是否有效仍未核验，本 PR 不修改其配置或凭证。
- 同日 Office Origin 访问 collector **跨源** WS 返回 403。该结果不测试 Office 的**同源** WSS 路径；线上入口证据见 [部署记录](office-deployment.md#production-evidence-and-source-differences)。跨源 Origin 候选及验证条件统一见 [直连说明](presence-direct.md#跨源直连前置条件)。
- 这里的验证不要求恢复旧 Node 后端，也不需要向生产采集服务发送合成人物。
