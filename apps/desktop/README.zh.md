# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

随附 DeepSeek Harness Web profile 的 Electron 桌面应用。Electron 主进程只负责窗口与进程生命周期；独立的普通 Node 子进程原样启动现有 profile、HTTP route、WebSocket route 和前端。

## 运行

该应用从仓库 workspace 启动；构建过程不会从 registry 安装 `@deepseek-ai/dsh-desktop`。workspace 依赖和仓库产物就绪后，运行 `pnpm desktop`。启动器参数保持 `dsh web` 的顺序要求：可重复的 `--patch <path>` 必须放在首个 Web 选项之前，例如 `pnpm desktop --patch ./extra.yml --port 3080`。桌面默认参数为 `--host 127.0.0.1 --port 0`；OS 会选择空闲的回环端口，Electron 随后自动打开该地址。

## 构建无签名 Windows 安装程序

[`desktop-build.config.json`](desktop-build.config.json) 是 Windows 应用元数据和安装行为的唯一可编辑输入。它管理显示名和可执行文件名、发布者、描述、版权、Windows x64 目标、Squirrel 包名和输出名、快捷方式、可选 `.ico` 路径，以及从构建机复制的普通 Node 版本。图标字段为 `null` 时保留 Electron 默认图标；配置的图标路径相对于当前目录。

构建机必须是 Windows x64，并使用 Node 24.9.0 和仓库声明的 pnpm 11.7.0。先在仓库根目录执行一次 `pnpm install` 安装 workspace 依赖；该命令会把 `apps/desktop` 作为本地 `@deepseek-ai/dsh-desktop` 链接，不会从 registry 请求这个包。打包过程从 `electron_config_cache`、`ELECTRON_CACHE` 或 Electron 标准本地缓存读取固定版本的 Electron ZIP；归档不存在时直接失败，不会在构建期间下载。然后构建安装程序：

```sh
pnpm desktop:make:win:x64
```

该命令先构建仓库产物，再从本地 workspace 部署现有 `@deepseek-ai/dsh` Host 闭包；打包后的应用写入 `apps/desktop/out/package/`，Squirrel 产物写入 `apps/desktop/out/make/squirrel.windows/x64/`。分发配置指定的 `Setup.exe`；`.nupkg` 和 `RELEASES` 是更新元数据。安装程序按当前用户安装，不要求管理员权限，随包携带普通 Node，安装后可离线运行，不启用自动更新，卸载时也不删除 Harness 用户数据。

配置有意只接受当前的无签名 Windows x64 路径。启用签名、自动更新、全机安装或其他架构等未支持修改会在打包前失败，不会被静默忽略。无签名安装程序可能在部分 Windows 系统上显示未知发布者或 SmartScreen 警告。

## 构建无签名 macOS 磁盘映像

同一个 [`desktop-build.config.json`](desktop-build.config.json) 在 `mac` 一节中管理 macOS 包元数据：目标架构（`x64` 与 `arm64`）、反向 DNS bundle 标识符、必须包含 `{arch}` 占位符的 DMG 输出文件名，以及可选的 `.icns` 图标路径。`installer.signing` 固定为 `none`；该字段为后续签名构建预留配置位置，但不启用签名。图标字段为 `null` 时保留 Electron 默认图标；配置的图标路径相对于当前目录。

构建机必须是 macOS，并使用仓库声明的 pnpm 11.7.0；任一架构的构建机都能产出两种架构的包。先在仓库根目录执行一次 `pnpm install` 安装 workspace 依赖。与 Windows 构建复制构建机自身 Node 可执行文件不同，macOS 构建会从 nodejs.org 下载配置版本的官方 darwin tarball（每个目标架构一份），并在使用前对照官方发布的 SHA-256 校验。打包过程从 `electron_config_cache`、`ELECTRON_CACHE` 或 Electron 标准本地缓存读取固定版本的 Electron ZIP；`pnpm install` 只会填充构建机本架构的缓存，因此另一架构的 ZIP 从 GitHub release 下载，同样经 SHA-256 校验。然后构建磁盘映像：

```sh
pnpm desktop:make:mac
```

