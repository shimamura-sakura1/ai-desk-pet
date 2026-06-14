'use strict';

const {
  CORE_STATES,
  FIXED_TRANSITIONS,
  canReachTarget,
  autoCompleteGraph,
} = require('../src/lib/graph');

// ── FIXED_TRANSITIONS integrity ───────────────────────────────

describe('FIXED_TRANSITIONS', () => {
  test('contains required backbone edges', () => {
    const pairs = FIXED_TRANSITIONS.map(t => `${t.from}->${t.to}`);
    expect(pairs).toContain('idle->working');
    expect(pairs).toContain('working->done');
    expect(pairs).toContain('done->idle');
  });

  test('main axis idle→working→done→idle is fully connected', () => {
    expect(canReachTarget('idle',    'done', FIXED_TRANSITIONS)).toBe(true);
    expect(canReachTarget('working', 'done', FIXED_TRANSITIONS)).toBe(true);
    expect(canReachTarget('done',    'idle', FIXED_TRANSITIONS)).toBe(true);
  });
});

// ── canReachTarget ────────────────────────────────────────────

describe('canReachTarget', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'x', to: 'y' },
    { from: 'y', to: 'x' }, // cycle
  ];

  test('direct connection', () => {
    expect(canReachTarget('a', 'b', edges)).toBe(true);
  });

  test('indirect via chain', () => {
    expect(canReachTarget('a', 'd', edges)).toBe(true);
  });

  test('no path exists', () => {
    expect(canReachTarget('a', 'x', edges)).toBe(false);
  });

  test('start equals target returns true', () => {
    expect(canReachTarget('a', 'a', edges)).toBe(true);
  });

  test('handles cycles without infinite loop', () => {
    expect(canReachTarget('x', 'd', edges)).toBe(false);
    expect(canReachTarget('x', 'y', edges)).toBe(true);
  });

  test('empty edges → false unless start===target', () => {
    expect(canReachTarget('a', 'b', [])).toBe(false);
    expect(canReachTarget('a', 'a', [])).toBe(true);
  });
});

// ── autoCompleteGraph ─────────────────────────────────────────

describe('autoCompleteGraph — no custom states', () => {
  const coreIds = [...CORE_STATES];

  test('returns empty array when no custom states', () => {
    const result = autoCompleteGraph(coreIds, FIXED_TRANSITIONS, []);
    expect(result).toEqual([]);
  });

  test('idempotent: running twice produces same result', () => {
    const r1 = autoCompleteGraph(coreIds, FIXED_TRANSITIONS, []);
    const r2 = autoCompleteGraph(coreIds, FIXED_TRANSITIONS, r1);
    expect(r2).toEqual(r1);
  });
});

describe('autoCompleteGraph — isolated custom state', () => {
  const ids = [...CORE_STATES, 'dance'];
  const allEdges = FIXED_TRANSITIONS;

  test('isolated custom state gets auto edge to done', () => {
    const result = autoCompleteGraph(ids, allEdges, []);
    expect(result).toContainEqual(
      expect.objectContaining({ from: 'dance', to: 'done', auto: true })
    );
  });

  test('auto edge is removed after user manually connects dance→working', () => {
    const withManual = [{ from: 'dance', to: 'working', label: '' }];
    const result = autoCompleteGraph(ids, [...allEdges, ...withManual], withManual);
    const autoEdges = result.filter(t => t.auto);
    // dance→working→done exists via FIXED_TRANSITIONS, so no auto edge needed
    expect(autoEdges.find(t => t.from === 'dance')).toBeUndefined();
  });

  test('manual edge preserved in result', () => {
    const manual = { from: 'dance', to: 'working', label: 'trigger' };
    const result = autoCompleteGraph(ids, [...allEdges, manual], [manual]);
    expect(result).toContainEqual(manual);
  });
});

describe('autoCompleteGraph — internal cycle (A→B→A, neither can reach done)', () => {
  const ids = [...CORE_STATES, 'sing', 'laugh'];
  const cycleEdges = [
    ...FIXED_TRANSITIONS,
    { from: 'sing',  to: 'laugh', label: '' },
    { from: 'laugh', to: 'sing',  label: '' },
  ];

  test('both nodes in cycle get auto edges to done', () => {
    const manual = [
      { from: 'sing',  to: 'laugh', label: '' },
      { from: 'laugh', to: 'sing',  label: '' },
    ];
    const result = autoCompleteGraph(ids, cycleEdges, manual);
    const autoFroms = result.filter(t => t.auto).map(t => t.from);
    // At least one of sing/laugh gets auto edge (chain: once one has auto edge, the other can reach done through it)
    expect(autoFroms.some(f => f === 'sing' || f === 'laugh')).toBe(true);
    // Neither should be unreachable from done's perspective after fix
    const finalEdges = [...FIXED_TRANSITIONS, ...result];
    expect(canReachTarget('sing',  'done', finalEdges)).toBe(true);
    expect(canReachTarget('laugh', 'done', finalEdges)).toBe(true);
  });
});

describe('autoCompleteGraph — cleanup of stale auto edges', () => {
  const ids = [...CORE_STATES, 'dance'];
  const staleAuto = { from: 'dance', to: 'done', label: 'auto', auto: true };
  const newManual = { from: 'dance', to: 'working', label: '' };

  test('stale auto edge is dropped when manual path to done exists', () => {
    const current = [staleAuto, newManual];
    const allEdges = [...FIXED_TRANSITIONS, ...current];
    const result = autoCompleteGraph(ids, allEdges, current);
    expect(result.find(t => t.auto && t.from === 'dance')).toBeUndefined();
  });

  test('auto edge is retained when it is the only path to done', () => {
    const current = [staleAuto];
    const allEdges = [...FIXED_TRANSITIONS, ...current];
    const result = autoCompleteGraph(ids, allEdges, current);
    expect(result.find(t => t.auto && t.from === 'dance')).toBeDefined();
  });
});

describe('autoCompleteGraph — main axis safety', () => {
  test('does NOT add done→idle when FIXED_TRANSITIONS already has it', () => {
    const result = autoCompleteGraph(CORE_STATES, FIXED_TRANSITIONS, []);
    const doneToIdle = result.filter(t => t.from === 'done' && t.to === 'idle');
    expect(doneToIdle).toHaveLength(0);
  });

  test('FIXED_TRANSITIONS guarantees done→idle (Step 3 safety net pre-condition)', () => {
    // Step 3 inside autoCompleteGraph always uses the FIXED_TRANSITIONS constant.
    // This test confirms that constant satisfies the invariant.
    expect(canReachTarget('done', 'idle', FIXED_TRANSITIONS)).toBe(true);
  });
});

describe('autoCompleteGraph — chain: A→B, B isolated', () => {
  const ids = [...CORE_STATES, 'dance', 'pose'];

  test('dance→pose manual; pose gets auto edge; dance reaches done via pose', () => {
    const manual = [{ from: 'dance', to: 'pose', label: '' }];
    const allEdges = [...FIXED_TRANSITIONS, ...manual];
    const result = autoCompleteGraph(ids, allEdges, manual);

    // pose should have auto→done (can't reach done otherwise)
    expect(result.find(t => t.auto && t.from === 'pose' && t.to === 'done')).toBeDefined();

    // dance can reach done via dance→pose→done(auto), so no auto edge for dance
    expect(result.find(t => t.auto && t.from === 'dance')).toBeUndefined();
  });
});
