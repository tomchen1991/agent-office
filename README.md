# Agent Office

将 Agent 的工作状态变成可视化办公室，使用 **React + TypeScript**。网页部署是纯静态前端：浏览器直接从采集服务订阅数据并完成展示计算，不运行 Office 后端。可选 Electron main 进程适配库单独保留。

## 当前阶段

**直连迁移尚未部署**：当前采集接口仍拒绝浏览器 Origin，只接受机器 Bearer 鉴权。必须先提供浏览器可用的只读订阅入口；不能直接发布当前构建替换线上旧架构。见 [直连接入与前置条件](docs/presence-direct.md)。本改动未修改采集服务，也未改线上。

默认打开 **真实 presence 状态办公室**（WebSocket），采用无工具栏展示；开发环境可用 `?simulate=1` 打开合成状态示例。独立动作演示组件仍保留在源码中，但不是默认入口。这仍是原型，不是完整产品：

- 已确认的自研 Agent 站姿、华丽镰刀 V2、待机 GIF 和透明四帧图集已保存。
- DOM / CSS 固定办公室：左侧上方主办公室 1 个大工位，下方 DevOps 办公室安置 Auto-fix 和 DevOps；公共区域 2 张三人协作桌 + 10 个普通独立工位 + 右上方热点追踪专属桌，共 20 个实体席位；子 Agent 使用公共空席，空位不生成 Agent。
- 主 Agent、Auto-fix、DevOps、热点追踪四种常驻身份使用独立桌面配色与 SVG 装饰；身份与模型外观分离，不按供应商或名字猜身份。
- DevOps 房间大屏为纯视觉占位，始终明确未连接；没有新增监控 API、轮询或协议，不使用人物 presence 冒充服务健康。详情见 `docs/resident-offices.md` 与 `docs/devops-monitor.md`。
- 基于 2250×1050 布局的场地铺满视口，不居中留白；只调整房间与工位间距，人物和家具保持比例。默认无工具栏，窄屏保留区域定位与滚动。点击角色查看任务、状态来源与新鲜度；播放 / 暂停、缩放等控制保留在非展示模式。
- 解耦展示 DTO 与订阅接口；默认 presence WebSocket，Node-only collect 状态轮询适配器单独提供，支持完整顺序分页与非原子覆盖标注。
- 版本化 JSON 配置导入 / 导出 API、显式席位与实例绑定、可信宿主请求增强接口；歧义保持空位，不自动猜角色。
- 自研 Agent、DeepSeek、ChatGPT、Grok、GitHub Agent、DevOps、热点追踪各自拥有独立动作图集，按 32.5 秒演示进场 → 坐下 → 工作 → 摸鱼 → Error → 起身 → 退场；支持暂停、重播和阶段选择。
- 整体演示在独立办公室、普通工位 / 共享桌及 GitHub 专属桌播放角色动作；真实状态办公室复用相同空间（新增角色未绑定时只显示家具），不把演示剧情当作真实状态。
- 主 Agent、Auto-fix、DevOps 与热点追踪四位常驻角色支持夜间空闲趴桌休息、任务唤醒；默认本机 22:00–07:00 可调整。演示页可选择模拟夜间，实际状态仍须连接正常且可靠空闲，不表示 Agent 停机。
- 真实状态的超量团队 / 子 Agent 不占虚构工位：可靠空闲时沿公共通道游荡，工作时原地使用平板；平板素材待提供，当前用站姿兜底。未知、断连、过期停止动作，可直接点击查看详情。见 `docs/overflow-agents.md`。独立动作演示仍仅安排两个模拟子角色。
- 安全 main/preload IPC 集成层及真实归一化状态驱动场景已提供；状态控制台是明确合成数据演示。
- 线上 `https://office.falsita.cn` 仍使用旧版 Node 转发架构；当前源码已移除该后端，直连尚待采集服务接口支持及上线验证。历史部署记录见 `docs/office-deployment.md`，新部署方案见 `docs/presence-direct.md`。未做 Electron 宿主联调，不调用模型。
- 角色动作图集已生成并接入，仍需精修帧间一致性，不宣称逐像素锁定的生产级精灵。

