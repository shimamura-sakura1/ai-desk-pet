const { app, BrowserWindow, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { setupIPC } = require('./ipc');
const LocalMonitor = require('./monitor/local');

let petWindow = null;
let boardWindow = null;
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
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setAlwaysOnTop(true, 'floating');
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
  boardWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  boardWindow.setAlwaysOnTop(true, 'floating');
  boardWindow.loadFile(path.join(__dirname, '../renderer/board/index.html'));
  boardWindow.on('closed', () => { boardWindow = null; });

  // 加载完成后推送当前 session 状态（避免打开时面板为空）
  boardWindow.webContents.once('did-finish-load', () => {
    if (lastSessions.length && boardWindow && !boardWindow.isDestroyed()) {
      boardWindow.webContents.send('pet:sessions-update', lastSessions);
    }
  });
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

app.whenReady().then(() => {
  createPetWindow();
  createTray();

  const { notifyPetState, notifyTokenUpdate, notifySessions } = setupIPC({
    getPetWindow:         () => petWindow,
    getBoardWindow:       () => boardWindow,
    createBoardWindow,
    createSettingsWindow,
    createStateEditorWindow,
  });

  const monitor = new LocalMonitor();
  monitor.on('state',    s  => notifyPetState(s));
  monitor.on('sessions', ss => { lastSessions = ss; notifySessions(ss); });
  monitor.start(2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
