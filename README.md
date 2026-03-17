# JumpServer Windows Web Wrapper MVP

一个基于 Electron 的 JumpServer 社区版 Windows Web 套壳客户端 MVP。

## 当前能力

- 主窗口承载 JumpServer 登录与资产访问流程
- 自动识别 Lion 会话路径并新开 Session 窗口
- Session 窗口接管一组高频快捷键
- 提供特殊按键面板
- 提供自定义快捷键映射，例如把 `Ctrl+Alt+X` 映射为远端 `Win+X`
- 提供 `Shortcut Mode` / `Text Mode` 双模输入
- `Text Mode` 采用“本地剪贴板 + 远端粘贴”策略提交短句中文

## 开发

```bash
npm install
npm start
```

## 打包

```bash
npm run dist
```

输出物：

- `dist/JumpServer-Windows-Web-Wrapper-Portable-0.1.0.exe`
- `dist/win-unpacked/JumpServer Windows Web Wrapper.exe`

推荐优先使用 `portable exe`。它会把运行日志写到该 `exe` 同级目录下的 `logs/` 目录。

## 默认本地热键

- `Ctrl+Alt+K`: 打开 Session 面板
- `Ctrl+Alt+Space`: 切换 `Text Mode`
- `Ctrl+Alt+Enter`: 切换本地全屏

## 自定义快捷键映射

- 在首页配置页里可新增“本地触发键 -> 远端组合键”映射
- 适合 `Win+X`、`Win+R`、`Ctrl+Alt+Delete` 这类不适合物理直通的远端动作
- 当前仅支持“一个主键 + 若干修饰键”的组合
- 自定义映射不能与本地控制热键冲突，保存时会检查

## 已知限制

- 不修改 JumpServer 服务端，所以无法做到原生 RDP 级别的 IME 同步
- `Text Mode` 依赖本地剪贴板与远端会话粘贴权限
- `Alt+Tab`、`Win+R`、`Ctrl+Alt+Del` 等系统级组合只能通过面板按钮发送，不能物理直通
- 不建议把所有快捷键无差别直通远端，因为系统保留键、本地窗口控制和 `Text Mode` 本地输入层会发生冲突

## 日志

- 默认开启详细诊断日志
- 日志开关可在首页配置页关闭
- 打包后日志目录固定为运行中 `exe` 同级的 `logs/`
- 主要记录主进程窗口生命周期、导航、快捷键拦截、Session 面板动作、文本模式提交和渲染层异常
