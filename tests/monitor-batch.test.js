'use strict';

// Mock fs / child_process so LocalMonitor never touches the real filesystem
jest.mock('fs', () => ({
  statSync:    jest.fn(() => ({ size: 0, birthtimeMs: 0, mtimeMs: 0 })),
  readdirSync: jest.fn(() => []),
  readFileSync: jest.fn(() => ''),
  openSync:    jest.fn(() => 1),
  readSync:    jest.fn(() => 0),
  closeSync:   jest.fn(),
  existsSync:  jest.fn(() => false),
}));
jest.mock('child_process', () => ({ exec: jest.fn() }));

const LocalMonitor = require('../src/main/monitor/local');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides) {
  return {
    id: 'sess-1', name: 'test', project: 'test', filePath: '/test.jsonl',
    state: 'act', lastMessage: 'Running…',
    inactivityTimer: null, _batchPermTimer: null, _batchPermTimerId: 0,
    createdAt: 0, lastActiveAt: 0, messageCount: 0,
    ...overrides,
  };
}

function toolUseEntry(ts) {
  return JSON.stringify({
    type:      'assistant',
    timestamp: ts,
    message:   { content: [{ type: 'tool_use', name: 'Bash', id: 'tu-1' }] },
  });
}

function toolResultEntry(ts) {
  return JSON.stringify({
    type:          'user',
    timestamp:     ts,
    toolUseResult: { stdout: 'ok', stderr: '', interrupted: false },
    message:       { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }] },
  });
}

