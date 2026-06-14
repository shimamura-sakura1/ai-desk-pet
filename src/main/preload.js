const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  onStateChange:    (cb) => ipcRenderer.on('pet:state-change',    (_e, s) => cb(s)),
  onSessionsUpdate: (cb) => ipcRenderer.on('pet:sessions-update', (_e, s) => cb(s)),
  onTokenUpdate:    (cb) => ipcRenderer.on('pet:token-update',    (_e, d) => cb(d)),
  onPresetReload:   (cb) => ipcRenderer.on('preset-reload',       ()      => cb()),
  onForceState:     (cb) => ipcRenderer.on('pet:force-state',     (_e, s) => cb(s)),
  onForceClip:      (cb) => ipcRenderer.on('pet:force-clip',      (_e, id) => cb(id)),
  onInitDebug:      (cb) => ipcRenderer.on('pet:init-debug',      () => cb()),
  forceState:       (s)  => ipcRenderer.send('pet:force-state', s),
  forceClip:        (id) => ipcRenderer.send('pet:force-clip', id),
  openDebugPet:     (s)  => ipcRenderer.send('open-debug-pet', s ?? null),
  closeDebugPet:    ()   => ipcRenderer.send('close-debug-pet'),
  openSettings:     ()      => ipcRenderer.send('open-settings'),
  toggleBoard:      ()      => ipcRenderer.send('pet:toggle-board'),
  getPreset:        ()      => ipcRenderer.invoke('get-preset'),
  getUserConfig:    ()      => ipcRenderer.invoke('get-user-config'),
  openSessionFile:  (fp)    => ipcRenderer.send('open-session-file', fp),
  openProject:      (fp)    => ipcRenderer.send('open-project', fp),
  boardResize:      (h)     => ipcRenderer.send('board:resize', h),
  moveTo:           (x, y)  => ipcRenderer.send('pet:move', { x, y }),
  // Preset management (used by state editor)
  savePreset:       (data)  => ipcRenderer.invoke('save-preset', data),
  exportPreset:     (data)  => ipcRenderer.invoke('export-preset', data),
  importPreset:     ()      => ipcRenderer.invoke('import-preset'),
  applyPreset:      ()      => ipcRenderer.send('apply-preset'),
  selectFolder:     ()      => ipcRenderer.invoke('select-folder'),
  openStateEditor:  ()      => ipcRenderer.send('open-state-editor'),
});

contextBridge.exposeInMainWorld('settingsBridge', {
  getConfig:        ()        => ipcRenderer.invoke('get-user-config'),
  saveConfig:       (cfg)     => ipcRenderer.invoke('save-user-config', cfg),
  testSSH:          (cfg)     => ipcRenderer.invoke('test-ssh', cfg),
  selectFolder:     ()        => ipcRenderer.invoke('select-folder'),
  scanClipsFolder:  (path)    => ipcRenderer.invoke('scan-clips-folder', path),
  getPreset:        ()        => ipcRenderer.invoke('get-preset'),
  savePreset:       (data)    => ipcRenderer.invoke('save-preset', data),
  getSSHCreds:      ()        => ipcRenderer.invoke('get-ssh-creds'),
  saveSSHCreds:     (creds)   => ipcRenderer.invoke('save-ssh-creds', creds),
  selectFile:       (opts)    => ipcRenderer.invoke('select-file', opts),
});
