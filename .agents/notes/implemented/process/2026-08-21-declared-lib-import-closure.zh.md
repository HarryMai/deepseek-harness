# Agent Note: The declared files view must be import-closed

Status: implemented

[English](2026-08-21-declared-lib-import-closure.md) | 中文

## Problem

`pnpm deploy` 和 `npm pack` 按清单的 `files` 列表复制包，而本仓库的惯例是逐文件枚举构建入口（`lib/index.js`、`lib/invariant.js`……），而不是写一个 `lib` 目录。Rolldown 会把包的多个入口之间共享的模块拆成按内容哈希命名的兄弟 chunk，例如 `lib/process-inspector-DNK_Zw9B.js`，而清单无法写出一个随内容变化的哈希。当 `@deepseek-ai/dsh-subprocess-local` 增加第二个 rolldown 入口时，它的 chunk 落在了 `files` 列表之外，于是桌面打包器 stage 出来的 `index.js` 引用了一个 tarball 从未携带的文件；故障直到 packaged-Host 冒烟测试中才以 Cordis loader 的 `ERR_MODULE_NOT_FOUND` 形式暴露（见 [macOS 打包 Agent Note](../architecture/2026-08-17-unsigned-macos-dmg-packaging.zh.md)）。

`verify-built-package-invariants` 门禁本就是为这一类问题而建——它刻意只 stage 清单声明的 lib 视图，让未声明的运行时 chunk 暴露——但它只导入 `./invariant` 伴随模块，而该模块与主入口不共享 chunk，所以门禁通过了。

## Decision

每个包的 `files` 列表必须覆盖其入口所引用的运行时 chunk，以前缀 glob 表达（`lib/process-inspector-*.js`），沿用 `dsh-sandbox-windows-acl` 已有的 `lib/types-*.js` 先例；`dsh-subprocess-local` 采用了该 glob。

`verify-built-package-invariants` 现在证明声明的 lib 视图是 import 闭包的：在只 stage 清单声明的 `lib` 文件之后，它静态扫描每个被 stage 的 `.js` 文件中的相对静态与动态 import，目标落在 `lib/` 内却缺失时判定失败。只有 `.js`/`.mjs`/`.cjs` 后缀的指示符计入——client bundle 内嵌着 `import('./workspaces/service.ts')` 之类的类型元数据字符串，它们指向源文件而非运行时文件——跳出 `lib/` 的 import（assets、scripts）不在检查范围内。经 plain Node 的 `./invariant` 探针保持不变。该检查是静态的，既不执行原生依赖，也不加载浏览器 bundle，并随门禁原有入口运行（`pnpm run hygiene`、CI 的 built-package 通道）。

## Alternatives considered

- **用 plain Node 探测每个导出入口**——否决：导入任意入口会执行顶层原生加载（`koffi`、`node-pty`）和浏览器 bundle，把打包检查变成环境敏感的执行矩阵。静态扫描以零执行覆盖同一闭包。
- **在 `files` 里列整个 `lib` 目录**——否决：这会放弃逐入口枚举的惯例，并打包陈旧构建残留，因为 tsdown 在两次构建之间不清理 `lib`（改名的 chunk 的旧版本会被永远发布）。
- **在桌面 staging 层修复**——否决：`stageMissingWorkspaceRuntimePackages` 本就按 `files` 根目录整体复制，桌面故障只是第一个撞上缺口的使用者；同一清单的任何 `npm pack`/`pnpm deploy` 使用者都会丢 chunk。契约属于清单本身。

## Consequences

- 缺 chunk 这一类问题现在在门禁阶段失败，并给出精确的 `file -> specifier` 对，而不是在 packaged-Host 启动时从 Cordis loader 深处抛出；从 `dsh-subprocess-local` 删掉该 glob 会让 `verify-built-package-invariants` 以 `lib/index.js -> ./process-inspector-DNK_Zw9B.js` 失败。
- 任何新增多入口 rolldown 构建的包都必须声明其 chunk glob；门禁会点名缺失的文件，修复是机械操作。
- 门禁需要读取每个被 stage 的 lib 文件源码，相对一个本就要导入 226 个伴随模块的门禁，开销可忽略。
- [包不变量契约 Agent Note](../architecture/2026-07-19-package-invariant-runtime-contracts.zh.md) 继续拥有伴随模块断言内容的决策；本条只拥有门禁现在强制执行的声明文件闭包。
