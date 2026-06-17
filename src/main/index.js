const { app, BrowserWindow, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { setupIPC } = require('./ipc');
const LocalMonitor = require('./monitor/local');
const SSHMonitor   = require('./monitor/ssh');

const SSH_CREDS_PATH = path.join(os.homedir(), '.ai-desk-pet', 'credentials.json');

let petWindow = null;
let boardWindow = null;
let debugPetWindow = null;
let settingsWindow = null;
let stateEditorWindow = null;
let tray = null;
let lastSessions = [];

function createPetWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  petWindow = new BrowserWindow({
    width: 219,
    height: 155,
    x: width - 240,
    y: height - 185,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (process.platform === 'darwin') {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    petWindow.setAlwaysOnTop(true, 'floating');
  } else {
    petWindow.setAlwaysOnTop(true);
  }
  petWindow.loadFile(path.join(__dirname, '../renderer/pet/index.html'));
}

function createBoardWindow() {
  if (boardWindow && !boardWindow.isDestroyed()) {
    boardWindow.close();
    boardWindow = null;
    return;
  }
  const [px, py] = petWindow.getPosition();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const boardW = 400, boardH = 200;
  let bx = px - 91;
  let by = py - boardH - 10;
  if (by < 0) by = py + 155 + 10;   // 如果上方空间不足就放在宠物下方
  bx = Math.max(0, Math.min(bx, sw - boardW - 10));
  by = Math.max(0, Math.min(by, sh - boardH));

  boardWindow = new BrowserWindow({
    width: boardW,
    height: boardH,
    x: bx,
    y: by,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (process.platform === 'darwin') {
    boardWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    boardWindow.setAlwaysOnTop(true, 'floating');
  } else {
    boardWindow.setAlwaysOnTop(true);
  }
  boardWindow.loadFile(path.join(__dirname, '../renderer/board/index.html'));
  boardWindow.on('closed', () => { boardWindow = null; });

  // 加载完成后推送当前 session 状态（避免打开时面板为空）
  boardWindow.webContents.once('did-finish-load', () => {
    if (lastSessions.length && boardWindow && !boardWindow.isDestroyed()) {
      boardWindow.webContents.send('pet:sessions-update', lastSessions);
    }
  });
}

function createDebugPetWindow(pendingState = null) {
  if (debugPetWindow && !debugPetWindow.isDestroyed()) {
    if (pendingState) debugPetWindow.webContents.send('pet:force-state', pendingState);
    debugPetWindow.focus();
    return;
  }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  debugPetWindow = new BrowserWindow({
    width: 219,
    height: 180,
    x: Math.max(0, width - 480),
    y: height - 210,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (process.platform === 'darwin') {
    debugPetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    debugPetWindow.setAlwaysOnTop(true, 'floating');
  } else {
    debugPetWindow.setAlwaysOnTop(true);
  }
  debugPetWindow.loadFile(path.join(__dirname, '../renderer/pet/index.html'), { hash: 'debug' });
  debugPetWindow.webContents.once('did-finish-load', () => {
    if (!debugPetWindow || debugPetWindow.isDestroyed()) return;
    debugPetWindow.webContents.send('pet:init-debug');
    if (pendingState) debugPetWindow.webContents.send('pet:force-state', pendingState);
  });
  debugPetWindow.on('closed', () => { debugPetWindow = null; });
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, '../../frames/row_3_frame_4.png'))
    .resize({ width: 18, height: 18 });

  tray = new Tray(icon);
  tray.setToolTip('桌宠');

  const menu = Menu.buildFromTemplate([
    { label: '设置', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createSettingsWindow() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 720, height: 540,
    title: '桌宠设置',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings/index.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createStateEditorWindow() {
  if (stateEditorWindow && !stateEditorWindow.isDestroyed()) {
    stateEditorWindow.focus();
    return;
  }
  stateEditorWindow = new BrowserWindow({
    width: 920, height: 640,
    title: 'State Process Editor',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  stateEditorWindow.loadFile(path.join(__dirname, '../renderer/state-editor/index.html'));
  stateEditorWindow.on('closed', () => { stateEditorWindow = null; });
}

// If the user has a clipsRootFolder configured but the preset doesn't reflect it
// (e.g. after default.json was reset), scan and apply it automatically.
function autoRestoreClips() {
  try {
    const USER_CONFIG = path.join(__dirname, '../../config/user.json');
    const PRESET_DIR  = path.join(__dirname, '../../config/presets');
    const cfg    = JSON.parse(fs.readFileSync(USER_CONFIG, 'utf8'));
    const folder = cfg.clipsRootFolder;
    if (!folder) return;

    const presetName = cfg.activePreset ?? 'default';
    const presetPath = path.join(PRESET_DIR, `${presetName}.json`);
    const preset     = JSON.parse(fs.readFileSync(presetPath, 'utf8'));

    // Already matches — nothing to do
    if (preset.clipsRootFolder === folder) return;

    // Scan subdirs
    const subdirs = fs.readdirSync(folder, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name).sort();

    function mapState(name) {
      const l = name.toLowerCase();
      if (l === 'idle'      || l.startsWith('idle-'))      return 'idle';
      if (l === 'drag'      || l.startsWith('drag-'))      return 'drag';
      if (l === 'working'   || l.startsWith('working-'))   return 'working';
      if (l === 'done'      || l.startsWith('done-'))      return 'done';
      if (l === 'bored'     || l.startsWith('bored-'))     return 'bored';
      if (l === 'attention' || l.startsWith('attention-')) return 'attention';
      return null;
    }

    const newClipDefs = {};
    const stateClips  = {};
    for (const name of subdirs) {
      const state = mapState(name);
      newClipDefs[name] = { folder: `${folder}/${name}`, fps: 2.78, threePhase: true };
      if (state) (stateClips[state] = stateClips[state] ?? []).push(name);
    }
    if (!Object.keys(newClipDefs).length) return;

    preset.clipDefs        = newClipDefs;
    preset.rootClipIds     = Object.keys(newClipDefs);
    preset.clipsRootFolder = folder;
    for (const state of Object.keys(preset.states ?? {})) {
      preset.states[state].clips = stateClips[state] ?? [];
    }

    fs.writeFileSync(presetPath, JSON.stringify(preset, null, 2));
    console.log(`[clips] Auto-restored clips from ${folder}`);
  } catch (e) {
    console.warn('[clips] Auto-restore skipped:', e.message);
  }
}

app.whenReady().then(() => {
  createPetWindow();
  createTray();

  let _sshMonitors = [];

  function stopSSHMonitors() {
    for (const m of _sshMonitors) { try { m.disconnect(); } catch {} }
    _sshMonitors = [];
  }

  function startSSHMonitors() {
    let creds = [];
    try { creds = JSON.parse(fs.readFileSync(SSH_CREDS_PATH, 'utf8')); } catch {}
    for (const cred of creds) {
      const id = `ssh:${cred.host}:${cred.port ?? 22}`;
      const m  = new SSHMonitor(cred);
      _sshMonitors.push(m);
      m.on('sessions',     ss  => onMonitorUpdate(id, ss));
      m.on('disconnected', ()  => { _allSessions.delete(id); onMonitorUpdate(id, []); });
      m.on('error',        err => console.warn(`SSH [${cred.name || cred.host}]: ${err}`));
      m.connect();
    }
  }

  const { notifyPetState, notifyTokenUpdate, notifySessions } = setupIPC({
    getPetWindow:         () => petWindow,
    getBoardWindow:       () => boardWindow,
    getDebugPetWindow:    () => debugPetWindow,
    createBoardWindow,
    createDebugPetWindow,
    createSettingsWindow,
    createStateEditorWindow,
    getStateEditorWindow: () => stateEditorWindow,
    onDoneComplete: () => monitor.clearReplied(),
    onReconnectSSH: (idx) => {
      const creds = [];
      try { creds.push(...JSON.parse(fs.readFileSync(SSH_CREDS_PATH, 'utf8'))); } catch {}
      const cred = creds[idx];
      if (!cred) return Promise.resolve({ ok: false, error: '凭据不存在' });
      const old = _sshMonitors[idx];
      if (old) { try { old.disconnect(); } catch {} }
      const id = `ssh:${cred.host}:${cred.port ?? 22}`;
      const m = new SSHMonitor(cred);
      _sshMonitors[idx] = m;
      m.on('sessions',     ss  => onMonitorUpdate(id, ss));
      m.on('disconnected', ()  => { _allSessions.delete(id); onMonitorUpdate(id, []); });
      m.on('error',        err => console.warn(`SSH [${cred.name || cred.host}]: ${err}`));
      return new Promise(resolve => {
        const done = result => { clearTimeout(timer); resolve(result); };
        const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), 5000);
        m.once('connected', () => done({ ok: true }));
        m.once('error', err  => done({ ok: false, error: err }));
        m.connect();
      });
    },
    onSSHCredsChanged: () => {
      // Clear stale SSH sessions from board, then reconnect with new creds
      for (const key of [..._allSessions.keys()]) {
        if (key.startsWith('ssh:')) _allSessions.delete(key);
      }
      onMonitorUpdate('_flush', []);
      stopSSHMonitors();
      startSSHMonitors();
    },
  });

  // ── Session aggregation (local + SSH) ───────────────────────
  const _allSessions = new Map(); // monitorId → sessions[]
  let _prevGlobal = 'sleep';
  let _boardAutoOpened = false;

  function onMonitorUpdate(monitorId, sessions) {
    _allSessions.set(monitorId, sessions);
    const all = Array.from(_allSessions.values()).flat();
    lastSessions = all;
    notifySessions(all);

    // Recompute global state from merged sessions
    const states = all.map(s => s.state);
    let global = 'sleep';
    if (states.some(s => s === 'require_action' || s === 'alert'))   global = 'require_action';
    else if (states.some(s => s === 'act' || s === 'thinking'))      global = 'act';
    else if (states.some(s => s === 'replied' || s === 'success'))   global = 'success';
    notifyPetState(global);

    // Auto-open board when first entering attention or done state
    const enteringAlert = global === 'require_action' && _prevGlobal !== 'require_action';
    const enteringDone  = global === 'success'        && _prevGlobal !== 'success' && _prevGlobal !== 'require_action';
    if (enteringAlert || enteringDone) {
      if (!boardWindow || boardWindow.isDestroyed()) {
        createBoardWindow();
        _boardAutoOpened = true;
      }
    }

    // Auto-close board when all sessions return to sleep (if we auto-opened it)
    if (global === 'sleep' && _prevGlobal !== 'sleep' && _boardAutoOpened) {
      if (boardWindow && !boardWindow.isDestroyed()) {
        boardWindow.close();
        boardWindow = null;
      }
      _boardAutoOpened = false;
    }

    _prevGlobal = global;
  }

  // Auto-restore user's clip root if preset was reset to defaults
  autoRestoreClips();

  // Local monitor
  const monitor = new LocalMonitor();
  monitor.on('sessions', ss => onMonitorUpdate('local', ss));
  monitor.start(2000);

  // SSH monitors — started here and dynamically via onSSHCredsChanged
  startSSHMonitors();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS and Windows: keep running via tray. Linux: quit.
  if (process.platform === 'linux') app.quit();
});