该命令先构建仓库产物，从本地 workspace 一次性部署现有 `@deepseek-ai/dsh` Host 闭包，并按架构放置下载的 Node 运行时；`.app` bundle 写入 `apps/desktop/out/package/`，每个架构一份 DMG 写入 `apps/desktop/out/make/dmg/<arch>/`——按当前提交的配置即 `DeepSeek Harness-x64.dmg` 与 `DeepSeek Harness-arm64.dmg`。每份 DMG 包含应用本体和一个用于拖拽安装的 `Applications` 符号链接；应用随包携带普通 Node，安装后可离线运行。打包后 Host 冒烟测试只覆盖构建机本架构，因为另一架构的 Node 无法在本机执行。`pnpm desktop:make:mac --dry-run` 只打印解析后的目标和输出名，不执行构建；`--skip-build` 复用已有仓库产物。

配置有意只接受当前的无签名 DMG 路径。签名身份、其他安装格式或缺少 `{arch}` 的输出文件名等未支持修改会在打包前失败，不会被静默忽略。Gatekeeper 会拦截从互联网下载的无签名应用，提示「无法打开，因为无法验证开发者」或「已损坏」；接收者可右键点按后选择**打开**，在 macOS 15 或更高版本通过 **系统设置 → 隐私与安全性 → 仍要打开**，或用 `xattr -cr` 清除隔离属性后打开。在本机构建并运行的应用不带隔离属性，打开时不会有警告。

## 进程所有权

Node 启动器启动 Electron，并把自身的 Node 可执行文件路径交给 Electron 主进程。Electron 使用该普通 Node 可执行文件启动 [`host.ts`](src/host.ts)，Host 子进程再启动公开的 `@deepseek-ai/dsh/desktop-host` 适配器。把 Harness 运行时保留在 Electron 外部，可以维持原生与子进程提供方对 Node ABI 和 `process.execPath` 的既有假设。

关闭窗口时会通过进程 IPC 请求有界的 Harness 关闭流程。在 POSIX 上，Electron 会在发送该请求前保留 Host 及其后代进程的精确身份；Windows 则把进程树所有权交给 `taskkill /T /F`。如果优雅关闭在六秒内未完成，Electron 会强制终止已保留的进程树，并等待进程句柄关闭后再退出。终止失败时 Electron 保持打开并报告错误。启动就绪状态也通过 IPC 传递，Electron 只接受使用回环宿主且显式包含端口的 HTTP URL。

打包启动会把 Host 的 cwd 固定为当前用户 Home，因此没有绑定 workspace 的会话不会继承 `System32` 或安装目录。会话提供持久化 workspace cwd 时，该值仍然优先。打包 Host 还会把 stdout 追加到 `userData/logs/host.stdout.log`，把 stderr 追加到 `userData/logs/host.stderr.log`；默认 Harness home 的 `.env` 仍是受支持的用户级环境层，项目目录中的 `.env` 需要从该项目目录进行 CLI 或开发态启动。

Host 在启动完成后以退出码 `0` 且没有 signal 退出时，桌面应用会将其视为正常退出。其他未被关闭流程接管的退出仍会显示现有错误对话框并结束 Electron 壳。

## Renderer 安全

renderer 启用 context isolation 和 Chromium sandbox，不启用 Node integration 或 WebView。只允许加载的应用 origin 使用 `clipboard-sanitized-write`；其他权限请求仍会被拒绝。导航限于应用 origin；指向该 origin 外部的 HTTP 或 HTTPS 链接在系统浏览器中打开。IPC 只承载生命周期消息；产品 API 调用继续使用现有 HTTP 与 WebSocket 实现。

## 已知限制

- Windows 安装程序未签名，用户可能需要在 SmartScreen 中选择**更多信息**和**仍要运行**。
- macOS 磁盘映像未签名；Gatekeeper 会拦截下载来的副本，接收者需要显式打开或清除其隔离属性。
- 为非本架构产出的 macOS 包（在 x64 构建机上产出 arm64，或相反）只完成组装而从未在构建中执行：其打包后 Host 冒烟测试被跳过，且部署的 Host 闭包来自构建机的 workspace。分发前请在匹配硬件上验证该包。
- 原生安装程序只在 workspace 内构建，不会从 npm 获取 `@deepseek-ai/dsh-desktop`。
- 打包 Host 的输出位于 Electron 当前用户 `userData/logs/` 目录下；Harness home 之外的项目 `.env` 不会成为打包启动输入。
- 桌面壳只接受回环应用 URL，因此会拒绝自定义的非回环 `--host`；如需有意向网络开放，请使用 `dsh web`。
