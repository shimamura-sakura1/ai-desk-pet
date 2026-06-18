const { ipcMain, shell, dialog, app } = require('electron');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { exec } = require('child_process');

// Returns a Set of running process names (without .exe on Windows).
function getRunningProcesses(cb) {
  if (process.platform === 'win32') {
    exec('tasklist /FO CSV /NH', (err, stdout) => {
      if (err) { cb(new Set()); return; }
      const names = new Set(
        stdout.split('\n')
          .map(l => l.split(',')[0]?.replace(/"/g, '').replace(/\.exe$/i, '').trim())
          .filter(Boolean)
      );
      cb(names);
    });
  } else {
    exec('ps -axco command=', (err, stdout) => {
      if (err) { cb(new Set()); return; }
      cb(new Set(stdout.split('\n').map(l => l.trim()).filter(Boolean)));
    });
  }
}

// In a packaged app the asar is read-only; write user config to the OS user-data dir.
// In development (npm start) use the in-repo config/ folder as before.
const APP_ROOT   = path.join(__dirname, '../..');
const PRESET_DIR = path.join(__dirname, '../../config/presets');
const USER_CONFIG_PATH = app.isPackaged
  ? path.join(app.getPath('userData'), 'user.json')
  : path.join(__dirname, '../../config/user.json');

const DEFAULT_USER_CONFIG = {
  activePreset: 'default',
  clipsRootFolder: path.join(APP_ROOT, 'assets/clips'),
  pet:     { activePet: 'default', size: 120 },
  monitor: { localLogDir: '', pollIntervalMs: 2000 },
  board:   { maxSessions: 3 },
  ssh:     [],
};

if (!fs.existsSync(USER_CONFIG_PATH)) {
  fs.mkdirSync(path.dirname(USER_CONFIG_PATH), { recursive: true });
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

// Decode a Claude-encoded project dir name for a remote SSH path.
// Cannot use fs.accessSync (path is remote), so falls back to a greedy
// first-match DFS seeded with the known SSH username.
function decodeRemotePath(encodedDir, username) {
  const parts = encodedDir.replace(/^-/, '').split('-');

  function greedyDFS(items, segs, idx) {
    if (idx === items.length) return segs;
    const a = greedyDFS(items, [...segs, items[idx]], idx + 1);
    if (a) return a;
    if (segs.length > 0) {
      const merged = [...segs.slice(0, -1), segs[segs.length - 1] + '-' + items[idx]];
      return greedyDFS(items, merged, idx + 1);
    }
    return null;
  }

  const prefixes = [['Users', username], ['home', username]];
  if (username === 'root') prefixes.push(['root']);

  for (const prefix of prefixes) {
    if (parts.slice(0, prefix.length).join('-') !== prefix.join('-')) continue;
    const rest = parts.slice(prefix.length);
    if (!rest.length) continue;
    const restDecoded = greedyDFS(rest, [], 0);
    if (restDecoded) return '/' + [...prefix, ...restDecoded].join('/');
  }
  return null;
}

function openSSHInTerminal({ sshCmd }) {
  if (process.platform === 'win32') {
    // Windows: try Windows Terminal, then PowerShell, then cmd
    const q = sshCmd.replace(/"/g, '\\"');
    exec(`wt -- ${sshCmd}`, err => {
      if (err) exec(`powershell.exe -NoExit -Command "${q}"`);
    });
    return;
  }
  // macOS: bring existing terminal to front; only open new window if nothing is running
  getRunningProcesses(procs => {
    if (procs.has('iTerm2') || procs.has('iTerm')) {
      exec(`osascript -e 'tell app "iTerm" to activate'`);
    } else if (procs.has('Terminal')) {
      exec(`osascript -e 'tell app "Terminal" to activate'`);
    } else {
      const tmpScript = path.join(os.tmpdir(), 'ai-desk-pet-ssh.command');
      fs.writeFileSync(tmpScript, `#!/bin/sh\n${sshCmd}\n`, { mode: 0o755 });
      exec(`open "${tmpScript}"`);
    }
  });
}

function setupIPC({ getPetWindow, getBoardWindow, getDebugPetWindow, getStateEditorWindow, createBoardWindow, createDebugPetWindow, createSettingsWindow, createStateEditorWindow, onSSHCredsChanged, onDoneComplete, onReconnectSSH }) {
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
    const ew = getStateEditorWindow?.();
    if (ew && !ew.isDestroyed()) ew.webContents.send('preset-reload');
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

  // Jump to the IDE/app (local) or SSH terminal (remote) for the session's project
  ipcMain.on('open-project', (_e, info) => {
    const filePath  = typeof info === 'string' ? info : info.filePath;
    const source    = typeof info === 'string' ? 'local' : (info.source ?? 'local');
    const sessionId = typeof info === 'string' ? null    : info.sessionId;

    if (source === 'ssh' && sessionId) {
      const colonIdx = sessionId.indexOf(':');
      const host     = sessionId.slice(0, colonIdx);
      const remoteFP = sessionId.slice(colonIdx + 1);

      const creds = readSSHCreds();
      const cred  = creds.find(c => c.host === host);
      if (!cred) return;

      const parts      = remoteFP.split('/');
      const encodedDir = parts[parts.length - 2] ?? '';
      const projectPath = decodeRemotePath(encodedDir, cred.username);

      const portPart = (cred.port && cred.port !== 22) ? ` -p ${cred.port}` : '';
      const sshCmd = projectPath
        ? `ssh -t ${cred.username}@${host}${portPart} "cd '${projectPath.replace(/'/g, "'\\''")}' && exec \\$SHELL"`
        : `ssh ${cred.username}@${host}${portPart}`;

      openSSHInTerminal({ sshCmd });
      return;
    }

    // Local session: try IDE first, fall back to terminal
    const localParts   = filePath.split(path.sep);
    const encodedDir2  = localParts[localParts.length - 2] ?? '';
    const projectPath2 = decodeProjectPath(encodedDir2);
    if (!projectPath2) { shell.showItemInFolder(filePath); return; }

    if (process.platform === 'win32') {
      // Windows: try IDE CLIs, then Windows Terminal, then explorer
      const q = projectPath2.replace(/"/g, '\\"');
      exec(`code "${q}"`, e1 => {
        if (!e1) return;
        exec(`cursor "${q}"`, e2 => {
          if (!e2) return;
          exec(`wt --startingDirectory "${q}"`, e3 => {
            if (!e3) return;
            shell.openPath(projectPath2);
          });
        });
      });
    } else {
      // macOS: prefer running IDE, fall back to Terminal.app
      getRunningProcesses(procs => {
        const ALL_APPS = [
          { proc: 'Code',   app: 'Visual Studio Code' },
          { proc: 'Cursor', app: 'Cursor'              },
        ];
        const running    = ALL_APPS.filter(a => procs.has(a.proc)).map(a => a.app);
        const notRunning = ALL_APPS.filter(a => !procs.has(a.proc)).map(a => a.app);
        const tryApps    = [...running, ...notRunning];

        let tried = 0;
        const attempt = () => {
          if (tried >= tryApps.length) {
            exec(`open -a Terminal "${projectPath2.replace(/"/g, '\\"')}"`);
            return;
          }
          exec(`open -a "${tryApps[tried++]}" "${projectPath2}"`, e => { if (e) attempt(); });
        };
        attempt();
      });
    }
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

  ipcMain.on('pet:done-complete', () => onDoneComplete?.());
  ipcMain.handle('reconnect-ssh', (_e, idx) => onReconnectSSH?.(idx) ?? { ok: false });

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
