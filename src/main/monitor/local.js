const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const EventEmitter = require('events');

const CLAUDE_LOG_DIR = path.join(os.homedir(), '.claude', 'projects');
const INACTIVITY_MS = 30000;

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
    this._sessions.forEach(s => clearTimeout(s.inactivityTimer));
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
    this._checkLogs();
  }

  _checkProcesses() {
    exec('ps -axo comm=', (err, stdout) => {
      if (err) return;
      const running = stdout.split('\n').some(l => l.trim() === 'claude');
      if (!running) {
        let changed = false;
        for (const s of this._sessions.values()) {
          if (s.state !== 'sleep') { s.state = 'sleep'; changed = true; }
        }
        if (changed) this._emitUpdate();
      }
    });
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
    let changed = false;
    for (const line of chunk.split('\n').filter(l => l.trim())) {
      try {
        session.messageCount = (session.messageCount || 0) + 1;
        if (this._handleEntry(JSON.parse(line), session)) changed = true;
      } catch {}
    }
    if (changed) this._emitUpdate();
  }

  _handleEntry(entry, session) {
    let nextState = null;
    let msg = session.lastMessage;

    if (entry.type === 'assistant') {
      const content = entry.message?.content;
      if (Array.isArray(content)) {
        if (content.some(c => c.type === 'tool_use')) {
          nextState = 'require_action';
          msg = 'Claude needs your permission';
        } else {
          const text = content.find(c => c.type === 'text');
          nextState = 'act';
          if (text?.text) msg = text.text.slice(0, 60).replace(/\n/g, ' ') + '…';
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
        if (clean && !clean.startsWith('<')) {
          if (session.name === 'Session') session.name = clean.slice(0, 40);
          msg = clean.slice(0, 60).replace(/\n/g, ' ');
        }
      }
    }

    if (nextState && nextState !== session.state) {
      session.state = nextState;
      session.lastMessage = msg;
      session.lastActiveAt = Date.now();
      clearTimeout(session.inactivityTimer);
      session.inactivityTimer = setTimeout(() => {
        session.state = 'sleep';
        session.lastMessage = '';
        this._emitUpdate();
      }, INACTIVITY_MS);
      return true;
    }
    return false;
  }

  _buildSessionInfo(filePath) {
    const parts = filePath.split(path.sep);
    const projectDir = parts[parts.length - 2] ?? '';
    const project = projectDir.replace(/^-Users-[^-]+-/, '') || projectDir;
    const id = path.basename(filePath, '.jsonl');

    // 尝试从日志读取第一条用户消息作为名称
    let name = project.split('/').pop() || 'Session';
    try {
      const first = fs.readFileSync(filePath, 'utf8').split('\n').slice(0, 20);
      for (const line of first) {
        try {
          const e = JSON.parse(line);
          if (e.type === 'user' && e.toolUseResult === undefined) {
            const c = e.message?.content;
            const text = typeof c === 'string' ? c
              : Array.isArray(c) ? c.find(x => x.type === 'text')?.text ?? '' : '';
            const clean = text.trim();
            // 跳过系统注入的 XML 标签行（如 <local-command-caveat>）
            if (clean && !clean.startsWith('<')) {
              name = clean.slice(0, 40).replace(/\n/g, ' ');
              break;
            }
          }
        } catch {}
      }
    } catch {}

    let createdAt = null;
    try { createdAt = fs.statSync(filePath).birthtimeMs; } catch {}

    return { id, name, project, state: 'sleep', lastMessage: '', filePath,
             inactivityTimer: null, createdAt, lastActiveAt: null, messageCount: 0 };
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
    if (states.some(s => s === 'act' || s === 'thinking')) {
      globalState = 'act';
    } else if (states.some(s => s === 'require_action' || s === 'alert')) {
      globalState = 'require_action';
    } else if (states.some(s => s === 'success')) {
      globalState = 'success';
    }
    this.emit('state', globalState);
  }
}

module.exports = LocalMonitor;
