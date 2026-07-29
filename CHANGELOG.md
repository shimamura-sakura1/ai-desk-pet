# Changelog

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
