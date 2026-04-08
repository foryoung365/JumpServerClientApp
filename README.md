# JumpServer Windows Web Wrapper

基于 `Electron` 的 JumpServer 社区版 Windows Web 套壳客户端 MVP。  
An `Electron`-based desktop wrapper MVP for JumpServer Community Edition Windows web sessions.

项目目标不是重做原生 `RDP`，也不修改 JumpServer 服务端，而是在现有 `Lion / Guacamole` Web 链路基础上，优先改善两个高频问题：  
This project does not replace native `RDP` and does not modify the JumpServer server. It focuses on improving two common pain points on top of the existing `Lion / Guacamole` web session flow:

- 浏览器层抢占远端编辑器快捷键，尤其是 `VS Code`  
  Browser-level shortcut conflicts, especially in `VS Code`
- 本机/远端输入法状态不一致导致的中文输入体验差  
  Poor Chinese input experience caused by local/remote IME state mismatch

## 当前状态 / Current Status

当前版本已经可以作为一个可运行、可打包、可诊断的 MVP 使用：  
The current version is already usable as a runnable, packageable, diagnosable MVP:

- 承载 JumpServer 登录、资产访问和会话进入流程  
  Hosts JumpServer login, asset browsing, and session entry flow
- 在会话页注入桌面端增强层  
  Injects a desktop enhancement layer into the session page
- 提供快捷键接管、特殊按键面板、自定义映射、双模输入和日志诊断  
  Provides shortcut takeover, special-key panel, custom mappings, dual input modes, and diagnostic logging

这是一个工程化 MVP，不是最终产品。它已经打通主要链路，但仍然保留一些 Web 远控天然限制。  
This is an engineering MVP, not a final product. The main workflow is already working, but some inherent web remote-access limitations still remain.

## 主要能力 / Features

### 1. JumpServer 页面承载 / JumpServer Page Hosting

- 主窗口直接承载 JumpServer Web 站点  
  The main window directly hosts the JumpServer website
- 识别 Lion 会话页后，在当前窗口内挂载增强层  
  Detects Lion session pages and mounts the enhancement layer in the current window
- 不修改服务端，不依赖私有协议改造  
  No server-side changes and no private protocol modifications

### 2. 快捷键接管 / Shortcut Takeover

- 优先解决 `VS Code`、编辑器、终端中的高频快捷键冲突  
  Prioritizes common shortcut conflicts in `VS Code`, editors, and terminals
- 支持固定内置转发和本地控制热键  
  Supports built-in forwarded shortcuts and local control hotkeys
- 支持自定义“本地触发键 -> 远端组合键”映射  
  Supports custom “local trigger -> remote shortcut” mappings

适合映射的远端动作示例：  
Examples of suitable remote mappings:

- `Win+X`
- `Win+R`
- `Ctrl+Alt+Delete`
- `Win+D`
- `Win+E`

### 3. 特殊按键面板 / Special-Key Panel

- 会话中显示可拖动的悬浮按钮  
  A draggable floating button appears during sessions
- 点击后打开会话增强面板  
  Clicking it opens the session enhancement panel
- 面板内可发送常见系统级组合键  
  The panel can send common system-level key combinations

### 4. 双模输入 / Dual Input Modes

#### Shortcut Mode

- 默认模式  
  Default mode
- 键盘尽量按“远端键盘”处理  
  Treats the keyboard as a remote keyboard as much as possible
- 适合远端快捷键、终端操作、窗口控制  
  Suitable for remote shortcuts, terminal control, and window operations

#### Text Mode

- 使用本地输入框承接本机 IME  
  Uses a local input box to host the local IME
- 适合中文正文、注释、表单、文档输入  
  Suitable for Chinese text, comments, forms, and documents
- 提交时通过文本桥接发送到远端  
  Sends committed text to the remote side through a text bridge

### 5. 中文标点辅助 / Chinese Punctuation Assistance

- `Text Mode` 下支持中文标点校正  
  Supports Chinese punctuation normalization in `Text Mode`
- `Shortcut Mode` 下支持自动中文标点辅助  
  Supports automatic Chinese punctuation assistance in `Shortcut Mode`
- 当前实现重点解决“中文标点输不出来”这个问题，但不等于真正同步本机/远端 IME 状态  
  The current implementation mainly solves “Chinese punctuation cannot be typed”, but it is not true local/remote IME synchronization

### 6. 诊断日志 / Diagnostic Logging

- 默认开启详细日志  
  Detailed logging is enabled by default
- 打包后的日志写入 `exe` 同级目录下的 `logs/`  
  Packaged builds write logs to `logs/` next to the executable
- 支持在首页关闭日志，便于正式使用时降噪  
  Logging can be disabled from the home page for quieter daily use

