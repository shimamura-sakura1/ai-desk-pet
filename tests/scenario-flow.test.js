/**
 * @jest-environment jsdom
 *
 * 场景集成测试 — 以用户视角验证 4 个完整行为链路，每个场景均有 mock 驱动。
 *
 * 场景1: 新会话启动 → board 出现对应卡片
 * 场景2: 需要授权 → board 橙色 + 宠物 attention → 授权后 working
 * 场景3: 对话结束 → 宠物 done → 会话超时/关闭后回到 idle
 * 场景4: drag 打断工作/完成 → 松手恢复原状态
 */
'use strict';

jest.mock('fs', () => ({
  statSync:     jest.fn(() => ({ size: 0, birthtimeMs: 1000, mtimeMs: 1000 })),
  readdirSync:  jest.fn(() => []),
  readFileSync: jest.fn(() => ''),
  openSync:     jest.fn(() => 1),
  readSync:     jest.fn(() => 0),
  closeSync:    jest.fn(),
  existsSync:   jest.fn(() => false),
}));
jest.mock('child_process', () => ({ exec: jest.fn() }));

const { mapBridgeState, targetState } = require('../src/lib/pet-state');
const LocalMonitor = require('../src/main/monitor/local');

// ── Board jsdom 初始化 ────────────────────────────────────────────────────────

let _sessionsCallback = null;

beforeAll(() => {
  document.body.innerHTML = `
    <div id="app">
      <div id="card-list"></div>
      <div id="empty-state" class="hidden">暂无活跃会话</div>
    </div>
  `;

  global.petBridge = {
    getUserConfig:    jest.fn().mockResolvedValue({ board: { maxSessions: 3 } }),
    onSessionsUpdate: jest.fn().mockImplementation(cb => { _sessionsCallback = cb; }),
    boardResize:      jest.fn(),
    openProject:      jest.fn(),
  };

  require('../src/renderer/board/board.js');
});

function makeSession(overrides) {
  return {
    id: 'sess-1', project: 'MyProject', state: 'sleep',
    source: 'local', createdAt: Date.now(), lastActiveAt: Date.now(),
    ...overrides,
  };
}

function pushSessions(sessions) {
  _sessionsCallback(sessions);
}

// ── Engine 状态模拟器（纯函数，镜像 engine.js 的副作用逻辑）────────────────────
// engine.js 是浏览器 DOM 代码，不能直接 require；用这个模拟器对 state 逻辑做独立测试

function makeEngine() {
  return {
    isDragging:        false,
    sessionState:      'idle',
    isFinishedLocked:  false,
    isAttentionLocked: false,
    isBored:           false,
  };
}

