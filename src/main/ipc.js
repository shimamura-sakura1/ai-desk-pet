const { ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const USER_CONFIG_PATH = path.join(__dirname, '../../config/user.json');
const PRESET_DIR       = path.join(__dirname, '../../config/presets');
const APP_ROOT         = path.join(__dirname, '../..');

function setupIPC({ getPetWindow, getBoardWindow, createBoardWindow, createSettingsWindow, createStateEditorWindow }) {
  ipcMain.on('open-settings',      () => createSettingsWindow());
  ipcMain.on('open-state-editor',  () => createStateEditorWindow());

  ipcMain.on('pet:toggle-board', () => createBoardWindow());

  ipcMain.handle('get-user-config', () =>
    JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8')));

  ipcMain.handle('save-user-config', (_e, cfg) => {
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(cfg, null, 2));
    return true;
  });

  ipcMain.handle('get-preset', () => {
    const cfg        = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'));
    const name       = cfg.activePreset ?? 'default';
    const presetPath = path.join(PRESET_DIR, `${name}.json`);
    const preset     = JSON.parse(fs.readFileSync(presetPath, 'utf8'));

    // Resolve each clipDef folder → sorted file:// frame URLs
    const resolvedClips = {};
    for (const [id, def] of Object.entries(preset.clipDefs)) {
      const folder = path.resolve(APP_ROOT, def.folder);
      let frames = [];
      try {
        frames = fs.readdirSync(folder)
          .filter(f => /\.(png|jpg|gif)$/i.test(f))
          .sort()
          .map(f => `file://${path.join(folder, f)}`);
      } catch {}
      resolvedClips[id] = { ...def, frames };
    }
    return { ...preset, resolvedClips };
  });

  ipcMain.handle('save-preset', (_e, presetData) => {
    const cfg  = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'));
    const name = cfg.activePreset ?? 'default';
    fs.writeFileSync(path.join(PRESET_DIR, `${name}.json`), JSON.stringify(presetData, null, 2));
    return true;
  });

  ipcMain.handle('export-preset', async (_e, data) => {
    const result = await dialog.showSaveDialog({
      defaultPath: 'preset.json',
      filters: [{ name: 'Preset JSON', extensions: ['json'] }],
    });
    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return true;
  });

  ipcMain.handle('import-preset', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Preset JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled) return null;
    try { return JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')); } catch { return null; }
  });

  ipcMain.on('apply-preset', () => {
    const pw = getPetWindow();
    if (pw && !pw.isDestroyed()) pw.webContents.send('preset-reload');
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('test-ssh', async (_e, cfg) => {
    const { Client } = require('ssh2');
    return new Promise(resolve => {
      const c = new Client();
      c.on('ready', () => { c.end(); resolve({ ok: true }); });
      c.on('error', err => resolve({ ok: false, error: err.message }));
      c.connect({ host: cfg.host, port: cfg.port ?? 22, username: cfg.username, password: cfg.password });
    });
  });

  ipcMain.on('open-session-file', (_e, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.on('board:resize', (_e, h) => {
    const bw = getBoardWindow();
    if (!bw || bw.isDestroyed()) return;
    const [x, y] = bw.getPosition();
    const { width: sw } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const safeX = Math.max(0, Math.min(x, sw - 400 - 10));
    bw.setBounds({ x: safeX, y, width: 400, height: Math.round(h) }, true);
  });

  ipcMain.on('pet:move', (_e, { x, y }) => {
    const win = getPetWindow();
    if (win) win.setPosition(Math.round(x), Math.round(y));
  });

  function notifyWindow(win, channel, data) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  }

  function notifyPetState(state) {
    notifyWindow(getPetWindow(), 'pet:state-change', state);
  }

  function notifyTokenUpdate(data) {
    notifyWindow(getPetWindow(), 'pet:token-update', data);
  }

  function notifySessions(sessions) {
    notifyWindow(getPetWindow(),   'pet:sessions-update', sessions);
    notifyWindow(getBoardWindow(), 'pet:sessions-update', sessions);

    const bw = getBoardWindow();
    if (bw && !bw.isDestroyed()) {
      let maxSessions = 3;
      try {
        const cfg = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'));
        maxSessions = cfg?.board?.maxSessions ?? 3;
      } catch {}
      const { width: sw } = require('electron').screen.getPrimaryDisplay().workAreaSize;
      const count = Math.min(maxSessions, sessions.length);
      const h = count > 0 ? Math.min(520, count * 48 + (count - 1) * 6 + 16) : 72;
      const [x, y] = bw.getPosition();
      const safeX = Math.max(0, Math.min(x, sw - 400 - 10));
      bw.setBounds({ x: safeX, y, width: 400, height: h }, true);
    }
  }

  return { notifyPetState, notifyTokenUpdate, notifySessions };
}

module.exports = { setupIPC };