## 本地运行

需要 Node.js 24+ 与 npm（测试脚本使用 Node 原生 TypeScript 支持）。

```sh
npm ci
npm run dev
```

Vite 仅监听本机回环地址，只提供前端、不代理采集接口。`VITE_PRESENCE_WS_URL` 设置公开的采集服务 WSS 地址（见 `.env.example`），显式角色映射在 `src/presenceConfig.ts`。不要配置任何 VITE token。采集服务尚未支持浏览器时，默认页面会显示直连失败；本地可用 `?simulate=1` 查看合成状态场景。

```sh
npm run typecheck
npm test
npm run verify:assets
npm run build
# 或一次运行全部现有检查
npm run check
```

生产预览：`npm run preview`。构建使用相对资源路径，便于将来嵌入 Electron renderer；目前并不宣称已完成 Electron 打包或安全集成。

## 结构

```text
src/                    React 场景、展示 DTO、配置 / 绑定 / 增强核心 API
examples/               无真实标识或凭据的合成配置
server/                 可选 Electron main 适配库，不是网页后端
public/assets/          已批准的素材与 SHA-256 清单
scripts/verify-assets.ts 资产字节完整性检查
tests/                  展示规则测试
docs/requirements.md    已确认需求和未定事项
docs/assets.md          素材来源、状态与限制
docs/integration.md     接入契约与宿主边界
docs/electron-integration.md main/preload 安全接线与待验证范围
docs/collect-pagination.md 完整分页、时序及覆盖限制
docs/live-office.md     实际状态驱动场景与模拟验证边界
docs/presence-direct.md  浏览器直连、公开映射及部署前置条件
docs/motion.md          多 Agent 标签的简化动作插槽
docs/lifecycle-demo.md  独立完整动作演示与图集说明
docs/whole-office-demo.md 整体办公室空间、动作与模拟边界
docs/ui-qa.md           ReactDOM 挂载交互覆盖和浏览器验收边界
```

## 重要限制

当前美术是高分辨率像素风参考，并非严格原生 48×48 / 64×64 精灵。待机帧之间仍有轻微轮廓变化；GIF 为浅紫底色预览，透明图集单独保存。不要将其标为最终逐像素生产素材。

预览中的请求是明确标记的模拟数据，时间来自可注入的模拟时钟。缺失请求显示未知，不会编造摘要。这里显示的是“最近一次**用户请求**摘要”，不能用 Agent 回复摘要或泛化的忙碌状态替代。

所有素材未经单独授权不对外再分发。本仓库不附加开源许可证；后续如需公开发行，先确认代码与素材的许可范围。

### 专属闲暇动作

整体演示的摸鱼阶段为 11 秒：主 Agent 起身走到固定放置点、取起镰刀把玩、放回后返回坐下；GitHub Agent 坐着玩掌机，再起身短逛并回座。DeepSeek 在工位抱碗扒饭，Grok 端杯碟喝红茶，ChatGPT 抱盾探头；三位在整体演示与单角色检查页共用已批准的新坐姿循环。其他角色保留各自原动作，所有角色同步进入下一阶段，共用 32.5 秒阶段时间轴。

真实状态办公室仅在数据连接正常、新鲜、明确报告 idle 且连续空闲 5 秒后启用专属动作。这些只是空闲表现，不是采集到的活动记录。工作到来时先收完当前转圈、恢复握姿，再放回镰刀并沿原路返回坐好，再显示工作；unknown、过期或断连立即停止动作，主 Agent 保留当前位置与道具归属，恢复后再安全收尾。暂停和减少动态效果仍有效。额外图集失败不隐藏普通角色；演示中途才加载成功的额外动作等下一次摸鱼阶段或重播，不从半途中跳入。

DeepSeek、Grok、ChatGPT 的真实工位也在明确、新鲜、连接正常且连续 idle 5 秒后播放对应坐姿动作；来任务、等待输入、停止、未知、过期、断连或模型切换立即回到对应状态。可选图集失败不影响原坐姿。该动作仅是空闲表现，不改变 API 状态，也不接入游荡平板素材。见 [三位工位闲暇动作](docs/seated-breaks.md)。
