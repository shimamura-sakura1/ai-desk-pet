const { ipcMain, shell, dialog } = require('electron');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { exec } = require('child_process');

const USER_CONFIG_PATH = path.join(__dirname, '../../config/user.json');
const PRESET_DIR       = path.join(__dirname, '../../config/presets');
const APP_ROOT         = path.join(__dirname, '../..');

const DEFAULT_USER_CONFIG = {
  activePreset: 'default',
  clipsRootFolder: path.join(APP_ROOT, 'assets/clips'),
  pet:     { activePet: 'default', size: 120 },
  monitor: { localLogDir: '', pollIntervalMs: 2000 },
  board:   { maxSessions: 3 },
  ssh:     [],
};

if (!fs.existsSync(USER_CONFIG_PATH)) {
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(DEFAULT_USER_CONFIG, null, 2));
}

// SSH credentials stored outside the git repo — never committed
const SSH_CREDS_DIR  = path.join(os.homedir(), '.ai-desk-pet');
const SSH_CREDS_PATH = path.join(SSH_CREDS_DIR, 'credentials.json');

function readSSHCreds() {
  try { return JSON.parse(fs.readFileSync(SSH_CREDS_PATH, 'utf8')); } catch { return []; }
}
function writeSSHCreds(creds) {
  if (!fs.existsSync(SSH_CREDS_DIR)) fs.mkdirSync(SSH_CREDS_DIR, { recursive: true });
  fs.writeFileSync(SSH_CREDS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

// Reconstruct an actual filesystem path from a Claude log encoded dir name
// (Claude replaces '/' with '-' when naming project dirs)
function decodeProjectPath(encodedDirName) {
  const parts = encodedDirName.replace(/^-/, '').split('-');

  function dfs(segments, idx) {
    if (idx === parts.length) {
      const p = '/' + segments.join('/');
      try { fs.accessSync(p); return p; } catch { return null; }
    }
    const part = parts[idx];
    // Option A: new path component
    const a = dfs([...segments, part], idx + 1);
    if (a) return a;
    // Option B: hyphen continuation of last component
    if (segments.length > 0) {
      const ext = [...segments.slice(0, -1), segments[segments.length - 1] + '-' + part];
      return dfs(ext, idx + 1);
    }
    return null;
  }

  return dfs([], 0);
}

function setupIPC({ getPetWindow, getBoardWindow, getDebugPetWindow, createBoardWindow, createDebugPetWindow, createSettingsWindow, createStateEditorWindow, onSSHCredsChanged }) {
  ipcMain.on('open-settings',      () => createSettingsWindow());
  ipcMain.on('open-state-editor',  () => createStateEditorWindow());

  ipcMain.on('pet:toggle-board', () => createBoardWindow());

  ipcMain.on('open-debug-pet',  (_e, state) => createDebugPetWindow(state ?? null));
  ipcMain.on('close-debug-pet', () => {
    const dw = getDebugPetWindow?.();
    if (dw && !dw.isDestroyed()) dw.close();
  });
  ipcMain.on('pet:force-clip', (_e, clipId) => {
    const dw = getDebugPetWindow?.();
    if (dw && !dw.isDestroyed()) dw.webContents.send('pet:force-clip', clipId);
  });

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

  ipcMain.handle('select-file', async (_e, opts = {}) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: opts.filters ?? [],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('scan-clips-folder', (_e, folderPath) => {
    try {
      return fs.readdirSync(folderPath, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
    } catch {
      return [];
    }
  });

  ipcMain.handle('test-ssh', async (_e, cfg) => {
    const { Client } = require('ssh2');
    return new Promise(resolve => {
      const c = new Client();
      c.on('ready', () => { c.end(); resolve({ ok: true }); });
      c.on('error', err => resolve({ ok: false, error: err.message }));
      const opts = { host: cfg.host, port: cfg.port ?? 22, username: cfg.username };
      if (cfg.authType === 'key' && cfg.keyPath) {
        try { opts.privateKey = fs.readFileSync(cfg.keyPath); } catch (e) {
          return resolve({ ok: false, error: `无法读取密钥文件: ${e.message}` });
        }
        if (cfg.passphrase) opts.passphrase = cfg.passphrase;
      } else {
        opts.password = cfg.password ?? '';
      }
      c.connect(opts);
    });
  });

  // SSH credentials — stored in ~/.ai-desk-pet/credentials.json (outside git)
  ipcMain.handle('get-ssh-creds', () => readSSHCreds());
  ipcMain.handle('save-ssh-creds', (_e, creds) => {
    writeSSHCreds(creds);
    onSSHCredsChanged?.();
    return true;
  });

  ipcMain.on('open-session-file', (_e, filePath) => {
    shell.showItemInFolder(filePath);
  });

  // Jump to the IDE/app that owns the session's project
  ipcMain.on('open-project', (_e, filePath) => {
    const parts       = filePath.split(path.sep);
    const encodedDir  = parts[parts.length - 2] ?? '';
    const projectPath = decodeProjectPath(encodedDir);
    if (!projectPath) { shell.showItemInFolder(filePath); return; }

    // Detect which IDEs are currently running, prefer those
    exec('ps -axco command=', (err, stdout) => {
      const procs = new Set(stdout.split('\n').map(l => l.trim()));
      const ALL_APPS = [
        { proc: 'Code',   app: 'Visual Studio Code' },
        { proc: 'Cursor', app: 'Cursor'              },
      ];
      const running    = ALL_APPS.filter(a => procs.has(a.proc)).map(a => a.app);
      const notRunning = ALL_APPS.filter(a => !procs.has(a.proc)).map(a => a.app);
      const tryApps    = [...running, ...notRunning];

      let tried = 0;
      const attempt = () => {
        if (tried >= tryApps.length) { shell.openPath(projectPath); return; }
        exec(`open -a "${tryApps[tried++]}" "${projectPath}"`, e => { if (e) attempt(); });
      };
      attempt();
    });
  });

  ipcMain.on('board:resize', (_e, h) => {
    const bw = getBoardWindow();
    if (!bw || bw.isDestroyed()) return;
    const [x, y] = bw.getPosition();
    const { width: sw } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const safeX = Math.max(0, Math.min(x, sw - 400 - 10));
    bw.setBounds({ x: safeX, y, width: 400, height: Math.round(h) }, true);
  });

  ipcMain.on('pet:force-state', (_e, state) => {
    const dw = getDebugPetWindow?.();
    if (dw && !dw.isDestroyed()) dw.webContents.send('pet:force-state', state);
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
