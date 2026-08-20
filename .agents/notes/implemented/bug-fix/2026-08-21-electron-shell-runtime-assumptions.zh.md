# Agent Note: 明确打包 Electron Host 的环境假设

Status: implemented

[English](2026-08-21-electron-shell-runtime-assumptions.md) | 中文

## 问题

打包 Electron 壳与 `dsh web` 启动同一套 Web profile，但安装后的 GUI 进程不会继承终端的工作目录，也没有可见控制台。Electron 还会对回环 renderer 应用权限处理，而 Host 可以通过既有命令行服务请求正常退出。

## 决策

打包启动把当前用户 Home 作为 Host cwd。开发态启动保留启动器 cwd。这样没有绑定 workspace 的会话拥有稳定的用户级默认目录，不会在安装目录或 `System32` 下工作；持久化 workspace cwd 仍由会话自身负责。

主进程只允许请求 frame 属于已加载 Web profile origin 时的 `clipboard-sanitized-write`。其他 renderer 权限继续拒绝。这样保留 sandbox renderer，同时让现有 workspace 和 Web UI 复制控件继续使用浏览器 Clipboard API。

Host stdout 和 stderr 仍连接到开发进程的输出流，同时追加写入 Electron `userData/logs/` 下的两个独立文件。日志文件创建失败时写入进程诊断，但不会阻止 Host 启动。

Host 就绪后以退出码 `0` 且没有 signal 退出时，视为应用主动正常退出，Electron 不显示错误对话框。非零退出和 signal 退出仍视为异常，除非桌面关闭流程已经拥有本次退出。

## 验证

Electron-free runtime 测试覆盖打包态和开发态 cwd 选择、日志路径、同 origin 剪贴板权限选择，以及正常／异常退出矩阵。桌面 TypeScript 项目和 runtime 测试已通过。已安装的 Squirrel 启动仍需要在 Windows 真机验证两种启动路径、实际剪贴板写入、日志创建和应用内退出命令。

## 曾考虑的替代方案

- **所有启动都保留 `process.cwd()`**——否决：Squirrel 启动可能提供 `System32` 或安装目录，从而改变 `.env` 查找位置和未绑定会话的文件操作目录。
- **对回环页面允许全部权限**——否决：renderer 不需要广泛的设备、通知或导航权限，现有 UI 合约只需要剪贴板写入。
- **在 UI 中替换浏览器 Clipboard API**——否决：Web UI 已有经过测试的 Host 剪贴板 helper，Electron 问题属于壳的权限策略。
- **把每次就绪后的退出都当成崩溃**——否决：现有 Web profile 支持正常退出请求，并以退出码 `0` 表示。

## 结果

打包桌面入口拥有确定的用户级启动语义，且无控制台启动时仍会在可访问位置保留 Host 诊断。项目特定 `.env` 不会根据稍后选择的 workspace 被推断加载；需要该环境层时，应从项目目录启动 CLI 或开发态桌面入口。剪贴板写入仅对自有应用 origin 开放，后续新增 renderer 权限必须显式加入壳策略和测试。
