# Agent 笔记：无控制台宿主把受限子进程钉到专用隐藏桌面

状态：已实现

[English](2026-08-15-console-less-confinement-desktop.md) | 中文

## 问题

2026-08-15 现场故障：在打包的桌面外壳（`apps/desktop`，Electron）中，沙盒内的工具调用间歇性弹出 Windows 应用程序错误对话框——System 日志 Event 26，`git.exe` / `node.exe`，`应用程序无法正常启动 (0xC0000142)`（`STATUS_DLL_INIT_FAILED`）。六次弹窗与同一个桌面宿主会话中的沙盒 `powershell` 工具调用逐秒对应；每条失败命令都带 `2>$null` stderr 重定向，而相同命令去掉重定向后相隔几秒即成功。故障是间歇性的，隔离环境下从未复现（35+ 次无控制台复现调用全部通过），说明问题出在共享的环境资源而非确定性的拒绝。

桌面外壳以 `windowsHide` 启动 Host 进程树，因此 `dsh-sandbox-windows-acl` 的 runner 没有控制台（`GetConsoleWindow` 为 NULL）。受限的控制台子系统子进程无法共享宿主控制台，Windows 只能让它对着交互式的 `WinSta0\Default` 桌面初始化。在 `WRITE_RESTRICTED` 令牌下，这条路径有双重脆弱性：pass-2 restricted-SID 访问检查依赖 `Default` 的 DACL 恰好携带的兜底 ACE，而且全机的控制台/桌面堆使用者共享 `Default` 的堆——一台已开机一个月、安全软件又在扫描子进程启动的机器，让这种碰撞呈现间歇性。

## 决策

遵循标准沙盒做法（Chromium 的备用桌面）：当 runner 没有控制台时，`src/desktop.ts` 在进程窗口站上创建专用隐藏桌面 `dsh-acl-<pid>-<6hex>`，其 DACL 由 SDDL 构建，向 SYSTEM（`S-1-5-18`）、Administrators（`S-1-5-32-544`）、Everyone（`S-1-1-0`）、登录 SID（经 `ConvertSidToStringSidW` 字符串化）以及工作区/临时 capability SID 授予 `GENERIC_ALL`。两条 spawn 路径都把它钉为 `STARTUPINFOW.lpDesktop`（`<WinStaName>\<name>`），于是所有受限后代进程继承该桌面，对着显式的 pass-2 ACE 与全新的桌面堆确定性地初始化 console/user32。桌面创建与 init 其他步骤一样失败即拒绝——建不出桌面的 runner 绝不 spawn。

本次新增的 FFI 面（`user32`：`GetConsoleWindow`、`GetProcessWindowStation`、`GetUserObjectInformationW`、`CreateDesktopW`、`CloseDesktop`；`advapi32`：`ConvertSidToStringSidW`、`ConvertStringSecurityDescriptorToSecurityDescriptorW`），并把 `STARTUPINFOW.lpDesktop` 从 koffi `'str16'` 改为 `PVOID`，由调用方持有的 UTF-16 缓冲区在 `CreateProcessAsUserW` 期间保持引用。一个实测 FFI 陷阱以注释钉住：把返回的字符串指针**按** `'str16'` 解码会把字符串前几个码元重新解释成嵌套指针，进而让进程段错误（`0xC0000005`）；`decodeString16` 用（指针、偏移、类型）形式逐 `uint16` 读取，绝不越过终止符。

有控制台（终端 CLI）的 runner 保持长期以来共享控制台的路径完全不变——`hasConsole` 门控桌面创建，未钉桌面时 spawn 形态与之前逐字节一致。

## 验证

- `tests/desktop.spec.ts`：SDDL 构建器的纯函数测试；经真实绑定实地创建/关闭隐藏桌面；capability SID 的接受；垃圾 SID 的失败即拒绝；无控制台（`windowsHide`）子进程探针断言 `hasConsole` 为 false 且桌面创建可用。
- `tests/console-less.spec.ts`：端到端复刻现场链路——`windowsHide` runner → 受限 `powershell` → 带 `2>$null` 的 `cmd`/`node`/`git` 孙进程，外加十次连续孙进程启动——断言退出码 0、输出符合预期、stderr 无 `windows-acl-run:`。
- mock 失败路径套件（`index-failure-paths.spec.ts`）通过打桩 `getConsoleWindow` 保持走有控制台分支。
- 现场诊断时的 15 例重定向复现与 20 路并发复现，改指仓库构建的 `lib/runner.js` 后全部通过，且 System 日志 Event 26 计数不变。
- 在未安装 `pwsh`（PowerShell 7）的机器上，`runner.spec.ts` 有六个**既有**失败，属环境问题（`CreateProcessAsUserW` 对裸 `pwsh` 映像名报 Win32 2——用改动前的打包 runner 可原样复现），与本次改动无关。

