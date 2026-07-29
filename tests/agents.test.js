const { classify, normName } = require('../src/main/monitor/agents');

describe('agent classification', () => {
  test('normName strips .exe and lowercases', () => {
    expect(normName('Claude.exe')).toBe('claude');
    expect(normName('codex')).toBe('codex');
  });

  test('Windows CLI vs Desktop by capitalisation', () => {
    expect([...classify(['claude.exe'], 'win32')]).toEqual(['claude-cli']);
    expect([...classify(['Claude.exe'], 'win32')]).toEqual(['claude-desk']);
    expect([...classify(['codex.exe'], 'win32')]).toEqual(['codex-cli']);
    expect([...classify(['Codex.exe'], 'win32')]).toEqual(['codex-desk']);
  });

  test('macOS CLI vs Desktop by capitalisation', () => {
    expect([...classify(['claude'], 'darwin')]).toEqual(['claude-cli']);
    expect([...classify(['Claude'], 'darwin')]).toEqual(['claude-desk']);
    expect([...classify(['Codex'], 'darwin')]).toEqual(['codex-desk']);
  });

  test('path-based refinement overrides CLI on Windows', () => {
    const names = ['claude.exe'];
    const paths = { claude: 'C:\\Users\\me\\AppData\\Local\\Claude\\Claude.exe' };
    expect([...classify(names, 'win32', paths)]).toEqual(['claude-desk']);
  });

  test('codex CLI path under npm is still CLI', () => {
    const names = ['codex.exe'];
    const paths = { codex: 'C:\\Users\\me\\.npm-global\\node_modules\\.bin\\codex.exe' };
    // node_modules path → not a desktop path → CLI
    expect([...classify(names, 'win32', paths)]).toEqual(['codex-cli']);
  });

  test('multiple agents detected together', () => {
    const set = classify(['claude.exe', 'codex.exe', 'Claude.exe'], 'win32');
    expect(set.has('claude-cli')).toBe(true);
    expect(set.has('claude-desk')).toBe(true);
    expect(set.has('codex-cli')).toBe(true);
  });
});
