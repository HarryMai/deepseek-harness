# MCP 设置测试路由故障记录

## 范围

本记录说明桌面端“测试链接”显示“无法连接此 MCP 服务，请检查命令或服务地址。”时，与 Connection RPC 路由生命周期有关的一次重复故障及处理方式。

## 现象和诊断信号

设置页会向 `POST /mcp-settings/test` 发起请求，以检查 MCP 服务的连接情况。

- 未认证请求返回 `405 Method Not Allowed` 时，`/mcp-settings/test` 尚未挂载，请求落入前端的默认处理；先修复 Host 的路由挂载，再检查 MCP 命令、参数和工作目录。
- 未认证请求返回 `401 unauthorized` 时，路由已挂载并已进入 Connection 的认证处理；此时才继续检查 CodeGraph 或其他 MCP 子进程。

本次调查确认 CodeGraph MCP 子进程仍在运行，问题位于测试路由的挂载流程。

## 根因

`mcp-client` 的设置探针只在注入了 `connection` 的 Context 中注册专用 RPC 通道。

旧版 `HostConnectionService.rpc` 将该调用方 Context 作为路由 owner，并直接通过 `owner.webServer.register(route)` 挂载路由。

这个调用方 Context 没有注入 `webServer`，因此专用路由无法注册；设置页的请求最终没有对应的 Host 路由，表现为通用的连接失败提示。

此前已经实现过的路由生命周期修复没有进入当前分支，导致问题回归。

## 修复方案

`HostConnectionService` 保存尚未挂载的专用 RPC 路由，并跟踪当前绑定的 `WebServer`。

Connection 插件在自身已有的 `ctx.inject(['webServer'])` 生命周期中调用 `connection.bindWebServer(webCtx.webServer)`。

`bindWebServer()` 在 WebServer 出现时挂载所有待处理路由；WebServer 被替换或销毁时卸载它们。

每个 RPC 调用方的 disposer 会卸载并移除自己的路由，避免已经销毁的插件继续暴露端点。

## 回归覆盖

Connection Host 测试覆盖以下生命周期：

1. WebServer 尚未出现时，专用 RPC 路由保持待挂载状态。
2. WebServer 出现后，`/api` 与专用 RPC 路由都会挂载。
3. WebServer 销毁后，路由会清理。
4. 替换 WebServer 后，路由会重新挂载。
5. RPC 调用方销毁后，只保留 Connection 自己的 `/api` 路由。

## 本次验证

已执行 `pnpm exec vitest run packages/client/connection/tests/node-half.host.spec.ts`。

该测试文件的 20 项测试全部通过，其中包含本次新增的 WebServer 延迟出现、销毁、替换和调用方清理检查。

实际 Desktop 运行时还需确认构建产物已经更新：根目录的 `pnpm desktop` 会执行 `start:compatibility`，即 `tsx scripts/dev.ts --skip-build --compatibility`，不会编译 TypeScript 源码。

本次浏览器控制台的 `405` 对应旧的 Connection 构建产物；重新执行 `pnpm run build` 并重启 Desktop 后，未认证的 `POST /mcp-settings/test` 返回 `401`，表明专用路由已挂载并进入 Connection 认证处理。

## 后续排查顺序

1. 修改 Host 或 Connection 源码后，先执行 `pnpm run build`，再启动或重启 `pnpm desktop`；单独执行 `pnpm desktop` 不会更新构建产物。
2. 检查测试请求的状态：`405` 表示 Host 路由未挂载，`401` 表示路由已到达 Connection 认证层。
3. 只有路由已挂载后，才检查 MCP 命令、参数、环境变量、工作目录和 CodeGraph 子进程日志。
4. 专用 RPC 路由必须通过 Connection 已注入 `webServer` 的生命周期挂载，不能假设 RPC 调用方 Context 自己能解析 `webServer`。

## 相关位置

- `packages/client/connection/src/rpc-host.ts`
- `packages/client/connection/src/index.ts`
- `packages/client/connection/tests/node-half.host.spec.ts`
- `packages/mcp/mcp-client/src/probe.ts`

## 记忆来源

本记录根据项目历史中的 Desktop MCP settings route lifecycle 记忆和对应的临时修复笔记整理；历史记录没有保留当时 CodeGraph stderr 或工具数量，因此这些内容应以本机现场日志为准。
