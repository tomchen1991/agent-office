# Electron 集成：主进程采集，renderer 只接收展示数据

这里提供可复用的 IPC 实现和编译检查的宿主接线示例，不是已经接入某个现有 Electron 应用。本仓库没有安装 Electron，没有启动真实桌面窗口，也没有使用真实采集地址或凭据。测试使用结构化依赖注入模拟 Electron 接口；最终宿主仍须进行真实 Electron 冒烟测试。

## 数据流与文件

1. `examples/electron-main.ts`：宿主 main 提供 `ipcMain`、`BrowserWindow` 工厂、可信 renderer URL/origin 和 main-only `CollectOptions`。
2. `server/electronBridge.ts`：`registerOfficeIpc()` 注册固定 IPC，`attachWindow()` 只授权指定 `WebContents`。每次订阅用宿主的 `createAdapter()` 创建独立 `OfficeAdapter`。
3. `createCollectAdapter()` 在 main 中取 token、请求并归一化采集数据。只有 `sanitizeBridgeState()` 允许的展示字段跨越 IPC。
4. `examples/electron-preload.ts` / `src/bridge.ts`：隔离 preload 只暴露 `window.agentOffice.subscribe(listener)`。返回取消函数。没有通用 send/invoke、URL、token、文件访问、配置写入或任意频道能力。
5. `examples/electron-renderer.tsx` 用稳定的 adapter factory 挂载实际 `LiveOffice`，传入显式 `officeConfig`，由共享空间 UI 处理绑定、状态与动效。需要自定义 UI 时，renderer 调用 `createBridgeAdapter(window.agentOffice)`，得到标准 `OfficeAdapter`，再接到现有 UI / `bindOffice()`。`connect()` 开始订阅；`dispose()` 取消它。最后一个 preload 订阅退出时 main 停止采集。

这些模块通过窄结构接口依赖 Electron；因此本仓库的类型检查无需下载 Electron，实际宿主仍须用自己的 Electron 版本编译并验证接口。

## Main 接线

在 Electron 宿主入口引入实际的 `ipcMain`、`BrowserWindow`，并把它们传给示例工厂：

```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { createCollectorOfficeHost } from './examples/electron-main.js';

// 在 app ready 前注册 app: 为 standard + secure 协议，并实现只服务已打包资源的 handler。
// 不允许任意文件路径、目录遍历或远端代理。协议注册实现由宿主负责。
await app.whenReady();
const host = createCollectorOfficeHost({ipcMain, createWindow: options => new BrowserWindow(options)});
await host.openWindow({
  rendererURL: 'app://agent-office/index.html',
  rendererOrigin: 'app://agent-office',
  preloadPath: absoluteBundledPreloadPath,
  collector: {
    baseURL: trustedMainConfiguration.collectorURL,
    token: () => existingHostSecretStore.readConsumerToken(),
  },
});
app.on('before-quit', () => host.dispose());
```

上面未定义的路径、配置及 secret store 是宿主必须提供的依赖，不是本仓库声称存在的 API。不要把 token 放到 `VITE_*`、HTML、URL、renderer props、本地存储或 preload 暴露对象。使用已有消费者权限；示例不会生成凭据、扩大权限或把凭据保存到仓库。

宿主 URL 必须是规范化的完整 URL，不带 query/hash/userinfo。支持 `https:`、回环地址的开发 `http:`，以及宿主已注册为 standard + secure 的 `app:`。不接受 `file:`、opaque origin、`about:`、`blob:` 等。`allowedDocument.origin` 与实际 `senderFrame.origin` 独立比较，不能仅用 URL 前缀、hostname 或字符串 contains 判断可信来源。

`registerOfficeIpc()` 每个 `ipcMain` 只调用一次，之后可 attach 多个宿主窗口。不要创建第二份相同频道的注册器。每个窗口的适配器和订阅完全隔离；返回的 detach 和 bridge.dispose 都可重复调用。不要将同一个可变采集 adapter 实例跨窗口共享，`createAdapter()` 应创建新实例。

## Preload 接线

宿主 preload 入口：

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { installAgentOfficePreload } from './examples/electron-preload.js';
installAgentOfficePreload({contextBridge, ipcRenderer});
```

用宿主构建系统把 preload 及本仓库引用的模块打成 sandbox-compatible 文件，通常是单个 CommonJS 文件，并将 `electron` 留为 external。不要直接把源码 TypeScript 文件或依赖任意本地 require 的未打包模块作为 sandbox preload。只有 preload 能访问 `ipcRenderer`；回调只收到经过复制的 `AdapterState`，不会拿到 Electron 事件或 sender。

## Renderer 与显式配置

首选直接使用 `examples/electron-renderer.tsx` 的 `mountAgentOffice(element, publicConfiguration, api)`。它验证展示配置、创建稳定的 `createBridgeAdapter()` 工厂并挂载 `LiveOffice`，返回卸载函数。宿主无需自己拼装 `bound.snapshot` 或布局，也不会跑演示时间线。下面的低层代码仅适合需要自己构建 UI 的宿主。

renderer 只 import renderer-safe 模块，不 import `server/collect.ts` 或 `server/electronBridge.ts`。宿主可以把**只有展示和绑定信息**的 `OfficeConfig` 作为受控打包资源注入 renderer，或使用已有配置编辑器。该配置不得包含采集 URL、凭据、命令或原始响应。桥不接受 renderer 把配置反向传给 main。

```ts
import { createBridgeAdapter } from './src/bridge.ts';
import { parseOfficeConfig } from './src/config.ts';
import { bindOffice } from './src/binding.ts';
import type { OfficeConfig } from './src/config.ts';
import type { OfficeTopology } from './src/core.ts';

