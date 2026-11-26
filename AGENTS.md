# Agent Office 工作指引

- **当前行为以源码和测试为准。** 从 [README](README.md) 找入口；网页入口、公开 WSS 配置与部署模板分别在 `src/main.tsx`、`src/presenceConfig.ts` 和 `deploy/office.falsita.cn.conf`。`server/` 是可选 Electron main 适配库，不是 Office 网页后端。
- **不要用源码默认值推断线上。** 先看 [部署证据与源码差异](docs/office-deployment.md#production-evidence-and-source-differences)；区分源码行为、带日期的线上观测和历史发布。仓库的浏览器直连模板不能直接覆盖线上同源 WSS 配置。旧 Node 服务、systemd 命令和旧回滚步骤仅用于对应历史版本。未经明确授权，不部署、不改生产配置、不重启服务。
- **保持展示数据边界。** 身份由显式配置绑定，不按模型或显示名猜测；模拟状态、未知或过期观测不能冒充实时状态。不要把凭据放进前端、URL 或版本控制。详见 [Presence WebSocket](docs/presence-websocket.md) 和 [接入边界](docs/integration.md)。
- **按变更验证。** 项目支持 Node.js 24+；代码变更可用 `npm run check` 验证。文档变更检查链接和 `git diff --check`。报告实际跑过的检查，区分合成测试、真实浏览器和生产验证，不引用历史通过数作为当前结果。
