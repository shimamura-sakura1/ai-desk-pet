# Changelog

## [0.5.1] macOS 稳定性 + 文档

- **macOS 托盘图标修复**：`createTray()` 原先引用未打包的 `frames/` 图片，打包后托盘图标缺失；改为引用已打包的 `assets/icon.png`
- **新增 macOS 图标**：`assets/icon.icns`（由 `scripts/make-icns.js` 跨平台生成，`npm run build:icns`），解除 `.dmg` 构建对 macOS `iconutil` 的依赖
- **README 重写部署章节**：明确「项目是啥 + 怎么部署」三方式（下载安装包 / 源码运行 / 自打包），并注明 macOS dmg 只能在 Mac 上构建
- 测试：`npm test` 9 套件 / 111 用例全绿

## [0.5.0] 一键导入角色

### 一键导入角色 ✨
- 新增 **设置 → 导入角色** 标签：上传一张精灵图，自动切割并立即切换为当前角色
- 图片规范：PNG 透明背景、**固定 7 列**（每行动作 7 帧）、**行数可调**（每行 = 一个状态）
- 渲染端用 `<canvas>` 切帧（无原生依赖），主进程写入用户数据目录并生成预设
- 支持同一状态多行（自动编号 `idle` / `idle-2` …），切换 `activePreset` 后重载宠物
- 导入数据存于用户数据目录（`%APPDATA%/ai-desk-pet/`），不污染仓库、重装保留
- 新增单测 `tests/import-character.test.js`：预设生成、重复状态编号、帧写入、active 切换、重载信号、名称校验

### 发布
- 打包 Windows NSIS 安装版 + 便携版 exe（v0.4.0），上传 GitHub Release

## [0.3.x] 近期完善（本轮）

### Windows 完整适配
- 进程检测、`open-project`、`openSSHInTerminal` 等全部跨平台，Windows 下 `npm start` 可正常运行
- 默认预设 `config/presets/default.json` 改为跨平台相对路径（此前写死 macOS 绝对路径导致开箱即坏）
- 打包图标使用 `assets/icon.ico`

### 动作平滑（光流法补帧）✨
- 新增 `src/renderer/pet/optical-flow.js`：单尺度 Lucas–Kanade 光流（由粗到细）+ 反向 warp 插值，纯函数可单测
- 引擎 `engine.js` 接入：按配置对关键帧插值，倍数 >1 时关闭 intro/outro 走平滑循环
- 设置 → **动画** 面板：开关 / 补帧倍数（1×–4×）/ 计算质量（快速·均衡），默认关闭
- 加 `_loopStarted` 守卫，避免 preset 重载时启动第二个渲染循环

### 动作状态机加固
- 统一清理 `bored` / `done` 定时器，避免 `attention` / `done` 锁定残留导致卡死
- 验证 `done → idle`、`attention` 由授权完成解锁等路径无死锁

### 多 Agent 检测
- 新增 `src/main/monitor/agents.js`：按进程名大小写 + 可执行路径区分 CLI 与桌面版
- 支持 **claude-cli / codex-cli / claude-desk / codex-desk**
- 本地监控器在会话空闲但 Agent 在跑时仍显示 Working

### 跳转到聊天（open-chat）
- 新增 `open-chat` IPC：本地 Claude 会话执行 `claude --resume <sessionId>` 精确回到该会话
- 桌面版 Agent 聚焦其窗口

### 会话面板优化
- 新增可拖拽标题栏 + 关闭按钮
- 面板**失焦（点其它界面）自动关闭**
- 宠物拖动时面板跟随移动
- 卡片新增「跳转到聊天」按钮，顶部显示已检测 Agent

### 素材补全
- 新增默认 `attention` 动画（7 帧，角色举「!」提示泡），从 `frames/row_5` 复制

### 测试
- 新增光流插值单测、Agent 分类单测；全量 `npm test` 通过（8 套件 / 105 用例）

## [0.3.0] 初始克隆版本
- Electron 桌面宠物，监控本地 / SSH 上的 Claude Code 会话
- 内置 idle / bored / working / done / attention / drag 动画
- 会话面板、设置、State Process Editor、SSH 远程监控
- 精灵表切帧工具 `split2png.py` / `png2state.py`