const config: OfficeConfig = parseOfficeConfig(publicPackagedOfficeConfig);
if (!window.agentOffice) throw new Error('Agent Office preload is unavailable');
const adapter = createBridgeAdapter(window.agentOffice);
const stop = adapter.subscribe(state => {
  if (!state.snapshot) return;
  const bound = bindOffice(config, state.snapshot);
  const topology: OfficeTopology = bound.topology;
  // 把 bound.snapshot、topology、state.phase 和绑定警告交给宿主 UI。
});
adapter.connect();
// 卸载时 stop(); adapter.dispose(); 之后仍可重新 subscribe + connect。
```

`sourceId + instanceId + collectorEpoch` 来自实际快照；席位、角色、团队关系由显式配置决定。不根据模型名称或进程角色推断。`follow-unique` 仅在完整身份覆盖时绑定；不完整或歧义身份保持空位。用户请求摘要只能来自宿主明确提供的 enrichment，采集服务没有提供时就保持 null。

## 安全边界与生命周期

- 每条控制消息都检查 exact `event.sender === attachedWebContents`，`event.senderFrame === webContents.mainFrame`，已提交的 frame 身份，精确 URL 与实际 origin。子 frame、其他窗口、同域其他页面及 lookalike 域名均拒绝。
- 订阅消息只有 action 和正整数 subscriptionId。未知字段、未知操作、额外参数、无效 ID 拒绝。最大 ID 是 2,147,483,647；单窗口每秒最多 20 次新订阅。取消不受这个频率上限阻碍。
- preload 最多 64 个本地 listener，共享一个主进程订阅。异步控制消息最多一个在途，连续 mount/unmount 合并；旧取消或旧事件不会影响新订阅。React Strict Mode 的 setup → cleanup → setup 可重复使用同一 adapter。
- main-frame 导航一开始就停止采集、撤销订阅并丢弃后续旧回调。只在受信任文档提交后允许新订阅。main-frame 加载失败/取消后，仅当没有正在进行的新加载且原文档的 exact URL/origin 仍匹配时允许重新订阅，不恢复旧缓存。hash/路由变化不在精确 URL 白名单内；需要宿主明确处理重新挂载与连接。
- renderer crash 停止采集；窗口销毁卸载窗口事件和 adapter。主进程 dispose 移除自己注册的 IPC handler。
- main 与 preload 都运行 DTO 校验并重新构造字段，丢弃 token、raw payload、额外元数据和错误详情。不调用数据对象的 getter，不接受原型对象或稀疏 agents 数组。无效数据统一变成 disconnected/null snapshot 与固定错误 `Office data is unavailable.`。
- DTO 上限：1,312 agents（匹配 41 页 × 32），ID 2,048 字符，普通字符串 512 字符，用户请求摘要 10,000 字符，coverage 2,048 字符，时间字符串 64 字符，freshness TTL 最多 86,400,000 毫秒。重复 ID、非法枚举/时间、超限内容整体拒绝，不偷偷截断。
- 缓存重放不是新观察。preload 与 renderer adapter 使用单调时钟扣除缓存停留时间，过期数据降为 stale/unknown；新 listener 不会使旧 working 状态重新变为 fresh。
- 允许的展示文字本来就会交给 renderer。DTO allowlist 无法识别宿主故意把 secret 写进 name/summary 的情况；宿主也必须只提供可展示内容。

## 宿主窗口与内容安全

示例显式设置 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`、禁用 subframe/worker Node integration 和 webview，使用隔离非持久 session，拒绝新窗口、renderer 导航、重定向和权限请求。不要为方便开发关闭这些选项。

生产页面应由可信 HTTPS 或受限的 secure custom protocol 服务，并设置 CSP，例如：

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'
```

这是起点而非已经测试过的宿主策略：打包后的页面需验证实际资源和样式需求。若 UI 需要 inline style，优先使用受控样式表/合适的 hash 或 nonce；不要直接放宽 script-src。开发 Vite/HMR 需要单独限制到开发回环地址的策略，不能带入生产配置。Electron 更新、protocol handler、CSP 响应头、权限处理和实际页面资源都由宿主负责。

## 已验证与仍需验证

本仓库 Node 测试覆盖：外部/子 frame 拒绝、URL/origin 冒充、无效操作与 DTO、secret extra-field 去除、跨窗口隔离、导航/取消/失败/crash/destroy、旧回调与取消竞态、Strict Mode 重连、超限/完整分页、单调 freshness 缓存重放。`npm run typecheck` 包含 main、preload 与实际 LiveOffice renderer 接线示例。

尚未执行真实 Electron runtime 冒烟测试、宿主打包、实际 CSP、实际 protocol origin、登录/权限或真实采集服务联调。宿主接入时应验证：窗口首次连接与重载、连续挂载卸载、断网与重连、导航阻止/取消、窗口关闭后没有轮询，以及开发工具中 renderer 无法读取 token 或调用任意 IPC。

官方资料（实现时核对）：
- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [contextBridge and its supported values](https://www.electronjs.org/docs/latest/api/context-bridge)
- [ipcRenderer event wrapping](https://www.electronjs.org/docs/latest/api/ipc-renderer)
- [webContents navigation events](https://www.electronjs.org/docs/latest/api/web-contents#navigation-events)
- [WebFrameMain](https://www.electronjs.org/docs/latest/api/web-frame-main)
- [Sandboxed preload scripts](https://www.electronjs.org/docs/latest/tutorial/sandbox#preload-scripts)
