'use strict';

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  shell:   { openPath: jest.fn(), showItemInFolder: jest.fn() },
  dialog:  { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
  app:     { isPackaged: false, getPath: jest.fn(() => '/tmp/userdata') },
}));

const fs = {
  existsSync:    jest.fn().mockReturnValue(false),
  writeFileSync: jest.fn(),
  readFileSync:  jest.fn((p) => {
    if (String(p).includes('user.json')) {
      return JSON.stringify({ activePreset: 'default', pet: { activePet: 'default' } });
    }
    return '{}';
  }),
  readdirSync:   jest.fn().mockReturnValue([]),
  mkdirSync:     jest.fn(),
  accessSync:    jest.fn(),
};
jest.doMock('fs', () => fs);

const ipc = require('../src/main/ipc');
const electron = require('electron');

// Capture handlers registered by setupIPC
const handlers = {};
electron.ipcMain.handle.mockImplementation((name, fn) => { handlers[name] = fn; });

const petWin = { webContents: { send: jest.fn() }, isDestroyed: () => false };
const editorWin = { webContents: { send: jest.fn() }, isDestroyed: () => false };
ipc.setupIPC({
  getPetWindow:         () => petWin,
  getStateEditorWindow: () => editorWin,
});

const FRAME = 'data:image/png;base64,AAAA';
const rowOf = (state) => ({
  state,
  frames: Array.from({ length: 7 }, () => FRAME),
});

describe('import-character handler', () => {
  test('writes frames + preset, switches active preset, reloads pet & editor', async () => {
    fs.writeFileSync.mockClear();   // ignore the module-load default user.json write
    const res = await handlers['import-character'](null, {
      name: 'testpet',
      rows: [rowOf('idle'), rowOf('idle'), rowOf('working')],
    });
    expect(res.ok).toBe(true);

    // Preset JSON written into userData presets dir
    const presetCall = fs.writeFileSync.mock.calls.find(([p]) => String(p).endsWith('testpet.json'));
    expect(presetCall).toBeDefined();
    const preset = JSON.parse(presetCall[1]);
    expect(preset.clipDefs).toHaveProperty('idle');
    expect(preset.clipDefs).toHaveProperty('idle-2');   // duplicate state → suffixed id
    expect(preset.clipDefs).toHaveProperty('working');
    expect(preset.clipDefs.idle).toMatchObject({ fps: 2.78, threePhase: true });
    expect(preset.states.idle.clips).toEqual(['idle', 'idle-2']);
    expect(preset.states.working.clips).toEqual(['working']);
    expect(preset.clipsRootFolder).toContain('testpet');
    expect(preset.rootClipIds).toEqual(['idle', 'idle-2', 'working']);

    // 3 rows × 7 frames = 21 PNGs written
    const frameWrites = fs.writeFileSync.mock.calls.filter(([p]) => String(p).endsWith('.png'));
    expect(frameWrites).toHaveLength(21);
    frameWrites.forEach(([p]) => expect(p).toContain('testpet'));

    // user config updated with new active preset
    const userCall = fs.writeFileSync.mock.calls.find(([p]) => String(p).endsWith('user.json'));
    const cfg = JSON.parse(userCall[1]);
    expect(cfg.activePreset).toBe('testpet');
    expect(cfg.pet.activePet).toBe('testpet');

    // Reload signals sent
    expect(petWin.webContents.send).toHaveBeenCalledWith('preset-reload');
    expect(editorWin.webContents.send).toHaveBeenCalledWith('preset-reload');
  });

  test('rejects invalid (non-ASCII) name', async () => {
    const res = await handlers['import-character'](null, { name: '坏name', rows: [rowOf('idle')] });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/字母|数字|连字符/);
  });

  test('rejects empty rows', async () => {
    const res = await handlers['import-character'](null, { name: 'x', rows: [] });
    expect(res.ok).toBe(false);
  });

  test('skips rows with no frames', async () => {
    const res = await handlers['import-character'](null, {
      name: 'y',
      rows: [rowOf('idle'), { state: 'bored', frames: [] }],
    });
    expect(res.ok).toBe(true);
    const presetCall = fs.writeFileSync.mock.calls.find(([p]) => String(p).endsWith('y.json'));
    const preset = JSON.parse(presetCall[1]);
    expect(preset.clipDefs).toHaveProperty('idle');
    expect(preset.clipDefs).not.toHaveProperty('bored');
  });
});

describe('buildCharacterPreset (pure)', () => {
  test('has required engine fields with sensible defaults', () => {
    const p = ipc.buildCharacterPreset('n', [rowOf('idle')], '/pets/n');
    expect(p.version).toBe(1);
    expect(p.clipDefs.idle).toMatchObject({ fps: 2.78, threePhase: true });
    expect(p.transitions).toEqual([]);
    expect(p.rootClipIds).toEqual(['idle']);
    expect(p.layout.idle).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });
});

describe('resolvePresetPath', () => {
  test('prefers userData override over shipped config/presets', () => {
    const orig = fs.existsSync.getMockImplementation();
    fs.existsSync = jest.fn((p) => String(p).includes('userdata') && String(p).includes('custom.json'));
    const p = ipc.resolvePresetPath('custom');
    expect(p).toContain('userdata');
    fs.existsSync = orig || jest.fn().mockReturnValue(false);
  });
});