function chunk(...lines) {
  return lines.join('\n');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LocalMonitor: Claude Code 批写入检测', () => {
  let monitor;
  let emittedStates;

  beforeEach(() => {
    jest.useFakeTimers();
    monitor = new LocalMonitor();
    emittedStates = [];
    monitor.on('sessions', sessions => {
      emittedStates.push(sessions.map(s => s.state));
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── 核心 bug 场景 ──────────────────────────────────────────────

  test('同 chunk 内 gap≥3s → 先 emit require_action，1.5s 后 emit act', () => {
    const session = makeSession({ state: 'sleep' });
    monitor._sessions.set('/test.jsonl', session);

    // tool_use 在 17:45:08，tool_result 在 17:45:20（12 秒差）
    const c = chunk(
      toolUseEntry  ('2026-06-15T00:00:00.000Z'),
      toolResultEntry('2026-06-15T00:00:12.000Z'),
    );
    monitor._parseChunk(c, session);

    // 立即应该 emit require_action（橙色）
    expect(emittedStates).toHaveLength(1);
    expect(emittedStates[0]).toContain('require_action');
    expect(session.state).toBe('require_action');

    // 1.5s 后 emit act（蓝色）
    jest.advanceTimersByTime(1500);
    expect(emittedStates).toHaveLength(2);
    expect(emittedStates[1]).toContain('act');
    expect(session.state).toBe('act');
  });

  test('同 chunk 内 gap<3s（自动审批）→ 直接 emit act，不展示 require_action', () => {
    const session = makeSession({ state: 'sleep' });
    monitor._sessions.set('/test.jsonl', session);

    // gap = 500ms → 自动审批，不触发橙色
    const c = chunk(
      toolUseEntry  ('2026-06-15T00:00:00.000Z'),
      toolResultEntry('2026-06-15T00:00:00.500Z'),
    );
    monitor._parseChunk(c, session);

    expect(emittedStates).toHaveLength(1);
    expect(emittedStates[0]).not.toContain('require_action');
    expect(emittedStates[0]).toContain('act');

    // 1.5s 后不应再发消息
    jest.advanceTimersByTime(1500);
    expect(emittedStates).toHaveLength(1);
  });

  test('tool_use 单独在 chunk → 1s 防抖后 emit require_action（auto mode 时会被取消）', () => {
    const session = makeSession({ state: 'act' });
    monitor._sessions.set('/test.jsonl', session);

    monitor._parseChunk(toolUseEntry('2026-06-15T00:00:00.000Z'), session);

    // 不立即触发（防抖 1s）
    expect(emittedStates).toHaveLength(0);
    expect(session.state).toBe('act');

    // 999ms 内仍未触发
    jest.advanceTimersByTime(999);
    expect(emittedStates).toHaveLength(0);

    // 1s 后触发
    jest.advanceTimersByTime(1);
    expect(emittedStates).toHaveLength(1);
    expect(emittedStates[0]).toContain('require_action');
    expect(session.state).toBe('require_action');
  });

  test('tool_result 单独在下一个 chunk → 从 require_action 变 act', () => {
    const session = makeSession({ state: 'require_action', lastMessage: 'Claude needs your permission' });
    monitor._sessions.set('/test.jsonl', session);

    monitor._parseChunk(toolResultEntry('2026-06-15T00:00:12.000Z'), session);

    expect(emittedStates).toHaveLength(1);
    expect(emittedStates[0]).toContain('act');
    expect(session.state).toBe('act');
  });

  // ── 计时器隔离 ─────────────────────────────────────────────────

  test('新 chunk 到达后旧批写计时器不覆盖新状态', () => {
    const session = makeSession({ state: 'sleep' });
    monitor._sessions.set('/test.jsonl', session);

    // 批写入 → require_action + 1.5s timer
    monitor._parseChunk(
      chunk(
        toolUseEntry  ('2026-06-15T00:00:00.000Z'),
        toolResultEntry('2026-06-15T00:00:10.000Z'),
      ),
      session,
    );
    expect(session.state).toBe('require_action');

    // 新 chunk 到来（用户发了新消息）→ state 变 thinking
    const userMsg = JSON.stringify({
      type: 'user',
      timestamp: '2026-06-15T00:00:01.000Z',
      message: { content: 'next task' },
    });
    monitor._parseChunk(userMsg, session);
    expect(session.state).toBe('thinking');

    // 1.5s 后旧计时器不应把 thinking 覆盖为 act
    jest.advanceTimersByTime(1500);
    expect(session.state).toBe('thinking');
  });

  test('连续两次批写入 → 只有最新计时器生效', () => {
    const session = makeSession({ state: 'sleep' });
    monitor._sessions.set('/test.jsonl', session);

    const batchChunk = chunk(
      toolUseEntry  ('2026-06-15T00:00:00.000Z'),
      toolResultEntry('2026-06-15T00:00:10.000Z'),
    );

    // 第一次批写入
    monitor._parseChunk(batchChunk, session);
    expect(emittedStates[0]).toContain('require_action');

    // 立即又来一次批写入（第一个计时器应被取消）
    monitor._parseChunk(batchChunk, session);
    const emitCountBefore = emittedStates.length;

    jest.advanceTimersByTime(1500);
    // 只有一次 act（而非两次）
    expect(emittedStates.length).toBe(emitCountBefore + 1);
    expect(emittedStates[emittedStates.length - 1]).toContain('act');
  });

  // ── gap 边界值 ──────────────────────────────────────────────────

  test.each([
    ['恰好 3000ms',  3000, true ],
    ['2999ms',       2999, false],
    ['大 gap 78s',  78000, true ],
  ])('gap = %s → batchDetected=%s', (_label, gapMs, expectBatch) => {
    const session = makeSession({ state: 'sleep' });
    monitor._sessions.set('/test.jsonl', session);

    const t0 = new Date('2026-06-15T00:00:00.000Z').getTime();
    const t1 = new Date(t0 + gapMs).toISOString();

    monitor._parseChunk(
      chunk(toolUseEntry('2026-06-15T00:00:00.000Z'), toolResultEntry(t1)),
      session,
    );

    if (expectBatch) {
      expect(emittedStates[0]).toContain('require_action');
    } else {
      expect(emittedStates[0]).toContain('act');
    }
  });
});
