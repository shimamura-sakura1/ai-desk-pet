# AI Desk Pet（AI 桌宠）

一个住在屏幕角落的桌面宠物，实时监听你本机 / 远程的 **AI 编程助手会话**（Claude Code、Codex CLI、Claude Desk、Codex Desk）。当助手在思考、干活、或等待你授权时，桌宠会用不同的动画告诉你，一眼就能掌握状态。

**支持 macOS 与 Windows（已完整适配）。**

> **一句话**：AI 桌宠 = 一个常驻屏幕角落的透明桌宠，实时把 Claude Code / Codex 等 AI 编程助手的工作状态（思考中 / 等待授权 / 已完成）用动画展示出来，支持本机与 SSH 远程监控。macOS / Windows 双平台。

---

## 它能做什么

| 宠物状态 | 触发时机 |
|----------|----------|
| **Idle / Bored** | 没有检测到任何 AI 助手会话在运行 |
| **Working** | 某个助手正在执行任务（含正在运行的 Codex / Claude 桌面版） |
| **Attention** | 助手在等待你授权（`Allow` / `Reject`） |
| **Done** | 刚刚结束一个会话 |
| **Drag** | 你正在拖动宠物 |

- 点击宠物 → 打开 / 关闭**会话面板**（列出所有活跃会话：状态、耗时、最新消息）
- 右键宠物 → 打开**设置**
- 拖动（按住约 0.6 秒再移动）→ 把宠物放到屏幕任意位置
- SSH 远程监控 —— 连接远程机器，一起看它的助手会话
- **动作平滑（光流法补帧）** —— 可选开关，消除低帧率动画的卡顿（见下文）
- **跳转到聊天** —— 点一下直接回到那个会话的终端 / 窗口

---

## 支持的 AI 助手

| 助手 | 进程 | 检测方式 | 跳转行为 |
|------|------|----------|----------|
| Claude Code CLI | `claude` / `claude.exe` | 进程名 | `claude --resume <sessionId>` 精确回到该会话 |
| Codex CLI | `codex` / `codex.exe` | 进程名 | 在终端运行 `codex` 并定位到项目目录 |
| Claude Desk | `Claude` / `Claude.exe` | 进程名（首字母大写）+ 路径 | 聚焦其桌面窗口 |
| Codex Desk | `Codex` / `Codex.exe` | 进程名（首字母大写）+ 路径 | 聚焦其桌面窗口 |

> 说明：在 Windows 上 `claude.exe` 与 `Claude.exe` 同名，程序通过**进程名大小写 + 可执行文件路径**来区分 CLI 与桌面版（best-effort）。若你的环境命名特殊，可在 `src/main/monitor/agents.js` 的 `classify()` 调整。

会话状态仍来自 Claude Code 写入本地的会话日志（`~/.claude/projects/` 与 `~/.claude/sessions/`）。Codex 等其它助手目前以「是否在运行」驱动 Working 状态；当没有 Claude Code 会话但监测到 Codex/Claude 在跑时，宠物会保持 Working 提示。

---

## 环境要求

| | macOS | Windows |
|-|-------|---------|
| 系统 | macOS 12+ | Windows 10 (20H2+) / Windows 11 |
| Node.js | 18+ | 18+ |
| Claude Code | ✅ | ✅ |
| Codex CLI | ✅ | ✅ |
| SSH 跳转 | iTerm2 / Terminal.app | Windows Terminal（`wt.exe`）推荐 |

