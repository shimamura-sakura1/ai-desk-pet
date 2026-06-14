'use strict';

// Maps Claude Code bridge state strings → internal session state
function mapBridgeState(s) {
  switch (s) {
    case 'act':
    case 'thinking':       return 'answering';
    case 'require_action':
    case 'alert':
    case 'success':        return 'finished';
    default:               return 'idle';
  }
}

// Pure priority-ordered state resolver (drag > working > done > bored > idle)
function targetState({ isDragging, sessionState, isFinishedLocked, isBored }) {
  if (isDragging)                   return 'drag';
  if (sessionState === 'answering') return 'working';
  if (isFinishedLocked)             return 'done';
  if (isBored)                      return 'bored';
  return 'idle';
}

if (typeof module !== 'undefined') {
  module.exports = { mapBridgeState, targetState };
} else {
  window.mapBridgeState = mapBridgeState;
  window.targetState    = targetState;
}
