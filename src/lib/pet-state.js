'use strict';

// Maps Claude Code bridge state strings → internal session state
function mapBridgeState(s) {
  switch (s) {
    case 'act':
    case 'thinking':       return 'answering';
    case 'require_action':
    case 'alert':          return 'attention';
    case 'success':        return 'finished';
    default:               return 'idle';
  }
}

// Pure priority-ordered state resolver (drag > working > attention > done > bored > idle)
function targetState({ isDragging, sessionState, isFinishedLocked, isAttentionLocked, isBored }) {
  if (isDragging)                      return 'drag';
  if (sessionState === 'answering')    return 'working';
  if (isAttentionLocked)               return 'attention';
  if (isFinishedLocked)                return 'done';
  if (isBored)                         return 'bored';
  return 'idle';
}

// Fallback chain used when a state has no clips assigned.
const CLIP_FALLBACK = {
  attention: 'working',
  done:      'idle',
  drag:      'idle',
  bored:     'idle',
  working:   'idle',
};

// Pick a clip id for a given state, with graceful fallback so the pet never freezes.
function pickClip({
  stateName,
  states = {},
  debugState = null,
  debugClipId = null,
  debugSeqIdx = 0,
  random = Math.random,
} = {}) {
  if (debugState === '__clip__') return debugClipId;
  const list = states[stateName]?.clips ?? [];
  if (!list.length) {
    const fb = CLIP_FALLBACK[stateName];
    if (fb && fb !== stateName) {
      return pickClip({ stateName: fb, states, debugState, debugClipId, debugSeqIdx, random });
    }
    return null;
  }
  if (debugState === stateName) {
    return list[debugSeqIdx % list.length];
  }
  return list[Math.floor(random() * list.length)];
}

if (typeof module !== 'undefined') {
  module.exports = { mapBridgeState, targetState, pickClip };
} else {
  window.mapBridgeState = mapBridgeState;
  window.targetState    = targetState;
  window.pickClip       = pickClip;
}