Claude Code 的会话文件在两个平台都位于 `~/.claude/projects/`，Windows 上即 `C:\Users\<你>\.claude\projects\`。

---

## 快速开始

### 第 1 步 —— 克隆并安装

```bash
git clone https://github.com/shimamura-sakura1/ai-desk-pet.git
cd ai-desk-pet
npm install
```

### 第 2 步 —— 启动应用

```bash
npm start          # 普通模式
# 或 npm run dev   # 开发模式（带额外日志）
```

宠物会出现在主屏幕的右下角：透明、置顶、无窗口边框。

### 第 3 步 —— 打开任意终端里的 AI 助手

```bash
claude
# 或 codex
```

几秒内宠物会从 **Idle** 切到 **Working**。助手完成一个任务等待你下一条消息时切到 **Done**；需要工具授权时切到 **Attention**（橙色），会话面板会自动弹出。

### 第 4 步 —— 查看会话面板

点击宠物切换会话面板。每张卡片显示：

- 彩色圆点（状态指示）
- 项目名与最新消息
- 点击卡片展开 → 看时间戳，并带两个按钮：
  - **跳转到项目**：在 VS Code / Cursor（若正在运行）打开该项目，否则在终端打开项目目录
  - **跳转到聊天**：本地 Claude 会话执行 `claude --resume <sessionId>` 精确回到那个会话；桌面版助手则聚焦其窗口

**面板交互优化**（本轮新增）：
- 顶部有**可拖拽标题栏** + ❌**关闭按钮**，可自由移动面板
- **点击窗口外的其它界面，面板自动关闭**（失焦即隐藏）
- 宠物被拖动时，面板**跟随移动**

### 第 5 步 ——（可选）添加 SSH 远程机器

1. 右键宠物 → **设置** → **SSH 远程** 标签
2. 填主机、端口、用户名、认证方式（密码 / 私钥）
3. 点 **测试连接** 等待绿色确认
4. 点 **添加**

远程会话在面板中带 **SSH** 角标。连接断开时点 **重连** 即可重试，无需重启应用。

### 第 6 步 ——（可选）使用自己的角色素材

见下文「自定义角色」。

---

## 设置

右键宠物 → **设置**：

| 分区 | 可配置项 |
|------|----------|
| **会话面板** | 面板显示的最大会话数 |
| **角色** | 指向你自己的精灵图（Clip）文件夹 |
| **导入角色** | 上传 7 列精灵图，自动切分并切换为当前角色（最简方式） |
| **动画** | **动作平滑（光流法补帧）** —— 开关、补帧倍数、计算质量 |
| **SSH** | 添加要监控的远程机器 |

SSH 凭据保存在 `~/.ai-desk-pet/credentials.json`，**不会提交进仓库**。

---

## 动作平滑（光流法补帧）

原始桌宠素材普遍是 7 帧左右的低帧率动画，播放时会有明显卡顿。本项目内置了一个**光流法（optical flow）帧插值模块**（`src/renderer/pet/optical-flow.js`），在每两个关键帧之间计算并生成中间帧，让动作更顺滑。

- 算法：单尺度 Lucas–Kanade 光流估计（由粗到细细化）+ 反向 warp 插值，纯函数实现，可在 Node 下单元测试
- **完全可选、可配置**，默认关闭，不影响原行为

在 **设置 → 动画** 中：

| 配置项 | 取值 | 说明 |
|--------|------|------|
| 启用光流补帧 | 开 / 关 | 关闭即恢复原始帧播放 |
| 补帧倍数 | 1× / 2× / 3× / 4× | 每两帧之间插入「倍数 − 1」张中间帧（2× 插 1 帧，4× 插 3 帧） |
| 计算质量 | 快速 / 均衡 | 快速 = 低分辨率光流，更快；均衡 = 更平滑 |

点 **应用并重载桌宠** 生效。计算在本地完成，**开启后首次加载桌宠会稍慢**（已在界面注明）。

> 性能提示：倍数越高、质量越均衡越平滑，但首帧生成耗时越长；老机器建议先用「2× / 快速」。

---

## 自定义角色

动画系统基于 **Clip（片段）** 模型：每个状态（`idle` / `working` / `done` / `drag` / `bored` / `attention`）映射到一或多个命名 Clip 文件夹。

### 一键导入角色（最简方式，无需脚本）

不想用 Python 脚本？用 **设置 → 导入角色** 标签即可一键完成：上传一张精灵图，自动切割并立即切换为当前角色。

**图片规范：**
- 格式 **PNG**，背景**透明**
- **固定 7 列**：每一行含 7 帧动作（按顺序播放）
- **行数可调**（1–20）：每一行 = 一个动作状态
- 所有帧需为相同尺寸（程序按网格均匀切分）

**操作流程：**
1. 点 **选择图片…** 上传符合规范的精灵图
2. 预览区显示 7×N 的切分网格，并提示每帧像素尺寸
3. 设置**动作行数**（= 状态数）
4. 为每一行选择状态（待机 / 无聊 / 工作中 / 工作结束 / 拖动 / 等待回应）；同一状态可指定多行，自动编号为 `idle`、`idle-2` …
5. 填写**宠物名称**（英文/拼音，作本地文件夹名）
6. 点 **导入并应用** —— 切片帧写入本地、生成预设，桌宠立即重载为你的新角色

导入的角色保存在用户数据目录（`%APPDATA%/ai-desk-pet/`，Windows；`~/Library/Application Support/ai-desk-pet/`，macOS），**不进仓库、重装保留**。

> 想要更精细的控制（手动裁剪留白、自由行列数、多状态多行映射）可继续用下面的 `split2png.py` + `png2state.py` 流程。

### 第 1 步 —— 用 `split2png.py` 把精灵表切成帧

如果你有一张精灵表（所有帧按网格排在一张图里），用自带工具切：

```bash
pip install Pillow   # 仅首次
python split2png.py -i my-character.png -o my-character-frames/ --rows 7 --cols 7
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `-i` / `--input` | — | 精灵表 PNG 路径（必填） |
| `-o` / `--output` | 与输入同目录、沿用文件名 | 输出帧文件夹 |
| `--rows` | `7` | 行数 |
| `--cols` | `7` | 列数 |

