/**
 * @jest-environment jsdom
 */
'use strict';

// ── bridge mock（board.js 顶层调用，必须在 require 之前设置）────

let _sessionsCallback = null;

beforeAll(() => {
  document.body.innerHTML = `
    <div id="card-list"></div>
    <div id="empty-state" class="hidden"></div>
  `;

  global.petBridge = {
    getUserConfig:    jest.fn().mockResolvedValue({ board: { maxSessions: 3 } }),
    onSessionsUpdate: jest.fn().mockImplementation(cb => { _sessionsCallback = cb; }),
    boardResize:      jest.fn(),
    openProject:      jest.fn(),
  };

  require('../src/renderer/board/board.js');
});

// ── helpers ──────────────────────────────────────────────────────

function session(overrides) {
  return {
    id: 'test-1', project: 'test', state: 'sleep',
    source: 'local', createdAt: Date.now(),
    ...overrides,
  };
}

function renderWith(sessions) {
  _sessionsCallback(sessions);
  return document.getElementById('card-list').innerHTML;
}

// ── stateInfo 映射 ────────────────────────────────────────────────

describe('board: 状态 → dot / card 样式映射', () => {
  test.each([
    ['require_action', 'dot-alert',    'card-alert'],
    ['replied',        'dot-done',     'card-done'],
    ['thinking',       'dot-thinking', 'card-thinking'],
    ['act',            'dot-active',   'card-active'],
    ['success',        'dot-done',     'card-done'],   // ← 这个 bug 修复后才能通过
    ['sleep',          'dot-sleep',    'card-sleep'],
    ['unknown',        'dot-sleep',    'card-sleep'],
  ])('state="%s" → %s / %s', (state, expectedDot, expectedCard) => {
    const html = renderWith([session({ state })]);
    expect(html).toContain(expectedDot);
    expect(html).toContain(expectedCard);
  });
});

// ── require_action card 内容 ──────────────────────────────────────

describe('board: require_action card 展示授权提示', () => {
  test('展开 require_action 卡片包含授权文案', () => {
    // 先渲染使卡片出现，再点击展开
    renderWith([session({ id: 'card-ra', state: 'require_action' })]);
    const card = document.querySelector('[data-id="card-ra"]');
    card.click();
    const html = document.getElementById('card-list').innerHTML;
    expect(html).toContain('Claude 需要你的授权');
  });
});

// ── success card 内容 ─────────────────────────────────────────────

describe('board: success card 展示完成文案', () => {
  test('展开 replied 卡片包含等待下一步文案', () => {
    renderWith([session({ id: 'card-ok', state: 'replied' })]);
    const card = document.querySelector('[data-id="card-ok"]');
    card.click();
    const html = document.getElementById('card-list').innerHTML;
    expect(html).toContain('Claude 已完成，等待下一步指令');
  });
});

// ── sortSessions 优先级 ───────────────────────────────────────────

describe('board: sortSessions 排序优先级', () => {
  const STATES_IN_PRIORITY = ['require_action', 'act', 'success', 'sleep'];

  test('高优先级状态排在最前', () => {
    // 故意乱序传入
    const sessions = [
      session({ id: 's4', state: 'sleep',          createdAt: 1000 }),
      session({ id: 's3', state: 'success',         createdAt: 1000 }),
      session({ id: 's1', state: 'require_action',  createdAt: 1000 }),
      session({ id: 's2', state: 'act',             createdAt: 1000 }),
    ];
    renderWith(sessions);

    const cards = [...document.querySelectorAll('[data-id]')];
    const renderedIds = cards.map(c => c.dataset.id);

    // 按优先级验证顺序（maxSessions=3，sleep 被裁掉）
    expect(renderedIds[0]).toBe('s1'); // require_action 最高
    expect(renderedIds[1]).toBe('s2'); // act 次之
    expect(renderedIds[2]).toBe('s3'); // success 第三
  });

  test('success 排在 sleep 之前', () => {
    const sessions = [
      session({ id: 'sl', state: 'sleep',   createdAt: 1000 }),
      session({ id: 'su', state: 'success', createdAt: 1000 }),
    ];
    renderWith(sessions);

    const ids = [...document.querySelectorAll('[data-id]')].map(c => c.dataset.id);
    expect(ids[0]).toBe('su');
  });

  test('replied 与 success 同级，排在 sleep 之前', () => {
    const sessions = [
      session({ id: 'sl', state: 'sleep',   createdAt: 1000 }),
      session({ id: 're', state: 'replied', createdAt: 1000 }),
    ];
    renderWith(sessions);

    const ids = [...document.querySelectorAll('[data-id]')].map(c => c.dataset.id);
    expect(ids[0]).toBe('re');
  });
});

// ── 空状态 ────────────────────────────────────────────────────────

describe('board: 无会话时显示空态', () => {
  test('sessions=[] 时 empty-state 可见', () => {
    renderWith([]);
    const empty = document.getElementById('empty-state');
    expect(empty.classList.contains('hidden')).toBe(false);
  });

  test('有会话时 empty-state 隐藏', () => {
    renderWith([session({ state: 'act' })]);
    const empty = document.getElementById('empty-state');
    expect(empty.classList.contains('hidden')).toBe(true);
  });
});
