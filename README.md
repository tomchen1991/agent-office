# Agent Office

将 Agent 的工作状态变成可视化办公室。面向现有 Electron 项目的可嵌入消费端，使用 **React + TypeScript**；Node.js 消费适配层也使用 TypeScript。

## 当前阶段

这是**可配置办公室原型与接入层里程碑**，并非完整产品：

- 已确认的自研 Agent 站姿、华丽镰刀 V2、待机 GIF 和透明四帧图集已保存。
- DOM / CSS 办公室：自研 Agent 独立办公室、普通团队主从工位与平等协作桌可切换。
- 支持播放 / 暂停待机预览、点击角色查看用户请求、状态来源与新鲜度、下载素材。
- 解耦展示 DTO 与订阅接口；默认 mock，Node-only collect 状态轮询适配器单独提供。
- 示例子 Agent 最多显示三个座位，超出以 `+N` 展示。
- 未执行真实采集联调、无模型调用、无运行中的后台服务，没有安装 Electron 或 PixiJS。
- DeepSeek / ChatGPT / Grok 的统一像素角色、走路 / 入座 / 工作动画尚未制作。

## 本地运行

需要 Node.js 24+ 与 npm（测试脚本使用 Node 原生 TypeScript 支持）。

```sh
npm ci
npm run dev
```

Vite 仅监听本机回环地址。打开终端显示的本地地址即可。

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
src/                    React 场景、展示 DTO、模拟适配器
server/                 Node-only 消费状态适配器
public/assets/          已批准的素材与 SHA-256 清单
scripts/verify-assets.ts 资产字节完整性检查
tests/                  展示规则测试
docs/requirements.md    已确认需求和未定事项
docs/assets.md          素材来源、状态与限制
docs/integration.md     接入契约与宿主边界
```

## 重要限制

当前美术是高分辨率像素风参考，并非严格原生 48×48 / 64×64 精灵。待机帧之间仍有轻微轮廓变化；GIF 为浅紫底色预览，透明图集单独保存。不要将其标为最终逐像素生产素材。

预览中的请求是明确标记的模拟数据，时间来自可注入的模拟时钟。缺失请求显示未知，不会编造摘要。这里显示的是“最近一次**用户请求**摘要”，不能用 Agent 回复摘要或泛化的忙碌状态替代。

所有素材未经单独授权不对外再分发。本仓库不附加开源许可证；后续如需公开发行，先确认代码与素材的许可范围。
