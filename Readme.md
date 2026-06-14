# AI Desk Pet

A desktop companion that lives in the corner of your screen and watches your [Claude Code](https://www.anthropic.com/claude-code) sessions in real time. When Claude is thinking, working, or waiting for your approval, the pet reacts with different animations to let you know at a glance.

> **macOS only** — Windows/Linux support is not planned at this time.

---

## What it does

| Pet state | Triggered when |
|-----------|----------------|
| **Idle / Bored** | No Claude Code session is running |
| **Working** | Claude is actively executing a task |
| **Attention** | Claude needs your approval (`Allow` / `Reject`) |
| **Done** | A session just finished |
| **Drag** | You are dragging the pet around the screen |

- Click the pet → toggles the **session board** (shows all active Claude Code sessions with status, elapsed time, and latest message)
- Right-click → opens **Settings**
- Drag (hold ~0.6 s then move) → reposition the pet anywhere on screen
- SSH monitoring — connect to a remote machine and watch its Claude Code sessions too

---

## Requirements

- macOS 12 or later (Apple Silicon & Intel both work)
- Node.js 18 or later
- [Claude Code](https://www.anthropic.com/claude-code) installed and used on this machine (or a remote via SSH)

---

## Quick start

```bash
git clone https://github.com/shimamura-sakura1/ai-desk-pet.git
cd ai-desk-pet
npm install
npm start
```

The pet will appear at the bottom-right corner of your primary display.

The bundled demo sprites (`assets/clips/`) are placeholder frames — see **Custom characters** below to use your own.

---

## Settings

Right-click the pet → **Settings** to configure:

| Section | What you can set |
|---------|-----------------|
| **Board** | Max sessions shown in the session panel |
| **Character** | Point to a folder of sprite clips (see below) |
| **SSH** | Add remote machines to monitor (host, port, username, key or password) |

SSH credentials are stored in `~/.ai-desk-pet/credentials.json` and are **never committed to the repo**.

---

## Custom characters

The animation system uses a **clip** model: each state (`idle`, `working`, `done`, `drag`, `bored`, `attention`) maps to one or more named clip folders.

### Folder layout

```
my-character/
  idle-1/       ← frames for idle variant 1
    frame_01.png
    frame_02.png
    ...
  idle-2/       ← frames for idle variant 2
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

PNG frames inside each folder are sorted alphabetically and played in order.

### Three-phase clips (recommended)

If a clip has ≥ 3 frames and **three-phase** is enabled:

| Frame | Role |
|-------|------|
| First | **Intro** — plays once on state enter |
| Middle frames | **Loop** — cycles until state changes |
| Last | **Outro** — plays once before leaving the state |

### Loading your character

1. Right-click pet → **Settings** → **Character** tab
2. Click **选择素材根目录** and point to your character folder (e.g. `my-character/`)
3. The app auto-detects sub-folders and maps them to states by name
4. Or open **State Process Editor** (Settings → Advanced) to manually wire clips to states and preview each animation in isolation

---

## State Process Editor

Open via Settings → **State Process Editor** (or the tray menu).

- Drag state nodes to rearrange the graph
- Click a state's **clip rows** to see which clips are assigned
- **Debug panel** (right sidebar) — click a state to open an isolated preview window showing that animation; click a specific clip within it to pin exactly that clip for inspection
- The real desktop pet is **not affected** while the debug preview is open

---

## SSH monitoring

1. Right-click pet → Settings → **SSH** tab
2. Add a server (host, port, username, auth method)
3. Click **测试连接** to verify
4. Save — the pet immediately starts monitoring remote Claude Code sessions alongside local ones

Remote sessions appear in the session board with an **SSH** badge showing the server name.

---

## Project structure

```
ai-desk-pet/
├── src/
│   ├── main/
│   │   ├── index.js          # Electron main — window management
│   │   ├── ipc.js            # IPC handlers
│   │   ├── preload.js        # Context bridge
│   │   └── monitor/
│   │       ├── local.js      # Watches ~/.claude/projects/ logs
│   │       └── ssh.js        # SSH remote log watcher
│   └── renderer/
│       ├── pet/              # Transparent pet window
│       ├── board/            # Session status panel
│       ├── settings/         # Settings UI
│       └── state-editor/     # Clip / state graph editor
├── assets/clips/             # Bundled demo sprite frames
├── config/
│   └── presets/default.json  # Default clip-to-state mapping (relative paths)
└── tests/
```

---

## FAQ

**The pet doesn't animate / clips look wrong**  
Settings → Character → re-select your clip root folder, or check that PNG files inside each clip sub-folder are named so they sort in playback order (e.g. `frame_01.png`, `frame_02.png`…).

**SSH sessions don't appear**  
Make sure Claude Code is actually running on the remote machine and that the remote user's `~/.claude/projects/` directory is readable by the SSH user.

**Does this work with Claude.ai web or the API?**  
No — it monitors the local file-based session logs written by the Claude Code CLI. It does not hook into the web interface or any API.

---

## License

MIT
