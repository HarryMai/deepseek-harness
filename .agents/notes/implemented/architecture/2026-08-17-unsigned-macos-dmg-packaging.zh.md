# Agent Note: macOS 桌面打包构建无签名的分架构 DMG

Status: implemented

[English](2026-08-17-unsigned-macos-dmg-packaging.md) | 中文

## 问题

桌面壳只随附了无签名的 Windows x64 Squirrel 安装程序（见 [Electron 壳 Agent Note](2026-08-14-electron-shell-over-web-profile.zh.md)），没有 macOS 包，macOS 接收者只能运行 workspace 启动器。macOS 包必须保持该 Note 的分离结构——Electron main 负责窗口，普通 Node 子进程运行 Host——同时让一台构建机覆盖 Apple silicon 与 Intel 机器，并且必须在项目持有 Apple 签名身份之前交付。

## 决策

`apps/desktop/scripts/build-mac.ts`（workspace 脚本 `make:mac`，仓库脚本 `pnpm desktop:make:mac`）对照同一份 `desktop-build.config.json` 镜像 Windows 打包器，配置新增 `mac` 一节：`architectures`（`x64`／`arm64` 的非空、无重复子集）、反向 DNS `bundleIdentifier`、`installer`（`format: 'dmg'`、必须包含 `{arch}` 且以 `.dmg` 结尾的 `outputFileName`、`signing: 'none'`），以及接受 `.icns` 路径或 `null` 的 `icons.application`。对每个配置的架构，构建用 `@electron/packager` 打包已 bundle 的 Electron main，断言打包后的运行时条目（`Contents/Resources/n/node` 与 `Contents/Resources/h/desktop-host-child.js`）存在，经由 `src/stage-application.ts`（`copyApplicationBundle`，`verbatimSymlinks: true`）暂存一份 bundle 副本，再通过 `hdiutil` 把 `.app` 包成 UDZO 磁盘映像：卷名为显示名，附带用于拖拽安装的 `Applications` 符号链接。暂存复制保持框架符号链接目标为相对路径：`fs.cp` 的默认行为会将其解析为构建机绝对路径，携带这种链接的暂存 bundle 会产出 `Electron Framework.framework` 条目指回构建机 workspace 的 `.app`，安装后的应用会在 Electron/ICU 初始化阶段失败，而不是在 bundle 内部解析自己的框架。产物写入 `apps/desktop/out/make/dmg/<arch>/DeepSeek Harness-<arch>.dmg`，组装暂存在 `apps/desktop/out/package/` 下；`packagedNodeExecutable` 新增 darwin 分支解析 `n/node`，与 Windows 的 `n/node.exe` 布局并列。`--dry-run` 只打印解析后的方案，不写入构建或输出目录；`--skip-build` 复用已有仓库产物——两者与 Windows 打包器共享。

分架构的 Node 运行时是下载的，不是复制的。Windows 构建复制构建机自身的 Node 可执行文件，因此断言构建机 Node 与配置版本一致；macOS 构建机必须在一台主机上产出两种架构，所以构建从 nodejs.org 下载配置版本的官方 `node-v<version>-darwin-<arch>.tar.gz`，并在解包前对照官方发布的 `SHASUMS256.txt` 校验，归档缓存在 `apps/desktop/.desktop-cache/` 下并在复用时重新校验。固定版本的 Electron darwin ZIP 优先来自本地 Electron 缓存（`electron_config_cache`、`ELECTRON_CACHE` 或 `~/Library/Caches/electron`），不存在时从 GitHub release 下载，同样经 SHA-256 校验。Windows 构建在缓存缺少 ZIP 时直接失败，因为 `pnpm install` 总会填充唯一的 Windows 目标；macOS 构建机的本地缓存只持有本架构，无法要求另一架构的 ZIP 本地必有。

