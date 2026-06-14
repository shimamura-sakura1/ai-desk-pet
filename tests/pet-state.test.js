'use strict';

const { mapBridgeState, targetState } = require('../src/lib/pet-state');

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
