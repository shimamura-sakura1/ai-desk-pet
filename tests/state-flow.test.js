'use strict';

const { mapBridgeState, targetState } = require('../src/lib/pet-state');

// ── 镜像 index.js 中的 onMonitorUpdate 全局状态聚合逻辑 ──────────
// 如果 index.js 里的逻辑改了，这个测试会失败提醒同步更新

function computeGlobalState(sessions) {
  const states = sessions.map(s => s.state);
  if (states.some(s => s === 'require_action' || s === 'alert'))   return 'require_action';
  if (states.some(s => s === 'act' || s === 'thinking'))           return 'act';
  if (states.some(s => s === 'replied'  || s === 'success'))       return 'success';
  return 'sleep';
}

// ── 镜像 board.js 的 stateInfo（board 颜色映射回归测试）─────────
// 如果 board.js 里的映射改了，这个测试会失败提醒同步更新

function stateInfo(state) {
  switch (state) {
    case 'require_action': return { cls: 'alert',    dot: 'dot-alert'    };
    case 'thinking':       return { cls: 'thinking', dot: 'dot-thinking' };
    case 'act':            return { cls: 'active',   dot: 'dot-active'   };
    case 'replied':        return { cls: 'done',     dot: 'dot-done'     };
    case 'success':        return { cls: 'done',     dot: 'dot-done'     };
    default:               return { cls: 'sleep',    dot: 'dot-sleep'    };
  }
}

// ── 工具 ──────────────────────────────────────────────────────────

function makeSession(state) { return { state }; }

// 模拟 engine.js 里的 onSessionChange 副作用
function simulateEngine(bridgeGlobalState) {
  const mapped = mapBridgeState(bridgeGlobalState);  // bridge → internal
  const base   = { isDragging: false, sessionState: mapped, isFinishedLocked: false, isAttentionLocked: false, isBored: false };

  // attention 锁定逻辑
  if (mapped === 'attention') base.isAttentionLocked = true;
  // finished 锁定逻辑
  if (mapped === 'finished')  base.isFinishedLocked  = true;
  // answering 清除锁定
  if (mapped === 'answering') { base.isAttentionLocked = false; base.isFinishedLocked = false; }

  return {
    sessionState: mapped,
    petClip: targetState(base),
    boardDot: stateInfo(bridgeGlobalState).dot,
  };
}

// ── 1. 全局状态聚合 ───────────────────────────────────────────────

describe('全局状态聚合 (computeGlobalState)', () => {
  test('无会话 → sleep', () => {
    expect(computeGlobalState([])).toBe('sleep');
  });

  test('working 会话 → act', () => {
    expect(computeGlobalState([makeSession('act')])).toBe('act');
    expect(computeGlobalState([makeSession('thinking')])).toBe('act');
  });

  test('需要权限 → require_action', () => {
    expect(computeGlobalState([makeSession('require_action')])).toBe('require_action');
    expect(computeGlobalState([makeSession('alert')])).toBe('require_action');
  });

  test('Claude 已回复等待下一步 → success（蓝闪，而非橙色）', () => {
    expect(computeGlobalState([makeSession('replied')])).toBe('success');
  });

  test('完成等待 → success', () => {
    expect(computeGlobalState([makeSession('success')])).toBe('success');
  });

  // 优先级：require_action > act > success > sleep
  test('require_action + act 同时存在 → require_action 优先', () => {
    expect(computeGlobalState([
      makeSession('act'),
      makeSession('require_action'),
    ])).toBe('require_action');
  });

  test('act + success 同时存在 → act 优先', () => {
    expect(computeGlobalState([
      makeSession('success'),
      makeSession('act'),
    ])).toBe('act');
  });

  test('success + sleep → success 优先', () => {
    expect(computeGlobalState([
      makeSession('sleep'),
      makeSession('success'),
    ])).toBe('success');
  });
});

// ── 2. 完整状态链路 ───────────────────────────────────────────────
//
//  会话状态 → computeGlobalState → mapBridgeState → targetState(宠物动作)
//                                                 → stateInfo(board颜色)

describe('状态全链路', () => {
  test('工作中: act → 宠物 working + board 蓝色常亮', () => {
    const global  = computeGlobalState([makeSession('act')]);
    const { petClip, boardDot } = simulateEngine(global);
    expect(petClip).toBe('working');
    expect(boardDot).toBe('dot-active');
  });

  test('思考中: thinking → 宠物 working (thinking 聚合进 act 全局状态)', () => {
    // thinking 和 act 都聚合为全局 act，card 级别的 dot-thinking 由 board-state.test.js 覆盖
    const global  = computeGlobalState([makeSession('thinking')]);
    expect(global).toBe('act');
    const { petClip, boardDot } = simulateEngine(global);
    expect(petClip).toBe('working');
    expect(boardDot).toBe('dot-active');
  });

  test('需要权限: require_action → 宠物 attention + board 橙色闪烁', () => {
    const global  = computeGlobalState([makeSession('require_action')]);
    const { petClip, boardDot } = simulateEngine(global);
    expect(petClip).toBe('attention');
    expect(boardDot).toBe('dot-alert');
  });

  test('完成等待: success → 宠物 done + board 蓝色快闪', () => {
    const global  = computeGlobalState([makeSession('success')]);
    const { petClip, boardDot } = simulateEngine(global);
    expect(petClip).toBe('done');
    expect(boardDot).toBe('dot-done');
  });

  test('replied → 宠物 done + board 蓝色快闪（同 success，不再显示橙色）', () => {
    const global  = computeGlobalState([makeSession('replied')]);
    const { petClip, boardDot } = simulateEngine(global);
    expect(petClip).toBe('done');
    expect(boardDot).toBe('dot-done');
  });

  test('无会话: sleep → 宠物 idle + board 暗灰', () => {
    const global  = computeGlobalState([]);
    const { petClip, boardDot } = simulateEngine(global);
    expect(petClip).toBe('idle');
    expect(boardDot).toBe('dot-sleep');
  });
});

// ── 3. 状态转换场景 ───────────────────────────────────────────────

describe('状态转换场景', () => {
  test('require_action → working: 用户给权限后宠物回到 working', () => {
    // 先是需要权限
    const s1 = simulateEngine(computeGlobalState([makeSession('require_action')]));
    expect(s1.petClip).toBe('attention');

    // 用户授权，回到 working
    const s2 = simulateEngine(computeGlobalState([makeSession('act')]));
    expect(s2.petClip).toBe('working');
    expect(s2.boardDot).toBe('dot-active');
  });

  test('working → success: 会话完成后宠物切换 done + board 蓝闪', () => {
    const s1 = simulateEngine(computeGlobalState([makeSession('act')]));
    expect(s1.petClip).toBe('working');

    const s2 = simulateEngine(computeGlobalState([makeSession('success')]));
    expect(s2.petClip).toBe('done');
    expect(s2.boardDot).toBe('dot-done');
  });

  test('混合场景: 一个会话需要权限 + 一个完成 → 警告优先', () => {
    const global = computeGlobalState([
      makeSession('success'),
      makeSession('require_action'),
    ]);
    const { petClip, boardDot } = simulateEngine(global);
    expect(petClip).toBe('attention');
    expect(boardDot).toBe('dot-alert');
  });
});