Host 闭包每次构建只暂存一次，走与 Windows 相同的 pnpm deploy 加 workspace 暂存流程，由两个架构的包共用。打包后 Host 冒烟测试只覆盖构建机本架构：另一架构下载来的 Node 无法在本机执行，因此该包只完成暂存、条目检查和映像封装，不做启动探测。

签名只在配置中预留，未实现：`installer.signing` 校验字面量 `'none'`，使后续签名身份以新增枚举值的方式加入，而不是改变配置结构，与 Windows 的 `unsigned: true` 立场一致。无签名的代价落在下载副本的接收者身上：Gatekeeper 会拦截首次启动（提示「无法打开，因为无法验证开发者」或「已损坏」），直到应用通过右键点按 → 打开、macOS 15+ 的系统设置 → 隐私与安全性 → 仍要打开，或 `xattr -cr` 打开。在本机构建并运行的应用不带隔离属性，打开时不会有警告。

## 验证

`apps/desktop/tests/build-config.spec.ts` 接受当前提交的无签名 macOS 设置，并拒绝未知或缺失的 `mac` 字段、重复或不支持的架构、非反向 DNS 的 bundle 标识符、带签名或非 DMG 的安装格式、缺少 `{arch}` 的输出文件名，以及非 `.icns` 图标。`apps/desktop/tests/runtime.spec.ts` 固定 darwin 打包 Node 分支（非 darwin 平台跳过）及其对不支持平台的拒绝。`apps/desktop/tests/stage-application.spec.ts` 证明暂存复制在暂存后的 bundle 内保持框架符号链接目标相对且可解析。`--dry-run` 端到端走通配置加载与目标解析路径。在 darwin-x64 构建机上完整执行 `pnpm run desktop:make:mac` 已在 `apps/desktop/out/make/dmg/` 下产出 `DeepSeek Harness-x64.dmg` 与 `DeepSeek Harness-arm64.dmg`：x64 的打包后 Host 冒烟测试通过，arm64 冒烟测试按设计跳过。

## 曾考虑的替代方案

- **像 Windows 构建一样复制构建机的 Node**——否决：一台 macOS 构建机要产出两种架构，构建机自身的可执行文件永远只匹配其中一种。
- **交付单个 universal（fat）包**——否决：它把每次下载的 Electron 与 Node 载荷翻倍，且仍然需要两份分架构的 Electron ZIP；分架构 DMG 让每个产物保持单架构。
- **像 Windows 构建一样拒绝下载 Electron**——否决：`pnpm install` 只填充构建机本架构的本地缓存，跨架构 ZIP 永远无法本地解析。
- **等到持有签名身份再交付 macOS 包**——否决：接收者现在就能拿到可用的包，首次运行的变通方法已有文档记录，且预留的 `signing` 字段让后续签名路径成为纯增量。

## 结果

- macOS x64 与 arm64 接收者无需项目持有 Apple Developer 身份即可从 DMG 安装；代价是 `apps/desktop/README.md` 中记录的 Gatekeeper 首次运行变通方法。
- 暂存后的 bundle 保持框架符号链接相对，安装副本在应用内部解析 Electron Framework，不再依赖构建机的 workspace 路径。
- 为非本架构产出的包在构建中从未执行：其 Node 可执行文件经校验下载而正确，但共用的 Host 闭包来自构建机的 workspace，因此任何只携带单架构二进制的原生模块都会匹配构建机而非该包（`node-pty` 当前同时携带两种 darwin prebuild）。分发跨架构包前请在匹配硬件上验证。
- macOS 构建每次运行都会访问网络（Node 校验和清单），并在 Electron 缓存未命中时访问 GitHub release；离线构建必须预置 `apps/desktop/.desktop-cache/` 和 Electron 缓存。
- [Electron 壳 Agent Note](2026-08-14-electron-shell-over-web-profile.zh.md) 仍是窗口／Host 分离与 Windows 打包决策的所有者；本 Note 只拥有 macOS 打包路径。
