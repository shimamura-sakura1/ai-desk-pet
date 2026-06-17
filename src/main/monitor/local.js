const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const EventEmitter = require('events');

const CLAUDE_LOG_DIR      = path.join(os.homedir(), '.claude', 'projects');
const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const INACTIVITY_MS = 180000; // 3 min — long enough for Claude to finish thinking

class LocalMonitor extends EventEmitter {
  constructor() {
    super();
    this._pollTimer = null;
    this._sessions = new Map(); // sessionId → { state, name, lastMessage, filePath, fileSize }
  }

  start(intervalMs = 2000) {
    this._initSessions();
    this._poll();
    this._pollTimer = setInterval(() => this._poll(), intervalMs);
  }

  stop() {
    clearInterval(this._pollTimer);
    this._sessions.forEach(s => {
      clearTimeout(s.inactivityTimer);
      clearTimeout(s._batchPermTimer);
      clearTimeout(s._pendingPermTimer);
    });
  }

  clearReplied() {
    let changed = false;
    for (const s of this._sessions.values()) {
      if (s.state === 'replied') {
        s.state = 'sleep';
        s.lastMessage = '';
        clearTimeout(s.inactivityTimer);
        changed = true;
      }
    }
    if (changed) this._emitUpdate();
  }

  getSessions() {
    return Array.from(this._sessions.values()).map(s => ({
      id: s.id,
      name: s.name,
      state: s.state,
      lastMessage: s.lastMessage,
      project: s.project,
      filePath: s.filePath,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      messageCount: s.messageCount,
      source: 'local',
    }));
  }

  // -------- 私有 --------

  _initSessions() {
    for (const f of this._findJsonl(CLAUDE_LOG_DIR)) {
      if (!this._sessions.has(f)) {
        const info = this._buildSessionInfo(f);
        this._sessions.set(f, { ...info, fileSize: this._getSize(f) });
      }
    }
    if (this._sessions.size > 0) this._emitUpdate();
  }

  _poll() {
    this._checkProcesses();
    this._checkSessionFiles();
    this._checkLogs();
  }