## 已考虑的替代方案

- **把控制台登录 SID（`S-1-2-1`）加入 restricting 列表**——POC 与 README 边界已证伪：子进程仍在 DLL 初始化时死亡。
- **用 `CREATE_NEW_CONSOLE`/`CREATE_NO_WINDOW` 包裹孙进程**——正是记录在案的 `0xC0000142` 边界；该标志在此限制方案下不可用。
- **给 `WinSta0\Default` 追加 ACE**——修改交互桌面的 DACL 会放宽所有进程的可达面，且仍然共享其堆；专用桌面是严格更强的隔离。
- **给 runner 自己 `AllocConsole`**——隐藏控制台仍会让孙进程的 user32/GDI 路径对着环境桌面初始化，还可能出现可见控制台窗口；桌面钉同时覆盖控制台与 GUI 子系统子进程。

## 后果

- 控制台子系统孙进程（`git.exe`、`node.exe`）在桌面外壳下确定性初始化，且每个 runner 拥有全新桌面堆。
- conhost 窗口不会在用户屏幕上闪烁；受限进程失去对用户桌面对象的兜底访问——在修复之外还增强了隔离。
- 被杀掉的 runner 遗留的陈旧桌面不会被外来 DACL 重新打开（名字带 pid 加随机后缀）；最后一个句柄关闭且没有进程附着时，内核销毁该桌面。
- 桌面创建并入 runner 失败即拒绝的 init 契约：任何 Win32 失败都以 `windows-acl-run:` 加退出码 127 中止 spawn，绝不退化为非受限子进程。

## 现场跟进（2026-08-15，当日）

原文"`0xC0000142` 弹窗类故障从构造上消除"的论断被现场证伪：修复后的构建仍间歇弹出 `git.exe` `0xC0000142` 应用程序错误对话框（System 日志 Event 26，15:14–15:15）。取证排除了所有确定性原因——门控确实触发、pin 确实生效、840 次现场等价压力 spawn 全部通过、无轮询器、无会话锁/解锁事件、无 Defender 拦截记录——结论是不可复现的环境瞬态。桌面 pin 仍是首要机制，但不再声称凭构造即可充分消除。

纵深防御随 `dsh` 0.1.0-rc.6 交付：

- **抑制弹窗的进程错误模式**：runner 启动时安装 `SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX)`（`0x8003`，见 `src/error-mode.ts`）。子进程在 `CreateProcess` 时继承错误模式——与令牌、桌面相互正交——因此 loader 初始化阶段死亡的受限进程把 NTSTATUS 作为退出码经工具结果上报，而不再弹出模态对话框。已在故障机上实证：`DllMain` 在 `DLL_PROCESS_ATTACH` 返回失败的 `failinit.exe` 探针（精确复现 `0xC0000142` 死亡）在错误模式 `0` 下触发 Event 26 并挂死在模态弹窗上，而在 `0x8003` 下**无** Event 26、立即以 `0xC0000142` 退出码返回。经构建产物 runner 的同类死亡同样无弹窗且留下完整 debug 日志轨迹。
- **取证 debug 日志**：runner 新增 `--debug-log <path>` 标志，写入尽力而为的 JSONL 轨迹（`start`/`init`/`desktop`/`spawn`/`spawn-fail`/`exit`，512 KiB 上限、单次轮转）。桌面外壳经 Host spawn 环境以 `DSH_ACL_DEBUG_LOG=<userData>/logs/acl-runner.log` 启用；`sandbox-local` 在 Host 进程内读取并以 `--debug-log` 形式转发到 runner argv，因为 runner 环境会清除所有 `DSH_*` 变量。现场若再发，日志自描述而不再是裸弹窗。
