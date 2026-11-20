# 分支 Agent Note 索引

本页列出本次比较中，个人分支相对本地 `upstream/master` 新增的正式 Agent Note。原记录及其中英文配对文件仍放在仓库的 Agent Note 生命周期目录内，以保留原有引用和校验；本页提供集中入口。历史记录可能描述已经替换或未接入的实现，当前功能以[功能清单](README.zh.md)及其链接的代码为准。

## 与当前差异相关的记录

- [Cordis 嵌套 JSON 参数恢复](../.agents/notes/implemented/bug-fix/2026-08-23-cordis-nested-json-argument-recovery.zh.md)
- [公开包子路径](../.agents/notes/implemented/bug-fix/2026-09-03-public-package-subpaths.zh.md)

## Desktop 历史实现

- [Electron 窗口和 Web profile](../.agents/notes/implemented/architecture/2026-08-14-electron-shell-over-web-profile.zh.md)
- [未签名 macOS DMG 打包](../.agents/notes/implemented/architecture/2026-08-17-unsigned-macos-dmg-packaging.zh.md)
- [Electron 运行时假设](../.agents/notes/implemented/bug-fix/2026-08-21-electron-shell-runtime-assumptions.zh.md)
- [桌面打包与平台原生模块](../.agents/notes/implemented/bug-fix/2026-08-22-desktop-packaging-platform-native-loads.zh.md)

## 不应视为当前独有功能的记录

- [无控制台沙箱桌面](../.agents/notes/implemented/architecture/2026-08-15-console-less-confinement-desktop.zh.md)：隐藏桌面代码当前未接入运行器。
- [Windows ACL token 与输出捕获](../.agents/notes/implemented/feature/2026-08-17-windows-acl-drop-lua-token-for-pipe-capture.zh.md)：当前上游已有相同的 token 处理。
- [Node Loader API 分类](../.agents/notes/implemented/bug-fix/2026-08-29-classify-node-loader-apis-by-methods.zh.md)：当前 vendor 实现与上游无差异。

## 构建与合并过程记录

- [声明的 lib 导入闭包](../.agents/notes/implemented/process/2026-08-21-declared-lib-import-closure.zh.md)
- [合并时保留配置项](../.agents/notes/implemented/process/2026-09-05-merge-resolution-preserves-configuration-entries.zh.md)