function engineOnChange(eng, bridgeState) {
  const s = mapBridgeState(bridgeState);
  eng.sessionState = s;
  if (s === 'answering') {
    eng.isFinishedLocked  = false;
    eng.isAttentionLocked = false;
    eng.isBored           = false;
  } else if (s === 'attention') {
    eng.isAttentionLocked = true;
    eng.isFinishedLocked  = false;
    eng.isBored           = false;
  } else if (s === 'finished') {
    eng.isAttentionLocked = false;
    eng.isFinishedLocked  = true;
    eng.isBored           = false;
  } else if (s === 'idle') {
    eng.isAttentionLocked = false;
    eng.isFinishedLocked  = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 场景 1: 新会话启动 → board 出现对应卡片
// ─────────────────────────────────────────────────────────────────────────────

describe('场景1: 新会话启动 → board 出现对应卡片', () => {
  test('会话启动前 board 显示空态，card-list 为空', () => {
    pushSessions([]);
    expect(document.getElementById('empty-state').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('card-list').innerHTML).toBe('');
  });

  test('会话进入 thinking 状态 → board 出现蓝色思考中卡片，空态隐藏', () => {
    pushSessions([makeSession({ state: 'thinking' })]);
    const list = document.getElementById('card-list');
    expect(list.innerHTML).toContain('MyProject');
    expect(list.innerHTML).toContain('dot-thinking');
    expect(list.innerHTML).toContain('card-thinking');
    expect(document.getElementById('empty-state').classList.contains('hidden')).toBe(true);
  });

  test('会话进入 act 状态 → board 出现蓝色执行中卡片', () => {
    pushSessions([makeSession({ state: 'act' })]);
    const html = document.getElementById('card-list').innerHTML;
    expect(html).toContain('dot-active');
    expect(html).toContain('card-active');
  });

  test('多个会话同时存在 → board 按优先级排序（require_action 排第一）', () => {
    pushSessions([
      makeSession({ id: 'low',  state: 'sleep',          createdAt: 1000 }),
      makeSession({ id: 'high', state: 'require_action', createdAt: 1000 }),
      makeSession({ id: 'mid',  state: 'act',            createdAt: 1000 }),
    ]);
    const cards = [...document.querySelectorAll('[data-id]')];
    expect(cards[0].dataset.id).toBe('high');
    expect(cards[1].dataset.id).toBe('mid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 场景 2: 需要授权 → board 橙色 + 宠物 attention → 授权后 working
// ─────────────────────────────────────────────────────────────────────────────

describe('场景2: 需要授权 → board 橙色 + 宠物 attention → 授权后 working', () => {
  describe('board 面板整体变色', () => {
    test('存在 require_action 会话 → #app 获得 has-alert 类（橙色边框）', () => {
      pushSessions([makeSession({ state: 'require_action' })]);
      expect(document.getElementById('app').classList.contains('has-alert')).toBe(true);
    });

    test('用户授权后状态变为 act → has-alert 移除，面板恢复正常色', () => {
      pushSessions([makeSession({ state: 'act' })]);
      expect(document.getElementById('app').classList.contains('has-alert')).toBe(false);
    });

    test('无会话时 has-alert 不存在', () => {
      pushSessions([]);
      expect(document.getElementById('app').classList.contains('has-alert')).toBe(false);
    });

    test('混合场景：一个 require_action + 一个 act → has-alert 仍然存在', () => {
      pushSessions([
        makeSession({ id: 'a', state: 'require_action' }),
        makeSession({ id: 'b', state: 'act' }),
      ]);
      expect(document.getElementById('app').classList.contains('has-alert')).toBe(true);
    });
  });

  describe('board 卡片级别橙色', () => {
    test('require_action 卡片包含 dot-alert 和 card-alert 样式', () => {
      pushSessions([makeSession({ state: 'require_action' })]);
      const html = document.getElementById('card-list').innerHTML;
      expect(html).toContain('dot-alert');
      expect(html).toContain('card-alert');
    });

    test('展开 require_action 卡片后包含授权文案', () => {
      pushSessions([makeSession({ id: 'ra-card', state: 'require_action' })]);
      document.querySelector('[data-id="ra-card"]').click();
      expect(document.getElementById('card-list').innerHTML).toContain('Claude 需要你的授权');
    });
  });

  describe('宠物状态切换', () => {
    test('require_action → 宠物进入 attention，isAttentionLocked = true', () => {
      const eng = makeEngine();
      engineOnChange(eng, 'require_action');
      expect(eng.isAttentionLocked).toBe(true);
      expect(targetState(eng)).toBe('attention');
    });

    test('用户授权 (act) → isAttentionLocked 清除，宠物回到 working', () => {
      const eng = makeEngine();
      engineOnChange(eng, 'require_action');
      expect(targetState(eng)).toBe('attention');

      engineOnChange(eng, 'act');
      expect(eng.isAttentionLocked).toBe(false);
      expect(targetState(eng)).toBe('working');
    });

    test('完整链路：require_action → attention → (授权) → act → working', () => {
      const eng = makeEngine();

      engineOnChange(eng, 'act');        // 开始工作
      expect(targetState(eng)).toBe('working');

      engineOnChange(eng, 'require_action'); // 需要权限
      expect(targetState(eng)).toBe('attention');

      engineOnChange(eng, 'act');        // 授权完成，继续执行
      expect(targetState(eng)).toBe('working');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 场景 3: 对话结束 → 宠物 done → 会话超时/关闭后回到 idle
// ─────────────────────────────────────────────────────────────────────────────

describe('场景3: 对话结束 → 宠物 done → 会话超时/关闭后回到 idle', () => {
  describe('宠物状态机', () => {
    test('success → isFinishedLocked = true，宠物进入 done', () => {
      const eng = makeEngine();
      engineOnChange(eng, 'success');
      expect(eng.isFinishedLocked).toBe(true);
      expect(targetState(eng)).toBe('done');
    });

    test('replied 同样触发 done（Claude 回复后等待用户继续）', () => {
      // replied 在 computeGlobalState 里映射为 'success'
      const eng = makeEngine();
      engineOnChange(eng, 'success'); // replied → global success
      expect(targetState(eng)).toBe('done');
    });

    test('会话关闭/超时 (sleep → idle) → isFinishedLocked 清除，宠物回到 idle', () => {
      const eng = makeEngine();
      engineOnChange(eng, 'success');
      expect(targetState(eng)).toBe('done');

      // Claude 进程结束 → local monitor 发出 sleep → mapBridgeState → idle
      engineOnChange(eng, 'sleep');
      expect(eng.isFinishedLocked).toBe(false);
      expect(targetState(eng)).toBe('idle');
    });

    test('完整链路：act → working → success → done → sleep → idle', () => {
      const eng = makeEngine();

      engineOnChange(eng, 'act');
      expect(targetState(eng)).toBe('working');

      engineOnChange(eng, 'success');
      expect(targetState(eng)).toBe('done');

      engineOnChange(eng, 'sleep');
      expect(targetState(eng)).toBe('idle');
    });
  });

  describe('LocalMonitor 不活跃计时器', () => {
    const INACTIVITY_MS = 180_000;

    afterEach(() => jest.useRealTimers());

    test('replied 状态不会自动 sleep（需等用户回复）', () => {
      jest.useFakeTimers();
      const monitor = new LocalMonitor();
      const session = {
        id: 'sess-replied', name: 'test', project: 'test', filePath: '/r.jsonl',
        state: 'sleep', lastMessage: '',
        inactivityTimer: null, _batchPermTimer: null, _batchPermTimerId: 0,
        createdAt: 0, lastActiveAt: 0, messageCount: 0,
      };
      monitor._sessions.set('/r.jsonl', session);

      // 收到 Claude 纯文本回复 → replied
      monitor._parseChunk(JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '任务完成。' }] },
      }), session);
      expect(session.state).toBe('replied');

      // replied 在 30s 后自动 sleep（board 蓝色提醒同步消失）
      jest.advanceTimersByTime(29_999);
      expect(session.state).toBe('replied');
      jest.advanceTimersByTime(1);
      expect(session.state).toBe('sleep');
    });

    test('act 状态下 180s 无新活动 → session 自动变为 sleep', () => {
      jest.useFakeTimers();
      const monitor = new LocalMonitor();
      const session = {
        id: 'sess-act', name: 'test', project: 'test', filePath: '/a.jsonl',
        state: 'sleep', lastMessage: '',
        inactivityTimer: null, _batchPermTimer: null, _batchPermTimerId: 0,
        createdAt: 0, lastActiveAt: 0, messageCount: 0,
      };
      monitor._sessions.set('/a.jsonl', session);

      monitor._parseChunk(JSON.stringify({
        type: 'user',
        toolUseResult: { stdout: 'ok' },
        message: { content: [{ type: 'tool_result', content: 'ok' }] },
      }), session);
      expect(session.state).toBe('act');

      jest.advanceTimersByTime(INACTIVITY_MS - 1);
      expect(session.state).toBe('act');

      jest.advanceTimersByTime(1);
      expect(session.state).toBe('sleep');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 场景 4: drag 打断工作/完成 → 松手恢复原状态
// ─────────────────────────────────────────────────────────────────────────────

describe('场景4: drag 打断工作/完成 → 松手恢复原状态', () => {
  test('working 中开始 drag → 进入 drag 动画', () => {
    const eng = makeEngine();
    engineOnChange(eng, 'act');
    expect(targetState(eng)).toBe('working');

    eng.isDragging = true;
    expect(targetState(eng)).toBe('drag');
  });

  test('drag 松手，仍在 working → 回到 working', () => {
    const eng = makeEngine();
    engineOnChange(eng, 'act');
    eng.isDragging = true;
    expect(targetState(eng)).toBe('drag');

    eng.isDragging = false;
    expect(targetState(eng)).toBe('working');
  });

  test('done 状态开始 drag → 进入 drag 动画', () => {
    const eng = makeEngine();
    engineOnChange(eng, 'success');
    expect(targetState(eng)).toBe('done');

    eng.isDragging = true;
    expect(targetState(eng)).toBe('drag');
  });

  test('drag 松手，会话已结束 → 回到 done', () => {
    const eng = makeEngine();
    engineOnChange(eng, 'success');
    eng.isDragging = true;
    expect(targetState(eng)).toBe('drag');

    eng.isDragging = false;
    expect(targetState(eng)).toBe('done');
  });

  test('attention 状态开始 drag → 进入 drag 动画', () => {
    const eng = makeEngine();
    engineOnChange(eng, 'require_action');
    expect(targetState(eng)).toBe('attention');

    eng.isDragging = true;
    expect(targetState(eng)).toBe('drag');
  });

  test('drag 松手，attention 未解除 → 回到 attention', () => {
    const eng = makeEngine();
    engineOnChange(eng, 'require_action');
    eng.isDragging = true;
    expect(targetState(eng)).toBe('drag');

    eng.isDragging = false;
    expect(targetState(eng)).toBe('attention');
  });

  test('drag 是最高优先级：working + attention + done 同时存在 → 仍是 drag', () => {
    const eng = makeEngine();
    eng.isDragging        = true;
    eng.sessionState      = 'answering';
    eng.isAttentionLocked = true;
    eng.isFinishedLocked  = true;
    expect(targetState(eng)).toBe('drag');
  });
});