脚本会裁掉每格的透明留白，输出 `row_1_frame_1.png` … `row_7_frame_7.png`。**每一行是一个动画 Clip**，同行帧画布尺寸一致，播放不抖动。

### 第 2 步 —— 用 `png2state.py` 把行分配为状态

```bash
python png2state.py \
  -i my-character-frames/ \
  -o my-character/clips/ \
  -s idle=1 working=2 done=3 drag=4 attention=5 bored=6,7
```

| 选项 | 说明 |
|------|------|
| `-i` / `--input` | 上一步得到的 `row_X_frame_Y.png` 文件夹 |
| `-o` / `--output` | 输出文件夹（默认 `<input>/clips/`） |
| `-s` / `--status` | 一个或多个 `state=row` 映射，同一状态多行用逗号分隔，自动加 `-1`/`-2` 后缀 |

### 第 3 步 —— 加载角色

1. 右键宠物 → **设置** → **角色**（动作设置）
2. 点 **浏览** 指向 clips 文件夹（如 `my-character/clips/`）
3. 点 **应用到预设** —— 自动探测子文件夹并按名映射到状态
4. 打开 **State Process Editor** 点 **应用执行** 应用到实时宠物

也可用 **State Process Editor**（设置 → 自定义组件 → 打开 State Process Editor）手动把 Clip 接到状态，并单独预览每个动画。

### 应用期望的目录结构

```
my-character/clips/
  idle/
  idle-2/        ← 可选的第二个 idle 变体
  working/
  done/
  drag/
  attention/
  bored-1/
  bored-2/
```

每个文件夹内的 PNG 帧按字母序播放。

### 三段式 Clip（推荐）

Clip ≥ 3 帧且开启三段式（默认）时：

| 帧 | 角色 |
|----|------|
| 首帧 | **Intro** —— 进入状态时播放一次 |
| 中间帧 | **Loop** —— 循环直到状态改变 |
| 末帧 | **Outro** —— 离开状态前播放一次 |

---

## State Process Editor

设置 → 自定义组件 → **State Process Editor**：

- 拖动状态节点重排图
- 点状态的 **Clip 行** 看分配了哪些 Clip
- 右键 Clip 可**重命名**
- **调试面板**（右侧）—— 点状态打开独立预览窗看该动画；点其中某 Clip 可固定只看那一条
- 点右上角 **应用执行** 保存预设并立即应用到实时宠物
- 调试预览**不会**影响真实桌宠

---

## SSH 监控

1. 右键宠物 → 设置 → **SSH 远程**
2. 添加服务器（主机、端口、用户名、认证方式）
3. 点 **测试连接** 校验
4. 点 **添加** —— 宠物立即开始和本地一起监控远程助手会话
5. 连接断开点 **重连** 重试，无需重启

远程会话在面板中带 **SSH** 角标并显示服务器名。

> 远程会话路径同样为 `~/.claude/projects/` 与 `~/.claude/sessions/`。SSH 监控通过现有 SSH 连接读取，远程机器无需安装 agent / 守护进程。

---

## 部署 / 安装

本项目是 Electron 桌面应用，有三种使用方式：**直接用现成安装包**（推荐普通用户）、**从源码运行**（开发者 / 自托管）、**自己打包安装程序**（分发给他人）。

### 方式 A：下载安装包（普通用户，无需 Node.js）

前往 GitHub Releases，下载对应平台的产物，双击即可使用：

| 平台 | 文件 | 说明 |
|------|------|------|
| Windows | `AI桌宠 Setup x.x.x.exe` | NSIS 安装包（x64 / ia32），可自选安装目录，并创建桌面与开始菜单快捷方式 |
| Windows | `AI桌宠 x.x.x.exe` | 便携版，无需安装，拷到任意位置双击运行 |
| macOS | `AI桌宠-x.x.x.dmg` | 打开后把 App 拖入「应用程序」（同时含 arm64 / x64） |

> 未签名的 Windows 安装包首次运行会被 SmartScreen 拦截，点「仍要运行」即可；未公证（notarize）的 macOS 应用首次打开时需 **右键 → 打开** 以绕过 Gatekeeper。若要分发给他人，建议配置代码签名（Windows）或对 macOS 做签名 + 公证。

### 方式 B：从源码运行（开发者 / 自托管）

需要 **Node.js 18+** 与 Git：

```bash
git clone https://github.com/shimamura-sakura1/ai-desk-pet.git
cd ai-desk-pet
npm install
npm start          # 启动（透明、置顶、右下角）
# npm run dev     # 开发模式（带额外日志）
```

### 方式 C：自己打包安装程序

