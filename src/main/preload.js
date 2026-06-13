const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  onStateChange:    (cb) => ipcRenderer.on('pet:state-change',    (_e, s) => cb(s)),
  onSessionsUpdate: (cb) => ipcRenderer.on('pet:sessions-update', (_e, s) => cb(s)),
  onTokenUpdate:    (cb) => ipcRenderer.on('pet:token-update',    (_e, d) => cb(d)),
  onPresetReload:   (cb) => ipcRenderer.on('preset-reload',       ()      => cb()),
  openSettings:     ()      => ipcRenderer.send('open-settings'),
  toggleBoard:      ()      => ipcRenderer.send('pet:toggle-board'),
  getPreset:        ()      => ipcRenderer.invoke('get-preset'),
  getUserConfig:    ()      => ipcRenderer.invoke('get-user-config'),
  openSessionFile:  (fp)    => ipcRenderer.send('open-session-file', fp),
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
  getConfig:    ()      => ipcRenderer.invoke('get-user-config'),
  saveConfig:   (cfg)   => ipcRenderer.invoke('save-user-config', cfg),
  testSSH:      (cfg)   => ipcRenderer.invoke('test-ssh', cfg),
  selectFolder: ()      => ipcRenderer.invoke('select-folder'),
});
