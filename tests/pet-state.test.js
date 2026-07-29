'use strict';

const { mapBridgeState, targetState, pickClip } = require('../src/lib/pet-state');

// ── mapBridgeState ────────────────────────────────────────────

describe('mapBridgeState', () => {
  test.each([
    ['act',            'answering'],
    ['thinking',       'answering'],
    ['require_action', 'attention'],
    ['alert',          'attention'],
    ['success',        'finished'],
    ['idle',           'idle'],
    ['unknown-string', 'idle'],
    ['',               'idle'],
    [undefined,        'idle'],
  ])('"%s" → "%s"', (input, expected) => {
    expect(mapBridgeState(input)).toBe(expected);
  });
});

// ── targetState ───────────────────────────────────────────────

describe('targetState priority', () => {
  const base = { isDragging: false, sessionState: 'idle', isFinishedLocked: false, isAttentionLocked: false, isBored: false };

  test('default → idle', () => {
    expect(targetState(base)).toBe('idle');
  });

  test('isBored → bored', () => {
    expect(targetState({ ...base, isBored: true })).toBe('bored');
  });

  test('isFinishedLocked → done', () => {
    expect(targetState({ ...base, isFinishedLocked: true })).toBe('done');
  });

  test('isFinishedLocked overrides isBored', () => {
    expect(targetState({ ...base, isFinishedLocked: true, isBored: true })).toBe('done');
  });

  test('isAttentionLocked → attention', () => {
    expect(targetState({ ...base, isAttentionLocked: true })).toBe('attention');
  });

  test('isAttentionLocked overrides done and bored', () => {
    expect(targetState({ ...base, isAttentionLocked: true, isFinishedLocked: true, isBored: true })).toBe('attention');
  });

  test('sessionState answering → working', () => {
    expect(targetState({ ...base, sessionState: 'answering' })).toBe('working');
  });

  test('answering overrides attention, done and bored', () => {
    expect(targetState({ ...base, sessionState: 'answering', isAttentionLocked: true, isFinishedLocked: true, isBored: true })).toBe('working');
  });

  test('isDragging → drag (highest priority)', () => {
    expect(targetState({
      isDragging: true,
      sessionState: 'answering',
      isFinishedLocked: true,
      isAttentionLocked: true,
      isBored: true,
    })).toBe('drag');
  });

  test('non-answering sessionState does not override idle', () => {
    expect(targetState({ ...base, sessionState: 'finished' })).toBe('idle');
    expect(targetState({ ...base, sessionState: 'idle' })).toBe('idle');
  });
});

// ── pickClip ───────────────────────────────────────────────────

function makeStates() {
  return {
    idle:    { clips: ['idle-1', 'idle-2'] },
    working: { clips: ['working'] },
    done:    { clips: ['done'] },
    drag:    { clips: [] },
    bored:   { clips: [] },
    attention: { clips: [] },
  };
}

describe('pickClip', () => {
  test('returns a random clip from the state list', () => {
    const states = makeStates();
    expect(pickClip({ stateName: 'working', states, random: () => 0 })).toBe('working');
    expect(pickClip({ stateName: 'idle', states, random: () => 0 })).toBe('idle-1');
    expect(pickClip({ stateName: 'idle', states, random: () => 0.99 })).toBe('idle-2');
  });

  test('debugState matching stateName returns sequenced clip', () => {
    const states = makeStates();
    expect(pickClip({ stateName: 'idle', states, debugState: 'idle', debugSeqIdx: 0 })).toBe('idle-1');
    expect(pickClip({ stateName: 'idle', states, debugState: 'idle', debugSeqIdx: 1 })).toBe('idle-2');
    expect(pickClip({ stateName: 'idle', states, debugState: 'idle', debugSeqIdx: 2 })).toBe('idle-1');
  });

  test('__clip__ debug state returns forced clip id', () => {
    expect(pickClip({ stateName: 'idle', states: {}, debugState: '__clip__', debugClipId: 'forced' })).toBe('forced');
  });

  test('falls back to sibling state when current state has no clips', () => {
    const states = makeStates();
    expect(pickClip({ stateName: 'attention', states, random: () => 0 })).toBe('working');
    expect(pickClip({ stateName: 'done', states, random: () => 0 })).toBe('done'); // has its own
    expect(pickClip({ stateName: 'drag', states, random: () => 0 })).toBe('idle-1');
    expect(pickClip({ stateName: 'bored', states, random: () => 0 })).toBe('idle-1');
  });

  test('working falls back to idle when idle is also empty', () => {
    const states = { working: { clips: [] }, idle: { clips: [] } };
    expect(pickClip({ stateName: 'working', states })).toBeNull();
  });

  test('returns null when no clips and no fallback exists', () => {
    const states = { idle: { clips: ['idle-1'] } };
    expect(pickClip({ stateName: 'unknown', states })).toBeNull();
  });
});