## 默认本地热键 / Default Local Hotkeys

- `Ctrl+Alt+K`：打开会话面板 / Open the session panel
- `Ctrl+Alt+Space`：切换 `Text Mode` / Toggle `Text Mode`
- `Ctrl+Alt+Enter`：切换本地全屏 / Toggle local fullscreen

## 自定义快捷键映射 / Custom Shortcut Mappings

首页支持新增自定义映射规则：  
The home page supports custom mapping rules:

- 本地触发键：例如 `Ctrl+Alt+X`  
  Local trigger: for example `Ctrl+Alt+X`
- 远端组合键：例如 `Win+X`  
  Remote shortcut: for example `Win+X`

当前规则限制：  
Current constraints:

- 只支持“一组修饰键 + 一个主键”  
  Only supports “modifier keys + one main key”
- 不允许和本地控制热键冲突  
  Must not conflict with local control hotkeys
- 不允许重复触发键  
  Duplicate triggers are not allowed

## 运行方式 / Run

### 开发运行 / Development

```bash
npm install
npm start
```

### 语法检查 / Syntax Check

```bash
npm run check
```

### Windows 打包 / Windows Packaging

```bash
npm run dist
```

打包输出 / Build outputs:

- `dist/JumpServer-Windows-Web-Wrapper-Portable-0.1.1.exe`
- `dist/win-unpacked/JumpServer Windows Web Wrapper.exe`

## 项目结构 / Project Structure

```text
src/
  main/        Electron main process, window routing, logging, shortcut replay
  preload/     Session enhancement logic, floating panel, input modes, page bridge
  renderer/    Home/configuration page
```

## 设计边界 / Design Boundaries

这个项目明确不做这些事情：  
This project explicitly does not do the following:

- 不修改 JumpServer 服务端  
  No JumpServer server-side modifications
- 不重做原生 `RDP`  
  Does not reimplement native `RDP`
- 不承诺本机/远端输入法状态真正同步  
  Does not guarantee true local/remote IME state synchronization
- 不承诺系统级组合键物理直通  
  Does not guarantee physical pass-through of system-level shortcuts

以下系统级组合键仍然更适合通过面板或映射触发：  
The following system-level key combinations are still better sent through the panel or custom mappings:

- `Alt+Tab`
- `Win+R`
- `Win+X`
- `Ctrl+Alt+Delete`

## 已知限制 / Known Limitations

- Web 链路下的输入体验仍然受浏览器、Electron、Lion、Guacamole 和远端应用共同影响  
  Input behavior is still influenced by the browser, Electron, Lion, Guacamole, and the remote application
- 中文输入已经比原始浏览器体验更好，但仍不是原生 RDP 级别  
  Chinese input is improved compared with a plain browser, but it is still not native-RDP-level
- `Shortcut Mode` 中的中文输入和中文标点依赖启发式辅助，不保证所有应用场景完全一致  
  Chinese input and punctuation in `Shortcut Mode` rely on heuristics and may not behave identically in all apps
- `Text Mode` 更适合中文正文，不适合作为所有输入场景的默认模式  
  `Text Mode` is better for Chinese text input, but not ideal as the default for every scenario
- 系统级快捷键仍然存在平台限制，部分动作只能通过按钮或映射间接完成  
  System-level shortcuts still have platform limits, and some actions can only be triggered indirectly

## 配置与日志位置 / Config and Logs

运行时配置保存在 Electron 用户数据目录中的 `config.json`。  
Runtime configuration is stored in `config.json` under the Electron user data directory.

打包运行时日志默认写到：  
Packaged runtime logs are written to:

- `logs/wrapper.log`

这个 `logs/` 目录位于可执行文件同级目录。  
The `logs/` directory is created next to the executable.

## 适用场景 / Recommended Use Cases

- 通过 JumpServer 社区版访问 Windows 图形会话  
  Accessing Windows graphical sessions through JumpServer Community Edition
- 在远端使用 `VS Code`、编辑器、浏览器、表单类应用  
  Using `VS Code`, editors, browsers, and form-based apps remotely
- 需要改善中文注释、文档和常见标点输入  
  Improving Chinese comments, documents, and punctuation input
- 需要把常用系统键做成桌面端可控行为  
  Making common system keys more controllable from a desktop wrapper

## 后续方向 / Future Work

- 更稳定的中文输入链路 / More stable Chinese input handling
- 更细粒度的快捷键策略 / Finer-grained shortcut policy
- 更完整的屏幕键盘 / A more complete on-screen keyboard
- 更完善的诊断导出 / Better diagnostic export
- 签名、安装器和发布体验 / Signing, installer, and release polish

