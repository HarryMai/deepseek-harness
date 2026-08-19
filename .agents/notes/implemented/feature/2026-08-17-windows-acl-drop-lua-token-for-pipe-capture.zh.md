# Agent Note:windows-acl 运行器移除 LUA_TOKEN,使受限进程能够创建管道

Status: implemented

[English](2026-08-17-windows-acl-drop-lua-token-for-pipe-capture.md) | 中文

## 问题

2026-08-17 在打包的桌面外壳(Windows 11 22H2,构建 22621)上的现场故障:在 `workspace-write` 模式下,每条捕获原生命令输出的 PowerShell 命令都在程序启动时失败并报 `Program 'X.exe' failed to run: Access is denied`——包括管道(`git ... | Select-Object`)、变量捕获(`$x = & git`)、`2>$null` 重定向以及 .NET `ProcessStartInfo` 重定向。不带捕获的普通调用在几秒前还能成功。该故障在现场机器上用构建后的运行器以 100% 的概率复现,workspace-write 与 read-only 两种模式、有控制台与无控制台两种形态都一样。

现场取证:受限进程内的 `CreatePipe` 本身即失败并返回 `ERROR_ACCESS_DENIED`(5);带显式 `Everyone: FullControl` `PipeSecurity` 的 `AnonymousPipeServerStream` 可以成功;受限进程创建的 `EventWaitHandle` 采用令牌默认 DACL,创建通过。因此令牌默认 DACL 补丁(`setTokenDefaultDaclGrant`)是生效的,但当令牌是受限(limited)令牌时,匿名管道的安全描述符并不来自令牌默认 DACL:`createRestrictedToken` 传入了 `LUA_TOKEN`,而受限令牌的匿名管道 SD 取自一个不含任何限制 SID 的固定模板,于是 WRITE_RESTRICTED 的 pass-2 创建检查失败。开发机(构建 26200)上同样的标志组合是通过的——内核行为随构建不同而不同——这正是"管道已验证"的说法直到现场机器执行前都未被推翻的原因。

## 决策

从 `createRestrictedToken`(`src/token.ts`)的受限令牌标志中移除 `LUA_TOKEN`,保留 `DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED`。没有受限标志后,匿名管道 SD 按文档约定取自令牌默认 DACL,而 `setTokenDefaultDaclGrant` 已向其中合并了全权限的限制 SID ACE——受限管道创建与各种捕获形态在 22H2 上恢复工作,在 26200 上保持工作。

写边界不变:WRITE_RESTRICTED 仍然通过限制 SID 对每次写类访问做交集检查,运行器套件在不带该标志的情况下钉住了环境临时目录、Documents、Public 与 C 盘根目录的拒绝。LUA_TOKEN 带来的东西——过滤管理员(受限)令牌——并不是写机制,pass-2 才是。本 rung 有意不限制读取与其他非写权限,因此变宽的 pass-1(Administrators 组不再 deny-only)不改变被治理的权限面。

## 验证

- 现场机器前后矩阵:带 LUA_TOKEN 时所有捕获形态都失败(`CreatePipe` err 5;管道、捕获、`2>$null`、ProcessStartInfo 重定向全部失败);移除后全部通过,`whoami /all` 也正常工作。
- `tests/console-less.spec.ts` 新增 `ProcessStartInfo.RedirectStandardOutput` 探针,断言 `PSI-REDIRECT: rc=0`——判别性回归:带 LUA_TOKEN 时在 22H2 上以 ERROR_ACCESS_DENIED 失败,移除后在 22H2 与 26200 上都通过。
- 包测试套件:161 通过。六个 `runner.spec.ts` 失败是已记录的、没有安装 pwsh 的机器上的既有环境问题(裸 `pwsh` 映像名导致 Win32 2),在未修改的源码上同样复现。

## 备选方案

- **保留 LUA_TOKEN,探测并降级**——否决:半坏的沙箱本身就是 bug;把 shell 降级为不受限会丢掉写边界,失败关闭则让 22H2 上所有受限运行不可用。
- **把默认 DACL ACE 改为不可继承**——已测试并被证伪:ACE 标志与管道失败无关。
- **在运行器中代理管道 / 注入 DLL 钩住 CreatePipe**——原生 shim 是保住受限标志并恢复管道创建的唯一途径;对只写契约而言代价过大,否决。
- **按构建条件使用 LUA_TOKEN**——版本门槛会引入第二条令牌派生路径和一个需要维护的 OS 下限事实;该标志的好处并不覆盖写边界,无条件移除更简单且有测试钉住。

## 后果

- 受限进程重新可以创建匿名管道:PowerShell 管道、变量捕获、`2>$null` 与 .NET 重定向在两种受限模式下、在 22H2 及之后版本上全部可用。
- `whoami` 与令牌检查 cmdlet 在受限令牌下恢复正常;包 README 中的说法已修正。
- 受限令牌不再标记为 limited:Administrators 组在 pass-1 中保持启用(pass-2 仍然约束每次写),令牌检查失败模式消失。
- libuv 命名管道 stdio 边界不变:受限进程内 `spawn(..., { stdio: 'pipe' })` 仍以 EPERM 失败(命名管道默认 SD 模板),与既有文档一致。
- 2026-08-08 的设计笔记已就地更新(标志列表与理由)。