使用 [electron-builder](https://www.electron.build/)，产物输出到 `dist/`：

```bash
npm run build:win     # Windows：NSIS 安装包 + 便携 exe
npm run build         # macOS：.dmg（⚠️ 必须在 macOS 上执行）
npm run build:all     # 同时构建（mac 包仍需在 macOS 上跑）
```

**要点：**
- **macOS 安装包只能在 macOS 上构建** —— Windows / Linux 无法产出 `.dmg`。
- **应用图标**：仓库已内置 `assets/icon.icns`（macOS）与 `assets/icon.ico`（Windows）。若图标丢失，可一键重新生成（跨平台、无需 macOS 的 `iconutil`）：
  ```bash
  npm run build:icns   # 由 assets/icon.png 生成 assets/icon.icns
  ```
- 打包白名单见 `package.json` 的 `build.files`（仅 `src/`、`assets/`、`config/`），`node_modules/`、`tests/`、`frames/` 不会进安装包；`assets/pets` 经 `extraResources` 一并随包分发。
- 去除 SmartScreen / Gatekeeper 拦截需配置代码签名（Windows）或对 macOS 做签名 + 公证。

### 只想构建 Windows x64（更快）

```bash
npx electron-builder --win --x64
```

---

## 项目结构

```
ai-desk-pet/
├── src/
│   ├── main/
│   │   ├── index.js            # Electron 主进程 —— 窗口管理、失焦关闭面板
│   │   ├── ipc.js              # IPC 处理（含 open-chat / 光流默认配置）
│   │   ├── preload.js          # 上下文桥接
│   │   └── monitor/
│   │       ├── local.js        # 监控本机 ~/.claude 会话 + Agent 进程
│   │       ├── agents.js       # 跨平台 Agent 检测（claude/codex cli & desk）
│   │       └── ssh.js          # SSH 远程日志监控
│   └── renderer/
│       ├── pet/                # 透明宠物窗口
│       │   ├── engine.js       # 动画引擎 + 状态机 + 光流补帧接入
│       │   ├── optical-flow.js # 光流法帧插值（纯函数）
│       │   └── index.html
│       ├── board/              # 会话状态面板（可拖拽 / 自动关闭）
│       ├── settings/           # 设置界面（含动画面板）
│       └── state-editor/       # Clip / 状态图编辑器
├── assets/
│   ├── clips/                  # 内置演示精灵帧（含 attention 动画）
│   ├── pets/default/           # 默认宠物定义
│   ├── icon.icns               # macOS 图标（由 icon.png 经 scripts/make-icns.js 生成）
│   ├── icon.ico                # Windows 图标
│   └── icon.png                # 通用图标（macOS 图标源）
├── scripts/
│   └── make-icns.js            # 跨平台生成 assets/icon.icns（npm run build:icns）
├── config/
│   └── presets/default.json    # 默认 Clip → 状态映射（跨平台相对路径）
├── split2png.py                # 第 1 步：精灵表切帧
├── png2state.py                # 第 2 步：行 → 状态
└── tests/                      # Jest 测试（状态机 / 光流 / Agent 检测）
```

---

## 测试

```bash
npm test
```

覆盖：状态机优先级与转换、光流插值正确性、Agent 分类逻辑等。

---

## 常见问题

**宠物不动 / Clip 显示异常**  
设置 → 角色 → 重新选择 Clip 根目录；确认每个 Clip 子文件夹内 PNG 按播放顺序命名（`row_1_frame_1.png` …）。

**开启光流补帧后首帧很慢 / 卡**  
降低倍数（用 2×）或切到「快速」质量；老机器建议关闭补帧。

**SSH 会话不出现**  
确认远程机器确实在跑 Claude Code，且远程用户的 `~/.claude/projects/` 对 SSH 用户可读。用 **重连** 重试。

**跳转到聊天打开了新终端而不是聚焦已有会话**  
这是已知限制 —— 可靠识别某个终端标签页对应哪个 SSH 会话需要各终端私有 API。应用会在终端已运行时把它提到前台；若没终端在跑则在项目目录开新窗口。

**它支持 Claude.ai 网页版或 API 吗？**  
不支持 —— 它监控 Claude Code CLI 写入本地的文件会话日志，不接入网页或 API。Codex 等以「是否在运行」驱动状态。

**Windows 上宠物窗口不透明**  
透明无边框窗口依赖硬件加速合成。在部分老旧 GPU 或远程桌面 / 某些虚拟机下可能不透明，这是 Electron 在 Windows 上的限制。

**Windows 上 claude-cli 与 claude-desk 区分不准**  
二者进程名都是 `claude.exe`，靠大小写/路径区分属 best-effort。若你的环境特殊，改 `src/main/monitor/agents.js` 的 `classify()`。

---

## 许可证

MIT