  _checkSessionFiles() {
    let changed = false;
    try {
      for (const f of fs.readdirSync(CLAUDE_SESSIONS_DIR)) {
        if (!f.endsWith('.json')) continue;
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(CLAUDE_SESSIONS_DIR, f), 'utf8')
          );
          if (data.status === 'waiting' && data.waitingFor === 'permission prompt') {
            const session = this._findSessionById(data.sessionId);
            if (session && session.state !== 'require_action') {
              session.state       = 'require_action';
              session.lastMessage = 'Claude needs your permission';
              session.lastActiveAt = Date.now();
              clearTimeout(session.inactivityTimer);
              changed = true;
            }
          }
        } catch {}
      }
    } catch {}
    if (changed) this._emitUpdate();
  }

  _findSessionById(sessionId) {
    for (const s of this._sessions.values()) {
      if (s.id === sessionId) return s;
    }
    return null;
  }

  _checkProcesses() {
    const check = (running) => {
      if (!running) {
        let changed = false;
        for (const s of this._sessions.values()) {
          if (s.state !== 'sleep') { s.state = 'sleep'; changed = true; }
        }
        if (changed) this._emitUpdate();
      }
    };
    if (process.platform === 'win32') {
      exec('tasklist /FO CSV /NH', (err, stdout) => {
        if (err) return;
        check(stdout.split('\n').some(l => l.toLowerCase().startsWith('"claude.exe"')));
      });
    } else {
      exec('ps -axo comm=', (err, stdout) => {
        if (err) return;
        check(stdout.split('\n').some(l => l.trim() === 'claude'));
      });
    }
  }

  _checkLogs() {
    for (const f of this._findJsonl(CLAUDE_LOG_DIR)) {
      if (!this._sessions.has(f)) {
        const info = this._buildSessionInfo(f);
        this._sessions.set(f, { ...info, fileSize: 0 });
      }
      const session = this._sessions.get(f);
      try {
        const newSize = this._getSize(f);
        if (newSize > session.fileSize) {
          const len = newSize - session.fileSize;
          const buf = Buffer.alloc(len);
          const fd = fs.openSync(f, 'r');
          fs.readSync(fd, buf, 0, len, session.fileSize);
          fs.closeSync(fd);
          session.fileSize = newSize;
          this._parseChunk(buf.toString(), session);
        }
      } catch {}
    }
  }

  _parseChunk(chunk, session) {
    let changed        = false;
    let batchPermGap   = 0;   // ms gap when tool_use+result arrive in same chunk
    let lastToolUseTs  = null;

    for (const line of chunk.split('\n').filter(l => l.trim())) {
      try {
        session.messageCount = (session.messageCount || 0) + 1;
        const entry = JSON.parse(line);

        // Track whether a tool_use and its tool_result land in the same chunk.
        // Claude Code batches both writes to disk after the user approves, so
        // the monitor never sees tool_use alone. Detect this by timestamp gap.
        if (entry.type === 'assistant') {
          const c = entry.message?.content;
          lastToolUseTs = (Array.isArray(c) && c.some(x => x.type === 'tool_use'))
            ? (entry.timestamp ?? null) : null;
        } else if (entry.type === 'user' && entry.toolUseResult !== undefined) {
          if (lastToolUseTs && entry.timestamp) {
            const gap = new Date(entry.timestamp).getTime() - new Date(lastToolUseTs).getTime();
            if (gap >= 3000) batchPermGap = gap;
          }
          lastToolUseTs = null;
        }

        if (this._handleEntry(entry, session)) changed = true;
      } catch {}
    }

    // Batch-write detected: permission was required but both entries landed
    // together. Show require_action briefly so board/pet reflect what happened,
    // then transition to act after a short hold.
    if (batchPermGap > 0 && session.state === 'act') {
      session.state       = 'require_action';
      session.lastMessage = 'Claude needed your permission';
      this._emitUpdate();

      clearTimeout(session._batchPermTimer);
      session._batchPermTimerId = (session._batchPermTimerId ?? 0) + 1;
      const timerId = session._batchPermTimerId;
      const self = this;
      session._batchPermTimer = setTimeout(() => {
        if (session.state === 'require_action' && session._batchPermTimerId === timerId) {
          session.state       = 'act';
          session.lastMessage = 'Running…';
          session.lastActiveAt = Date.now();
          clearTimeout(session.inactivityTimer);
          session.inactivityTimer = setTimeout(() => {
            session.state = 'sleep'; session.lastMessage = ''; self._emitUpdate();
          }, INACTIVITY_MS);
          self._emitUpdate();
        }
      }, 1500);
      return; // require_action already emitted; act will follow via timer
    }

    if (changed) this._emitUpdate();
  }

  _handleEntry(entry, session) {
    let nextState = null;
    let msg = null;

    if (entry.type === 'assistant') {
      const content = entry.message?.content;
      if (Array.isArray(content)) {
        if (content.some(c => c.type === 'tool_use')) {
          // Debounce 1s: in auto-approve mode the tool_result arrives quickly and
          // cancels this timer before it fires — no false attention flash.
          clearTimeout(session._pendingPermTimer);
          const self = this;
          session._pendingPermTimer = setTimeout(() => {
            session._pendingPermTimer = null;
            if (session.state === 'require_action') return;
            session.state       = 'require_action';
            session.lastMessage = 'Claude needs your permission';
            session.lastActiveAt = Date.now();
            clearTimeout(session.inactivityTimer);
            self._emitUpdate();
          }, 1000);
          return false;
        } else {
          const text = content.find(c => c.type === 'text');
          // Pure text response = Claude finished, waiting for user reply
          nextState = 'replied';
          if (text?.text) msg = text.text.slice(0, 80).replace(/\n/g, ' ') + '…';
        }
      }
    } else if (entry.type === 'user') {
      if (entry.toolUseResult !== undefined) {
        nextState = 'act';
        msg = 'Running…';
      } else {
        const content = entry.message?.content;
        const text = typeof content === 'string' ? content
          : Array.isArray(content) ? content.find(c => c.type === 'text')?.text ?? ''
          : '';
        nextState = 'thinking';
        const clean = text.trim();
        if (clean && !clean.startsWith('<') && !clean.startsWith('This session is being continued')) {
          session.name = clean.slice(0, 40).replace(/\n/g, ' ');
          msg = clean.slice(0, 80).replace(/\n/g, ' ');
        }
      }
    }

    if (!nextState) return false;

    // Cancel any pending require_action debounce — tool ran or state reset
    clearTimeout(session._pendingPermTimer);
    session._pendingPermTimer = null;

    const stateChanged = nextState !== session.state;
    const msgChanged   = msg !== null && msg !== session.lastMessage;

    if (!stateChanged && !msgChanged) return false;

    if (stateChanged) session.state = nextState;
    if (msg !== null) session.lastMessage = msg;
    session.lastActiveAt = Date.now();
    clearTimeout(session.inactivityTimer);
    if (nextState !== 'require_action' && nextState !== 'alert') {
      const ms = nextState === 'replied' ? 30_000 : INACTIVITY_MS;
      session.inactivityTimer = setTimeout(() => {
        session.state = 'sleep';
        session.lastMessage = '';
        this._emitUpdate();
      }, ms);
    }
    return true;
  }

  _buildSessionInfo(filePath) {
    const parts = filePath.split(path.sep);
    const projectDir = parts[parts.length - 2] ?? '';
    const project = projectDir.replace(/^-Users-[^-]+-/, '') || projectDir;
    const id = path.basename(filePath, '.jsonl');

    let createdAt   = null;
    let lastActiveAt = null;
    try {
      const st = fs.statSync(filePath);
      createdAt    = st.birthtimeMs;
      lastActiveAt = st.mtimeMs;
    } catch {}

    // Seed name from the most recent user question, and lastMessage from the most recent entry
    let name        = project.split('/').pop() || 'Session';
    let lastMessage = '';
    let nameDone    = false;
    try {
      const allLines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
      for (const line of allLines.slice(-20).reverse()) {
        try {
          const e = JSON.parse(line);
          if (e.type === 'assistant') {
            const c = e.message?.content;
            if (!lastMessage && Array.isArray(c) && !c.some(x => x.type === 'tool_use')) {
              const t = c.find(x => x.type === 'text');
              if (t?.text) lastMessage = t.text.slice(0, 80).replace(/\n/g, ' ') + '…';
            }
          } else if (e.type === 'user' && e.toolUseResult === undefined) {
            const c = e.message?.content;
            const text = typeof c === 'string' ? c
              : Array.isArray(c) ? (c.find(x => x.type === 'text')?.text ?? '') : '';
            const clean = text.trim();
            if (clean && !clean.startsWith('<') && !clean.startsWith('This session is being continued')) {
              if (!lastMessage) lastMessage = clean.slice(0, 80).replace(/\n/g, ' ');
              if (!nameDone) { name = clean.slice(0, 40).replace(/\n/g, ' '); nameDone = true; }
            }
          }
        } catch {}
        if (lastMessage && nameDone) break;
      }
    } catch {}

    return { id, name, project, state: 'sleep', lastMessage, filePath,
             inactivityTimer: null, _batchPermTimer: null, _batchPermTimerId: 0,
             _pendingPermTimer: null,
             createdAt, lastActiveAt, messageCount: 0 };
  }

  _findJsonl(dir) {
    const out = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...this._findJsonl(full));
        else if (entry.name.endsWith('.jsonl') && !full.includes('/subagents/')) out.push(full);
      }
    } catch {}
    return out;
  }

  _getSize(f) {
    try { return fs.statSync(f).size; } catch { return 0; }
  }

  _emitUpdate() {
    const sessions = this.getSessions();
    this.emit('sessions', sessions);

    // Priority rule:
    //   1. Any session actively running (act / thinking) → working
    //   2. Any session waiting for user (require_action / alert) → require_action
    //   3. Any session just finished → success
    //   4. Otherwise → sleep
    const states = sessions.map(s => s.state);
    let globalState = 'sleep';
    // Priority: attention > working > done > sleep
    // replied = Claude asked/responded, waiting for user → same priority as require_action
    if (states.some(s => s === 'require_action' || s === 'alert')) {
      globalState = 'require_action';
    } else if (states.some(s => s === 'act' || s === 'thinking')) {
      globalState = 'act';
    } else if (states.some(s => s === 'replied' || s === 'success')) {
      globalState = 'success';
    }
    this.emit('state', globalState);
  }
}

module.exports = LocalMonitor;
