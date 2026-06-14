'use strict';

const CORE_STATES = ['idle', 'bored', 'working', 'done', 'drag'];

const FIXED_TRANSITIONS = [
  { from: 'idle',    to: 'bored',   label: 'idle timeout', bidir: true },
  { from: 'idle',    to: 'working', label: 'Claude active' },
  { from: 'bored',   to: 'working', label: 'Claude active' },
  { from: 'working', to: 'done',    label: 'session done'  },
  { from: 'done',    to: 'idle',    label: 'click / idle'  },
];

function canReachTarget(startId, targetId, edges) {
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === targetId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const e of edges) {
      if (e.from === cur && !visited.has(e.to)) queue.push(e.to);
    }
  }
  return false;
}

function autoCompleteGraph(stateIds, allEdges, currentTransitions) {
  // Step 1: Cleanup — drop auto edges made redundant by manual edges
  const nonAuto = currentTransitions.filter(t => !t.auto);
  const result  = [...nonAuto];

  for (const t of currentTransitions) {
    if (!t.auto) continue;
    const edgesWithout = [
      ...FIXED_TRANSITIONS,
      ...result.filter(x => !(x.from === t.from && x.to === t.to)),
    ];
    if (!canReachTarget(t.from, 'done', edgesWithout)) {
      result.push(t);
    }
  }

  // Step 2: Fill — add auto edges for custom states that cannot reach done
  const customStates = stateIds.filter(id => !CORE_STATES.includes(id));
  for (const id of customStates) {
    if (!canReachTarget(id, 'done', [...FIXED_TRANSITIONS, ...result])) {
      result.push({ from: id, to: 'done', label: 'auto', auto: true });
    }
  }

  // Step 2b: Cleanup — newly added auto edges may be redundant when a chain
  // resolves (e.g. dance→pose + pose→done(auto) means dance no longer needs its own auto edge)
  for (let i = result.length - 1; i >= 0; i--) {
    const t = result[i];
    if (!t.auto) continue;
    const without = [...FIXED_TRANSITIONS, ...result.filter((_, j) => j !== i)];
    if (canReachTarget(t.from, 'done', without)) {
      result.splice(i, 1);
    }
  }

  // Step 3: Main axis safety — ensure done→idle path exists (safety net; normally covered by FIXED_TRANSITIONS)
  if (!canReachTarget('done', 'idle', [...FIXED_TRANSITIONS, ...result])) {
    result.push({ from: 'done', to: 'idle', label: 'auto', auto: true });
  }

  return result;
}

// CommonJS (Node / Jest)
if (typeof module !== 'undefined') {
  module.exports = { CORE_STATES, FIXED_TRANSITIONS, canReachTarget, autoCompleteGraph };
} else {
  // Browser — expose as globals for renderer scripts
  window.CORE_STATES        = CORE_STATES;
  window.FIXED_TRANSITIONS  = FIXED_TRANSITIONS;
  window.canReachTarget     = canReachTarget;
  window.autoCompleteGraph  = autoCompleteGraph;
}
