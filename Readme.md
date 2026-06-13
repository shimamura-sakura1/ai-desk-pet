# ai-desk-pet

> 桌面宠物形态的 AI 助手监控工具 —— 实时监控 Claude Code / Gemini 对话状态，以可爱的桌宠形式陪伴你的每一次 AI 编程。

---

## 功能特性

- **多 Session 实时监控** — 同时监控多个 Claude Code session 及 Gemini (Web) 的回复与权限请求状态
- **视觉提醒** — 当 AI 回复到达或需要 Approve/Reject 时，桌宠通过动画给予强烈视觉反馈
- **远程 SSH 监控** — 通过 SSH 连接远程开发机，监听远程 Claude Code 进程与日志
- **Token 消耗统计** — 在桌宠 UI 附近展示按年/月/日分类的 Token 消耗记录
- **可扩展桌宠皮肤** — 基于标准 JSON Schema + 帧图片，随时替换或新增桌宠形象

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron.js |
| 后端服务 | Node.js |
| SSH 连接 | ssh2 |
| 动画渲染 | Canvas / CSS Keyframes |
| 前端（设置页） | HTML / CSS / JS |

---

## 安装与运行

```bash
git clone https://github.com/your-name/ai-desk-pet.git
cd ai-desk-pet
npm install
npm start
```

> 依赖 Node.js >= 18

---

## 项目目录结构

```
ai-desk-pet/
├── src/
│   ├── main/               # Electron 主进程
│   │   ├── index.js        # 入口，窗口管理
│   │   ├── monitor/        # 监控模块
│   │   │   ├── local.js    # 本地进程/日志监控
│   │   │   └── ssh.js      # 远程 SSH 监控
│   │   └── ipc.js          # IPC 通信处理
│   └── renderer/           # 渲染进程（桌宠窗口 + 设置页）
│       ├── pet/
│       │   ├── index.html
│       │   ├── engine.js   # 动画状态机引擎
│       │   └── style.css
│       └── settings/
│           ├── index.html
│           └── settings.js
├── assets/
│   └── pets/
│       └── default/        # 默认桌宠资源
│           ├── pet.json    # 桌宠配置文件
│           └── frames/     # 帧图片
├── config/
│   └── user.json           # 用户配置（SSH 凭证、监控路径等）
└── package.json
```

---

## 桌宠配置规范（JSON Schema）

每个桌宠由一个 `pet.json` 配置文件 + 一组帧图片目录构成，替换资源无需修改代码。

```json
{
  "name": "默认虎宠",
  "version": "1.0.0",
  "size": { "width": 120, "height": 120 },
  "states": {
    "sleep": {
      "frames": ["frames/sleep_01.png", "frames/sleep_02.png"],
      "fps": 4,
      "loop": true
    },
    "act": {
      "frames": ["frames/act_01.png", "frames/act_02.png", "frames/act_03.png"],
      "fps": 8,
      "loop": true
    },
    "thinking": {
      "frames": ["frames/think_01.png", "frames/think_02.png"],
      "fps": 6,
      "loop": true
    },
    "dance": {
      "frames": ["frames/dance_01.png", "frames/dance_02.png", "frames/dance_03.png", "frames/dance_04.png"],
      "fps": 12,
      "loop": false
    },
    "require_action": {
      "frames": ["frames/alert_01.png", "frames/alert_02.png"],
      "fps": 10,
      "loop": true
    }
  },
  "defaultState": "sleep"
}
```

---

## 桌宠状态机

| 状态 | 触发条件 | 优先级 |
|------|----------|--------|
| `sleep` | 无任务时的默认待机 | 最低 |
| `act` | 任意 session 正在对话 | 低 |
| `thinking` | 等待 AI 回复中 | 中 |
| `dance` | 长期 `sleep` 中随机触发 | 低（彩蛋） |
| `require_action` | 需要 Approve/Reject | **最高** |
| `alert` | SSH 断开 / API 报错 | 高 |
| `success` | 长任务完成 | 中（单次） |
| `dragged` | 用户拖动桌宠 | 交互 |
| `poked` | 用户点击桌宠 | 交互 |

> 一期实现：`sleep` / `act` / `thinking` / `dance`，其余状态在后续迭代中完成。

---

## 开发路线图

- [ ] **Phase 1** — 项目初始化，完整目录结构与 `package.json`
- [ ] **Phase 2** — 桌宠 JSON Schema 规范设计与默认皮肤资源
- [ ] **Phase 3** — 核心模块：本地进程监控 + SSH 远程监控
- [ ] **Phase 4** — UI 实现：Electron 透明桌宠窗口 + 动画渲染引擎
- [ ] **Phase 5** — 设置页：SSH 配置、监控路径、皮肤切换

---

## License

MIT
