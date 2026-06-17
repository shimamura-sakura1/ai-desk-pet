# AI 桌宠

一只住在屏幕角落的桌宠，实时监控你的 [Claude Code](https://www.anthropic.com/claude-code) 会话状态。Claude 在思考、工作或等待你授权时，桌宠会切换不同的动画，让你一眼看出当前进度。

**支持 macOS 和 Windows。**

---

## 功能一览

| 桌宠状态 | 触发时机 |
|----------|----------|
| **待机 / 无聊** | 没有正在运行的 Claude Code 会话 |
| **工作中** | Claude 正在执行任务 |
| **等待授权** | Claude 需要你点击 Allow / Reject |
| **完成** | 会话刚结束 |
| **拖动** | 你正在拖动桌宠 |

**交互方式**

- 单击桌宠 → 展开 / 收起**会话面板**（显示所有活跃会话的状态、用时、最新消息）
- 右键桌宠 → 打开**设置**
- 长按后拖动（约 0.6 秒）→ 把桌宠拖到屏幕任意位置
- **SSH 远程监控** — 连接远程开发机，同步监控远端的 Claude Code 会话

---

## 环境要求

| | macOS | Windows |
|-|-------|---------|
| 操作系统 | macOS 12 或更高 | Windows 10（20H2+）或 Windows 11 |
| Node.js | 18 或更高 | 18 或更高 |
| Claude Code | ✅ | ✅ |
| SSH 跳转终端 | iTerm2 或 Terminal.app | 推荐 Windows Terminal（`wt.exe`） |

Claude Code 在两个平台上均使用 `~/.claude/projects/` 存储会话文件。Windows 上 `~` 对应 `C:\Users\<用户名>`，即 `C:\Users\<你>\.claude\projects\`。

---

## 逐步上手

### 第一步 — 克隆并安装依赖

```bash
git clone https://github.com/shimamura-sakura1/ai-desk-pet.git
cd ai-desk-pet
npm install
```

### 第二步 — 启动应用

```bash
npm start
```

桌宠出现在主屏幕右下角，透明、无边框、始终置顶。

### 第三步 — 在任意终端启动 Claude Code

```bash
claude
```

几秒内桌宠从**待机**切换为**工作中**。Claude 完成任务等待下一条指令时切换为**完成**；Claude 请求工具授权时切换为**等待授权**（橙色）并自动弹出会话面板。

### 第四步 — 查看会话面板

单击桌宠展开会话面板。每张卡片显示：

- 彩色状态点
- 项目名与最新消息
- 点击卡片展开 → 查看时间信息和**跳转到项目**按钮

**跳转到项目**：如果 VS Code / Cursor 正在运行则在其中打开项目，否则回退到在终端中打开项目目录。

### 第五步 — （可选）添加 SSH 远程机器

1. 右键桌宠 → **设置** → **SSH 远程** 选项卡
2. 填写主机、端口、用户名和认证方式（密码或私钥）
3. 点击**测试连接**，等待绿色提示
4. 点击**添加**

远程会话会在面板中显示 **SSH** 标签和服务器名称。连接断开时，点击对应服务器旁的**重连**按钮即可重试，无需重启应用。

### 第六步 — （可选）使用自定义角色素材

见下文**自定义角色**章节。

---

## 设置说明

右键桌宠 → **设置**，可配置以下内容：

| 选项卡 | 可设置内容 |
|--------|-----------|
| **面板** | 会话面板最多显示几个会话 |
| **角色** | 指定素材根目录（见下文） |
| **SSH** | 添加远程服务器（主机、端口、用户名、密钥 / 密码） |

SSH 凭证保存在 `~/.ai-desk-pet/credentials.json`，**不会**提交到仓库。

---

## 自定义角色

动画系统基于 **Clip**（动作片段）模型：每个状态（`idle`、`working`、`done`、`drag`、`bored`、`attention`）映射到一个或多个 Clip 文件夹。

### 第一步 — 用 `split2png.py` 切割精灵图

如果你有一张精灵图（所有动画帧排列在网格中的单张图片），用内置工具将其切割：

```bash
pip install Pillow   # 仅首次需要
python split2png.py -i my-character.png -o my-character-frames/ --rows 7 --cols 7
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `-i` / `--input` | — | 精灵图 PNG 路径（必填） |
| `-o` / `--output` | 与输入同目录，以文件名命名 | 帧图输出文件夹 |
| `--rows` | `7` | 精灵图行数 |
| `--cols` | `7` | 精灵图列数 |

脚本会自动检测每个单元格的有效内容边界（去除透明填充），输出文件命名为 `row_1_frame_1.png`、`row_1_frame_2.png`……`row_7_frame_7.png`。

每**行**对应一个动作片段，同行所有帧保证相同画布尺寸，播放时不会抖动。

### 第二步 — 用 `png2state.py` 将行分配给状态

切割完成后，将每行分配给一个动画状态：

```bash
python png2state.py \
  -i my-character-frames/ \
  -o my-character/clips/ \
  -s idle=1 working=2 done=3 drag=4 attention=5 bored=6,7
```

| 选项 | 说明 |
|------|------|
| `-i` / `--input` | 第一步输出的 `row_X_frame_Y.png` 所在文件夹 |
| `-o` / `--output` | 输出文件夹（默认：`<input>/clips/`） |
| `-s` / `--status` | 一个或多个 `状态=行号` 映射。同一状态的多行用逗号分隔，输出时加 `-1`、`-2` 后缀（如 `bored-1/`、`bored-2/`） |

运行后，`my-character/clips/` 会包含以状态命名的子文件夹，可直接加载到应用。

状态名可以**任意命名**——与内置状态（`idle`、`working`、`done`、`drag`、`attention`、`bored`）不匹配的 Clip 会在**状态流程编辑器**中显示为未识别，可手动关联到状态。

### 第三步 — 加载角色

1. 右键桌宠 → **设置** → **角色** 选项卡（动作设置）
2. 点击**浏览**，指向 Clip 文件夹（如 `my-character/clips/`）
3. 点击**应用到预设** — 应用自动识别子文件夹并按名称映射到状态
4. 弹窗确认成功后，打开**状态流程编辑器**并点击**应用执行**，将变更应用到实时桌宠

或直接打开**状态流程编辑器**（设置 → 自定义组件 → 打开状态流程编辑器）手动关联 Clip 与状态，并在独立预览窗口中查看各动作。

### 应用所需的目录结构

```
my-character/clips/
  idle/             ← 待机帧
    row_1_frame_1.png
    row_1_frame_2.png
    ...
  idle-2/           ← 可选：第二个待机变体
    ...
  working/
  done/
  drag/
  attention/
  bored-1/
  bored-2/
```

每个文件夹内的 PNG 按文件名排序后依次播放。

### 三段式动画（推荐）

若一个 Clip 有 ≥ 3 帧且开启了**三段式**（默认启用）：

| 帧 | 作用 |
|----|------|
| 第 1 帧 | **入场（Intro）** — 进入该状态时播放一次 |
| 中间帧 | **循环（Loop）** — 持续循环，直到状态切换 |
| 最后 1 帧 | **出场（Outro）** — 切换状态前播放一次 |

---

## 状态流程编辑器

通过设置 → 自定义组件 → **状态流程编辑器** 打开。

- 拖动状态节点，重新排布状态机图
- 点击状态节点内的 Clip 行，查看分配情况
- 右键 Clip 可**重命名**
- **调试面板**（右侧边栏）— 点击某个状态，打开独立预览窗口播放该动画；点击具体 Clip 可锁定播放单个动作
- 点击右上角**应用执行**保存预设并立即应用到实时桌宠
- 调试预览窗口运行时，**桌面上的桌宠不受影响**，继续正常监控会话

---

## SSH 远程监控

1. 右键桌宠 → 设置 → **SSH 远程** 选项卡
2. 添加服务器信息（主机、端口、用户名、认证方式）
3. 点击**测试连接**验证
4. 点击**添加** — 应用立即开始监控远端 Claude Code 会话
5. 连接断开时，点击对应服务器旁的**重连**按钮重试，无需重启应用

远程会话在面板中显示 **SSH** 标签和服务器名称。

> **远端会话路径**：与本地相同，均为 `~/.claude/projects/` 和 `~/.claude/sessions/`。SSH 监控通过已有的 SSH 连接读取这些文件，远端机器无需安装任何 Agent 或守护进程。

---

## 构建发行版

```bash
# macOS (.dmg)
npm run build

# Windows（NSIS 安装包 + 便携版 .exe）
npm run build:win

# 同时构建两个平台
npm run build:all
```

构建产物输出到 `dist/` 目录。Windows 构建需要在 Windows 环境下运行（或使用 electron-builder 的跨平台编译环境）。

---

## 项目结构

```
ai-desk-pet/
├── src/
│   ├── main/
│   │   ├── index.js           # Electron 主进程，窗口管理
│   │   ├── ipc.js             # IPC 通信处理
│   │   ├── preload.js         # Context Bridge
│   │   └── monitor/
│   │       ├── local.js       # 监控本地 ~/.claude/projects/ 日志
│   │       └── ssh.js         # SSH 远程日志监控
│   └── renderer/
│       ├── pet/               # 透明桌宠窗口
│       ├── board/             # 会话状态面板
│       ├── settings/          # 设置界面
│       └── state-editor/      # Clip / 状态机图编辑器
├── assets/
│   ├── clips/                 # 内置演示素材帧图
│   ├── icon.icns              # macOS 应用图标
│   └── icon.ico               # Windows 应用图标
├── config/
│   └── presets/default.json   # 默认 Clip 到状态的映射
├── split2png.py               # 第一步：切割精灵图为逐帧 PNG
├── png2state.py               # 第二步：将行分配给动画状态
└── tests/
```

---

## 常见问题

**桌宠不动 / 动画显示异常**  
设置 → 角色 → 重新选择素材根目录。检查每个 Clip 文件夹内的 PNG 文件名是否能按字母顺序正确排序（如 `row_1_frame_1.png`、`row_1_frame_2.png`……）。

**SSH 会话不显示**  
确认远程机器上 Claude Code 正在运行，且 SSH 用户可以读取远端 `~/.claude/projects/` 目录。使用**重连**按钮重试断开的连接。

**跳转到项目时打开了新终端窗口而不是现有的**  
这是已知限制——可靠地定位某个 SSH 会话所在的终端 Tab 需要依赖各终端的私有 API，且因版本和 Shell 配置而异。如果终端应用已在运行，点击**跳转到项目**会将其拉到前台；如果没有终端在运行，则会打开一个新窗口并建立 SSH 连接。

**支持 Claude.ai 网页版或 API 吗？**  
不支持。本项目监控的是 Claude Code CLI 写入的本地日志文件，不涉及网页端或 API。

**Windows：桌宠窗口不透明**  
透明无边框窗口需要硬件加速合成。在部分旧 GPU、远程桌面或某些虚拟机环境下透明效果可能无法正常渲染，这是 Electron 在 Windows 上的已知限制。

---

## License

MIT
