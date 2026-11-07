# Presence 协作 PI 展示

真实 presence 现在按 pi-monitor 上报的协作组名安排公共协作桌，不再把协作 PI 全部分到独立桌。

- 精确识别上报端注册标签：`DeckZ 协作 PI`、`DeckZ 长线协作 PI`、`Desk 协作 PI`；也接受明确的 `task_type: coding_collaboration`。
- 自定义发布者可在后端私有 presence 配置中设置 `sourceKinds[sourceId] = "pi-collaboration"`。仅当该来源全部为协作实例时使用；普通/协作混合来源不要整体标记。
- 空闲时 `task_type` 可以为空，已注册的协作标签仍有效。`task_name` 作为当前注册组的展示名；未上报组名时不猜测分组。
- 同名组优先同桌，最多两组各三席。组内存活实例保持原座位；超过三位或两组的成员使用可用独立席。普通 PI 不因模型、仓库或相似名字被归组。
- 桌前显示组名及该桌人数，详情显示协作组。过期或断连时保留的组名明确标注“最后观察”；组名不构成父子关系或唯一团队身份。

验证：`node --test tests/presence-proxy.test.ts tests/presence-collaboration-mounted.test.ts`；`npm run build`。

已部署到 `https://office.falsita.cn`，版本 `/opt/agent-office/releases/20261105T020224Z`。回滚目标 `/opt/agent-office/releases/20261104T103035Z`。仅重启 `agent-office`，未修改采集服务或私有配置。

生产构建与 24 项针对性测试通过；公网页面、新 JS/CSS、presence API 与 WebP 素材均验证 200。线上观察到三组协作 PI：两组使用不同协作桌，第三组及单组超过三席的成员使用独立桌，没有混组占桌。当时未观察到 fresh `DeckZ 长线协作 PI`，因此没有声称完成长线实例的线上验收。未执行浏览器视觉验收；全量历史测试不是本次发布通过项。
