'use strict';
/*
 * Cross-platform AI coding-agent detection.
 *
 * We monitor which "agents" are currently running so the pet can react to more
 * than just Claude Code: Codex CLI, Claude Desktop, Codex Desktop, etc.
 *
 * Detection is name-based (process basename) with a capitalisation heuristic to
 * tell a CLI from a Desktop app (e.g. `claude` vs `Claude`, `codex` vs `Codex`).
 * On Windows/macOS an optional executable-path map can refine the choice
 * (desktop apps live under AppData/Program Files or /Applications).
 */

const AGENTS = {
  'claude-cli':  { label: 'Claude CLI',  desktop: false, win: ['claude.exe'],     mac: ['claude'],     linux: ['claude'] },
  'codex-cli':   { label: 'Codex CLI',   desktop: false, win: ['codex.exe'],      mac: ['codex'],      linux: ['codex']  },
  'claude-desk': { label: 'Claude Desk', desktop: true,  win: ['claude.exe'],     mac: ['claude'],     linux: ['claude'] },
  'codex-desk':  { label: 'Codex Desk',  desktop: true,  win: ['codex.exe'],      mac: ['codex'],      linux: ['codex']  },
};

// Normalise a process listing line into a basename (lowercase, no .exe).
function normName(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\.exe$/i, '');
}

// Pure classifier — testable without spawning anything.
//   rawNames: array of running process basenames (e.g. 'claude.exe', 'Claude.exe')
//   platform: 'win32' | 'darwin' | 'linux'
//   pathsByBase: optional { base(lowercase,no .exe): executablePath } for path refinement
function classify(rawNames, platform, pathsByBase = {}) {
  const set = new Set();
  const WIN = platform === 'win32';
  const MAC = platform === 'darwin';

  const baseOf = n => n.replace(/\.exe$/i, '');
  const hasExact = name => rawNames.some(n => baseOf(n) === name);

  // Path-based desktop refinement (desktop apps live under AppData/Program Files/Applications)
  const deskByPath = new Set();
  for (const [base, p] of Object.entries(pathsByBase)) {
    if (isDesktopPath(p, WIN, MAC)) deskByPath.add(base);
  }

  // CLI present only for the exact lowercase process name (not the capitalised Desktop app)
  if (hasExact('claude') && !deskByPath.has('claude')) set.add('claude-cli');
  if (hasExact('codex') && !deskByPath.has('codex')) set.add('codex-cli');
  // Desktop present for the capitalised process name OR a desktop install path
  if (hasExact('Claude') || deskByPath.has('claude')) set.add('claude-desk');
  if (hasExact('Codex') || deskByPath.has('codex')) set.add('codex-desk');

  return set;
}

function isDesktopPath(p, WIN, MAC) {
  const lp = p.toLowerCase();
  if (WIN) {
    return lp.includes('appdata') || lp.includes('program files') || (lp.includes('claude') && !lp.includes('node_modules'));
  }
  if (MAC) return lp.includes('/applications/') || lp.endsWith('.app/contents/macos/');
  return false;
}

module.exports = { AGENTS, normName, classify, isDesktopPath };
