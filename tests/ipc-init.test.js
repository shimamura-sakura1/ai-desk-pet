'use strict';

// Mock electron before any require — must be hoisted
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  shell:   { openPath: jest.fn(), showItemInFolder: jest.fn() },
  dialog:  { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
}));

// ── helpers ─────────────────────────────────────────────────────

function makeFs(existsResult) {
  return {
    existsSync:   jest.fn().mockReturnValue(existsResult),
    writeFileSync: jest.fn(),
    readFileSync:  jest.fn(),
    readdirSync:   jest.fn().mockReturnValue([]),
    mkdirSync:     jest.fn(),
    accessSync:    jest.fn(),
  };
}

function loadIpc(fsMock) {
  jest.doMock('fs', () => fsMock);
  return require('../src/main/ipc');
}

// ── tests ────────────────────────────────────────────────────────

describe('ipc: user.json 初始化', () => {
  beforeEach(() => jest.resetModules());

  test('文件不存在时 — 自动创建含默认值的 user.json', () => {
    const fsMock = makeFs(false);
    loadIpc(fsMock);

    const call = fsMock.writeFileSync.mock.calls.find(([p]) =>
      String(p).endsWith('user.json'),
    );
    expect(call).toBeDefined();

    const cfg = JSON.parse(call[1]);
    expect(cfg.activePreset).toBe('default');
    expect(cfg.clipsRootFolder).toMatch(/assets[/\\]clips/);
    expect(cfg.pet).toMatchObject({ activePet: 'default', size: 120 });
    expect(cfg.monitor).toMatchObject({ pollIntervalMs: 2000 });
    expect(cfg.board).toMatchObject({ maxSessions: 3 });
    expect(Array.isArray(cfg.ssh)).toBe(true);
  });

  test('文件已存在时 — 不覆盖 user.json', () => {
    const fsMock = makeFs(true);
    loadIpc(fsMock);

    const userJsonWrites = fsMock.writeFileSync.mock.calls.filter(([p]) =>
      String(p).endsWith('user.json'),
    );
    expect(userJsonWrites).toHaveLength(0);
  });

  test('默认 clipsRootFolder 指向项目内 assets/clips', () => {
    const fsMock = makeFs(false);
    loadIpc(fsMock);

    const call = fsMock.writeFileSync.mock.calls.find(([p]) =>
      String(p).endsWith('user.json'),
    );
    const cfg = JSON.parse(call[1]);
    // 必须是绝对路径，且以 assets/clips 结尾
    expect(cfg.clipsRootFolder).toMatch(/[/\\]assets[/\\]clips$/);
  });

  test('导出 setupIPC 函数', () => {
    const fsMock = makeFs(true);
    const mod = loadIpc(fsMock);
    expect(typeof mod.setupIPC).toBe('function');
  });
});
