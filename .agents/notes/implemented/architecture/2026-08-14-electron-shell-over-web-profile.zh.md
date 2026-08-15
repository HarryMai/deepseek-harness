# Agent Note: Electron 通过回环 Host 子进程封装现有 Web profile

Status: implemented

[English](2026-08-14-electron-shell-over-web-profile.md) | 中文

## 问题

随附的交互应用通过 `dsh web` 启动，并要求用户在浏览器中打开命令打印的 `http://127.0.0.1:3080` URL。桌面入口应直接打开界面，同时不分叉产品 UI、插件组合、API route 或会话行为。

把 Harness Host 放进 Electron 主进程看似可以减少一个进程，但 Electron 提供不同的 Node ABI，并使 `process.execPath` 指向 Electron。原生提供方与子进程适配器依赖普通 Node 行为，因此该布局会让呈现壳进入核心执行语义。

## 决策

`apps/desktop` 是公开的 Electron 应用包。它的 Node bin 解析锁定版本的 Electron 可执行文件，启动应用，并传入调用该 bin 的准确 Node 可执行文件。Electron 主进程只负责单实例处理、窗口生命周期、外部链接策略和子进程监管通道。

主进程使用该普通 Node 可执行文件启动 `host.js`。Host 子进程调用公开的 `@deepseek-ai/dsh/desktop-host` 适配器；该适配器使用现有 `dsh web` 解析器处理启动器 `--patch` 选项，并通过同一套 `runProfile` 路径、分层环境、用户 profile、Web 参数和关闭控制器启动随附的 `web` profile。`packages/core` 下没有任何包发生变化，桌面应用也不复制或替换产品组合。

分离启动器选项后，桌面入口在 Web 参数前添加默认值 `--host 127.0.0.1 --port 0`。用户 Web 参数保留既有的末值优先级；默认值让 OS 选择未占用的回环端口，并防止壳连接到已经占用 3080 的无关进程。profile 激活后，Host 子进程读取实际的 `WebServer.port`，通过进程 IPC 发送 ready 消息。主进程只会加载明确包含端口的回环 HTTP URL。

BrowserWindow 从该 URL 加载现有静态前端、`/api` HTTP route 和 WebSocket 下行。IPC 只承载 `ready`、启动错误和关闭消息，不构成第二套产品传输。renderer 启用 context isolation 与 Chromium sandbox，禁用 Node integration 和 WebView，拒绝权限请求，把导航限制在应用 origin，并把外部 HTTP 或 HTTPS 链接交给系统浏览器。

应用退出时向 Host 子进程发送一次关闭请求。在 POSIX 上，主进程会在发送该请求前保留 Host 及其后代的精确身份，并且不会跟随复用的 pid；Windows 使用 `taskkill /T /F`。现有 profile 关闭控制器会释放 Cordis 树与 WebServer；六秒后主进程会强制终止已保留的进程树，并等待进程句柄关闭。`exit` 事件不能代替 `close`。强制终止未完成时，桌面壳保持打开并报告错误。启动等待以 60 秒为界，进程创建错误与 Host 提前退出都会被报告，第二次启动桌面应用会聚焦现有窗口。

workspace 本地的 Windows x64 构建读取 `apps/desktop/desktop-build.config.json`，使用 `@electron/packager` 打包已 bundle 的 Electron main，再用 `electron-winstaller` 创建无签名的当前用户 Squirrel 安装程序。应用源目录不包含 Harness 运行时依赖。构建器从 workspace 部署现有 `@deepseek-ai/dsh` 包到外部 Host 运行时目录，并把构建机上与配置完全匹配的普通 Node 可执行文件复制到旁边。打包后的 main 通过 `process.resourcesPath` 解析二者；开发启动器继续传递自身 Node 可执行文件。因此，安装程序在不从 npm 解析桌面应用的前提下维持同一套 Host 进程和 Node ABI 分离。

## 验证

纯运行时测试固定启动器参数分离、patch 解析、临时回环默认值、开发态与打包态 Node 可执行文件选择、Host 消息校验、启动失败、关闭升级、同 origin 导航和外部协议过滤。配置测试会拒绝未知字段、未支持的签名与更新模式、不安全的可执行文件名和非 ICO Windows 图标。桌面 TypeScript 项目、workspace 约束、包构建、构建后 Host snapshot 和打包入口探测覆盖面向发布的应用边界。现有 Web 测试继续作为 UI、HTTP、WebSocket 与 profile 行为的权威验证，因为这些路径没有变化。

## 曾考虑的替代方案

- **在 Electron main 内运行 Host**——否决：Electron 的 Node ABI 与 `process.execPath` 会改变现有运行时所拥有的原生模块与子进程行为。
- **加载 `file://` 并用 Electron IPC 替换 HTTP／WebSocket**——本应用否决：它会创建第二套载体，并在不改变所请求交互方式的情况下要求修改产品传输。如果后续需求能够证明必要性，协议分层仍允许该载体。
- **自动打开系统浏览器**——否决：它消除了 URL 复制，但没有提供所要求的 Electron 应用生命周期。
- **始终绑定 3080 并加载该地址**——否决：端口冲突可能导致启动失败，或让桌面壳连接到无关的本地服务。由自有子进程发出的 ready 状态和临时端口可以确立所有权。
- **使用 Electron Forge 编排构建**——否决：其稳定版依赖图包含仓库依赖策略禁止的 Git 来源间接包。直接使用 Electron Packager 和 Squirrel installer，可以保留底层维护工具并删除该依赖。

## 结果

- 浏览器与桌面入口使用同一套前端产物、插件图、HTTP API、WebSocket stream、配置、持久化和关闭实现。
- Electron 保持在核心逻辑之外，不能悄然用自己的 Node 运行时替换需要普通 Node 的提供方运行时。
- 桌面 renderer 仍使用回环网络 socket。IPC 传输仍是可选的未来优化，不是提供桌面窗口的前置条件。
- workspace 可以在不改变产品传输或 Host 组合的情况下生成无签名 Windows x64 安装程序。代码签名、自动更新、其他架构和其他 OS 包仍属于独立发布工作。
