# AI Desk Pet

A desktop companion that lives in the corner of your screen and watches your [Claude Code](https://www.anthropic.com/claude-code) sessions in real time. When Claude is thinking, working, or waiting for your approval, the pet reacts with different animations to let you know at a glance.

**Supports macOS and Windows.**

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

| | macOS | Windows |
|-|-------|---------|
| OS | macOS 12 or later | Windows 10 (20H2+) or Windows 11 |
| Node.js | 18 or later | 18 or later |
| Claude Code | ✅ | ✅ |
| SSH jump (跳转) | iTerm2 or Terminal.app | Windows Terminal (`wt.exe`) recommended |

Claude Code stores session files in `~/.claude/projects/` on both platforms. On Windows that resolves to `C:\Users\<you>\.claude\projects\`.

---

## Step-by-step: Getting started

### Step 1 — Clone and install

```bash
git clone https://github.com/shimamura-sakura1/ai-desk-pet.git
cd ai-desk-pet
npm install
```

### Step 2 — Start the app

```bash
npm start
```

The pet appears at the bottom-right corner of your primary display. It is transparent, always-on-top, and has no window frame.

### Step 3 — Open Claude Code in any terminal

```bash
claude
```

Within a few seconds the pet switches from **Idle** to **Working**. When Claude finishes a task and waits for your next message it switches to **Done**. When Claude asks for tool approval it switches to **Attention** (orange) and the session board opens automatically.

### Step 4 — View the session board

Click the pet to toggle the session board. Each card shows:

- A colored dot (state indicator)
- The session's project name and last message
- Click a card to expand it → see timestamps and a **跳转到项目** (Jump to project) button

**Jump to project** opens the project in VS Code / Cursor if either is running, or falls back to a terminal at the project directory.

### Step 5 — (Optional) Add SSH remote machines

1. Right-click the pet → **Settings** → **SSH 远程** tab
2. Fill in host, port, username, and authentication method (password or private key)
3. Click **测试连接** (Test connection) — wait for the green confirmation
4. Click **添加** (Add)

Remote sessions appear in the board with an **SSH** badge. If the connection drops, click **重连** (Reconnect) next to that server to retry without restarting the app.

### Step 6 — (Optional) Use your own character sprites

See the **Custom characters** section below.

---

## Settings

Right-click the pet → **Settings** to configure:

| Section | What you can set |
|---------|-----------------|
| **Board** | Max sessions shown in the session panel |
| **Character** | Point to a folder of sprite clips (see below) |
| **SSH** | Add remote machines to monitor |

SSH credentials are stored in `~/.ai-desk-pet/credentials.json` and are **never committed to the repo**.

---

## Custom characters

The animation system uses a **clip** model: each state (`idle`, `working`, `done`, `drag`, `bored`, `attention`) maps to one or more named clip folders.

### Step 1 — Cut a sprite sheet into frames with `split2png.py`

If you have a sprite sheet (a single image containing all animation frames arranged in a grid), use the included tool to slice it:

```bash
pip install Pillow   # first time only
python split2png.py -i my-character.png -o my-character-frames/ --rows 7 --cols 7
```

| Option | Default | Description |
|--------|---------|-------------|
| `-i` / `--input` | — | Path to the sprite sheet PNG (required) |
| `-o` / `--output` | same folder as input, named after the file | Output folder for the cut frames |
| `--rows` | `7` | Number of rows in the sprite sheet |
| `--cols` | `7` | Number of columns in the sprite sheet |

The script detects the true content boundary of each cell (removing empty transparent padding) and outputs files named `row_1_frame_1.png`, `row_1_frame_2.png`, …, `row_7_frame_7.png`.

Each **row** is one animation clip; all frames in a row are guaranteed the same canvas size so they play without jitter.

### Step 2 — Assign rows to states with `png2state.py`

Once you have the per-frame PNGs, assign each row to an animation state:

```bash
python png2state.py \
  -i my-character-frames/ \
  -o my-character/clips/ \
  -s idle=1 working=2 done=3 drag=4 attention=5 bored=6,7
```

| Option | Description |
|--------|-------------|
| `-i` / `--input` | Folder containing the `row_X_frame_Y.png` files from Step 1 |
| `-o` / `--output` | Output folder (default: `<input>/clips/`) |
| `-s` / `--status` | One or more `state=row` mappings. Multiple rows for the same state are separated by commas and get a `-1`, `-2` suffix (e.g. `bored-1/`, `bored-2/`) |

After running, `my-character/clips/` will contain sub-folders named after each state, ready to be loaded into the app.

You can use **any name** for a state — clips with names that don't match a built-in state (`idle`, `working`, `done`, `drag`, `attention`, `bored`) will appear in the **State Process Editor** as unrecognized clips and can be wired to states manually.

### Step 3 — Load the character

1. Right-click pet → **Settings** → **Character** tab (动作设置)
2. Click **浏览** and point to the clips folder (e.g. `my-character/clips/`)
3. Click **应用到预设** — the app auto-detects sub-folders and maps them to states by name
4. A prompt will confirm success. Open **State Process Editor** and click **应用执行** to apply the changes to the live pet.

Or open **State Process Editor** (Settings → 自定义组件 → Open State Process Editor) to manually wire clips to states and preview each animation in isolation.

### Folder layout expected by the app

```
my-character/clips/
  idle/             ← frames for idle
    row_1_frame_1.png
    row_1_frame_2.png
    ...
  idle-2/           ← optional second idle variant
    ...
  working/
  done/
  drag/
  attention/
  bored-1/
  bored-2/
```

PNG frames inside each folder are sorted alphabetically and played in order.

### Three-phase clips (recommended)

If a clip has ≥ 3 frames and **three-phase** is enabled (the default):

| Frame | Role |
|-------|------|
| First | **Intro** — plays once on state enter |
| Middle frames | **Loop** — cycles until state changes |
| Last | **Outro** — plays once before leaving the state |

---

## State Process Editor

Open via Settings → 自定义组件 → **State Process Editor**.

- Drag state nodes to rearrange the graph
- Click a state's **clip rows** to see which clips are assigned
- Right-click a clip to **rename** it
- **Debug panel** (right sidebar) — click a state to open an isolated preview window showing that animation; click a specific clip within it to pin exactly that clip for inspection
- Click **应用执行** (top-right) to save the preset and apply changes to the live pet immediately
- The real desktop pet is **not affected** while the debug preview is open

---

## SSH monitoring

1. Right-click pet → Settings → **SSH 远程** tab
2. Add a server (host, port, username, auth method)
3. Click **测试连接** to verify
4. Click **添加** — the pet immediately starts monitoring remote Claude Code sessions alongside local ones
5. If a connection drops, click the **重连** button next to that server to reconnect without restarting the app

Remote sessions appear in the session board with an **SSH** badge showing the server name.

> **Session path on remote**: the same `~/.claude/projects/` and `~/.claude/sessions/` directories. The SSH monitor reads these over the existing SSH connection — no agent or daemon is required on the remote machine.

---

## Building a distributable

```bash
# macOS (.dmg)
npm run build

# Windows (NSIS installer + portable .exe)
npm run build:win

# Both at once
npm run build:all
```

Built files land in `dist/`. The Windows build requires running on Windows or using an appropriate cross-compile environment (electron-builder cross-compile).

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
├── assets/
│   ├── clips/                # Bundled demo sprite frames
│   ├── icon.icns             # macOS app icon
│   └── icon.ico              # Windows app icon
├── config/
│   └── presets/default.json  # Default clip-to-state mapping
├── split2png.py              # Step 1: cut a sprite sheet into per-frame PNGs
├── png2state.py              # Step 2: assign rows to animation states
└── tests/
```

---

## FAQ

**The pet doesn't animate / clips look wrong**  
Settings → Character → re-select your clip root folder, or check that PNG files inside each clip sub-folder are named so they sort in playback order (e.g. `row_1_frame_1.png`, `row_1_frame_2.png`…).

**SSH sessions don't appear**  
Make sure Claude Code is actually running on the remote machine and that the remote user's `~/.claude/projects/` directory is readable by the SSH user. Use the **重连** button to retry a dropped connection.

**Jump to project opens a new terminal window instead of focusing the existing one**  
This is a known limitation — reliably identifying which terminal tab hosts a specific SSH session requires per-terminal APIs that vary by version and shell configuration. The app brings the terminal app to the foreground if it is already running; if no terminal is running it opens a new window with an SSH connection to the project directory.

**Does this work with Claude.ai web or the API?**  
No — it monitors the local file-based session logs written by the Claude Code CLI. It does not hook into the web interface or any API.

**Windows: the pet window is not transparent**  
Transparent frameless windows require hardware-accelerated compositing. On some older GPUs or when running under Remote Desktop / certain VM configurations, transparency may not render correctly. This is an Electron limitation on Windows.

---

## License

MIT
