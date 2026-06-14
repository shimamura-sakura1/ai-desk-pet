# AI 桌宠

一只住在屏幕角落的桌宠，实时监控你的 [Claude Code](https://www.anthropic.com/claude-code) 会话状态。Claude 在思考、工作或等待你授权时，桌宠会切换不同的动画，让你一眼看出当前进度。

> **仅支持 macOS** — 暂无 Windows / Linux 计划。

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

- macOS 12 或更高（Apple Silicon / Intel 均支持）
- Node.js 18 或更高
- 本机（或通过 SSH 连接的远程机器）已安装并使用 [Claude Code](https://www.anthropic.com/claude-code)

---

## 快速开始

```bash
git clone https://github.com/shimamura-sakura1/ai-desk-pet.git
cd ai-desk-pet
npm install
npm start
```

桌宠会出现在主屏幕右下角。

内置的演示素材（`assets/clips/`）是占位帧，替换方式见下文**自定义角色**。

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

### 目录结构

```
我的角色/
  idle-1/          ← 待机变体 1 的帧图
    frame_01.png
    frame_02.png
    ...
  idle-2/          ← 待机变体 2
    ...
  working/
    ...
  done/
    ...
  drag/
    ...
  attention/
    ...
  bored/
    ...
```

每个 Clip 文件夹内的 PNG 按文件名排序后依次播放。

### 三段式动画（推荐）

若一个 Clip 有 ≥ 3 帧且开启了**三段式**：

| 帧 | 作用 |
|----|------|
| 第 1 帧 | **入场（Intro）** — 进入该状态时播放一次 |
| 中间帧 | **循环（Loop）** — 持续循环，直到状态切换 |
| 最后 1 帧 | **出场（Outro）** — 切换状态前播放一次 |

### 加载角色

1. 右键桌宠 → **设置** → **角色** 选项卡
2. 点击**选择素材根目录**，指向你的角色文件夹
3. 应用程序自动识别子文件夹并映射到对应状态
4. 或打开 **状态流程编辑器**（设置 → 高级）手动配置，并在独立预览窗口中查看每个动作

---

## 状态流程编辑器

通过设置 → **状态流程编辑器** 打开。

- 拖动状态节点，重新排布状态机图
- 点击状态节点内的 Clip 行，查看分配情况
- **调试面板**（右侧边栏）— 点击某个状态，打开独立预览窗口播放该动画；点击具体 Clip 可锁定播放单个动作
- 调试预览窗口运行时，**桌面上的桌宠不受影响**，继续正常监控会话

---

## SSH 远程监控

1. 右键桌宠 → 设置 → **SSH** 选项卡
2. 添加服务器信息（主机、端口、用户名、认证方式）
3. 点击**测试连接**验证
4. 保存后立即开始监控远程 Claude Code 会话

远程会话会在面板中显示 **SSH** 标签和服务器名称。

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
├── assets/clips/              # 内置演示素材帧图
├── config/
│   └── presets/default.json   # 默认 Clip 到状态的映射（相对路径）
└── tests/
```

---

## 常见问题

**桌宠不动 / 动画显示异常**  
设置 → 角色 → 重新选择素材根目录。检查每个 Clip 文件夹内的 PNG 文件名是否能按字母顺序正确排序（如 `frame_01.png`、`frame_02.png`……）。

**SSH 会话不显示**  
确认远程机器上 Claude Code 正在运行，且 SSH 用户可以读取远端 `~/.claude/projects/` 目录。

**支持 Claude.ai 网页版或 API 吗？**  
不支持。本项目监控的是 Claude Code CLI 写入的本地日志文件，不涉及网页端或 API。

---

## License

MIT
