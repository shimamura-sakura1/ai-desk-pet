const { Client } = require('ssh2');
const EventEmitter = require('events');
const fs = require('fs');

const REMOTE_LOG_DIR = '.claude/projects';
const INACTIVITY_MS  = 180000;

class SSHMonitor extends EventEmitter {
  constructor(config) {
    // config: { name, host, port, username, authType, password?, keyPath?, passphrase? }
    super();
    this._config    = config;
    this._client    = null;
    this._pollTimer = null;
    this._connected = false;
    this._sessions  = new Map(); // remotePath → session object
  }

  connect() {
    this._client = new Client();

    this._client.on('ready', () => {
      this._connected = true;
      this.emit('connected', this._config.host);
      this._initSessions(() => this._startPolling());
    });

    this._client.on('error', err => {
      this._connected = false;
      this.emit('error', err.message);
    });

    this._client.on('end', () => {
      this._connected = false;
      this._stopPolling();
      this.emit('disconnected');
    });

    const opts = {
      host:     this._config.host,
      port:     this._config.port ?? 22,
      username: this._config.username,
    };
    if (this._config.authType === 'key' && this._config.keyPath) {
      try { opts.privateKey = fs.readFileSync(this._config.keyPath); } catch {}
      if (this._config.passphrase) opts.passphrase = this._config.passphrase;
    } else {
      opts.password = this._config.password ?? '';
    }

    this._client.connect(opts);
  }

  disconnect() {
    this._stopPolling();
    if (this._client) this._client.end();
  }

  getSessions() {
    return Array.from(this._sessions.values()).map(s => ({
      id:           s.id,
      name:         s.name,
      project:      s.project,
      state:        s.state,
      lastMessage:  s.lastMessage,
      filePath:     s.filePath,
      createdAt:    s.createdAt,
      lastActiveAt: s.lastActiveAt,
      messageCount: s.messageCount,
      source:       'ssh',
      sourceLabel:  this._config.name || this._config.host,
    }));
  }

  // ── private ────────────────────────────────────────────────

  _exec(cmd, cb) {
    if (!this._connected || !this._client) return;
    this._client.exec(cmd, (err, stream) => {
      if (err) { cb(''); return; }
      let out = '';
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', () => {});
      stream.on('close', () => cb(out));
    });
  }

  _startPolling(intervalMs = 3000) {
    this._poll();
    this._pollTimer = setInterval(() => this._poll(), intervalMs);
  }

  _stopPolling() {
    clearInterval(this._pollTimer);
  }

  _findJsonlFiles(cb) {
    this._exec(
      `find "${REMOTE_LOG_DIR}" -name "*.jsonl" 2>/dev/null | grep -v "/subagents/"`,
      out => cb(out.split('\n').map(l => l.trim()).filter(l => l.endsWith('.jsonl')))
    );
  }

  _initSessions(done) {
    this._findJsonlFiles(files => {
      if (!files.length) { done?.(); return; }
      let pending = files.length;
      for (const f of files) {
        this._exec(`wc -c < "${f}" 2>/dev/null`, szOut => {
          const size = parseInt(szOut.trim()) || 0;
          if (!this._sessions.has(f)) {
            this._sessions.set(f, this._newSession(f, size));
          }
          if (--pending === 0) { this._emitUpdate(); done?.(); }
        });
      }
    });
  }

  _poll() {
    if (!this._connected) return;
    this._checkProcess();
    this._findJsonlFiles(files => {
      for (const f of files) {
        if (!this._sessions.has(f)) this._sessions.set(f, this._newSession(f, 0));
        this._checkFileGrowth(f);
      }
    });
  }

  _checkProcess() {
    this._exec('ps -axo comm= | grep -c "[c]laude" 2>/dev/null || echo 0', out => {
      if ((parseInt(out.trim()) || 0) > 0) return;
      let changed = false;
      for (const s of this._sessions.values()) {
        if (s.state !== 'sleep') { s.state = 'sleep'; changed = true; }
      }
      if (changed) this._emitUpdate();
    });
  }

  _checkFileGrowth(filePath) {
    const session = this._sessions.get(filePath);
    if (!session) return;
    this._exec(`wc -c < "${filePath}" 2>/dev/null`, szOut => {
      const newSize = parseInt(szOut.trim()) || 0;
      if (newSize <= session.fileSize) return;
      const delta = newSize - session.fileSize;
      this._exec(`tail -c ${delta} "${filePath}"`, chunk => {
        session.fileSize = newSize;
        this._parseChunk(chunk, session);
      });
    });
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
    let msg       = null;

    if (entry.type === 'assistant') {
      const content = entry.message?.content;
      if (Array.isArray(content)) {
        if (content.some(c => c.type === 'tool_use')) {
          nextState = 'require_action';
          msg       = 'Claude needs your permission';
        } else {
          nextState = 'replied';
          const text = content.find(c => c.type === 'text');
          if (text?.text) msg = text.text.slice(0, 80).replace(/\n/g, ' ') + '…';
        }
      }
    } else if (entry.type === 'user') {
      if (entry.toolUseResult !== undefined) {
        nextState = 'act';
        msg       = 'Running…';
      } else {
        const content = entry.message?.content;
        const text = typeof content === 'string' ? content
          : Array.isArray(content) ? (content.find(c => c.type === 'text')?.text ?? '') : '';
        nextState = 'thinking';
        const clean = text.trim();
        if (clean && !clean.startsWith('<')) {
          if (session.name === session.project) session.name = clean.slice(0, 40);
          msg = clean.slice(0, 80).replace(/\n/g, ' ');
        }
      }
    }

    if (!nextState) return false;
    const stateChanged = nextState !== session.state;
    const msgChanged   = msg !== null && msg !== session.lastMessage;
    if (!stateChanged && !msgChanged) return false;
    if (stateChanged) session.state = nextState;
    if (msg !== null) session.lastMessage = msg;
    session.lastActiveAt = Date.now();
    clearTimeout(session.inactivityTimer);
    session.inactivityTimer = setTimeout(() => {
      session.state = 'sleep';
      this._emitUpdate();
    }, INACTIVITY_MS);
    return true;
  }

  _newSession(filePath, fileSize) {
    const parts   = filePath.split('/');
    const dirName = parts[parts.length - 2] ?? '';
    const project = dirName.replace(/^-[^-]+-[^-]+-/, '') || dirName;
    return {
      id:              `${this._config.host}:${filePath}`,
      name:            project || 'Session',
      project,
      state:           'sleep',
      lastMessage:     '',
      filePath,
      fileSize,
      createdAt:       Date.now(),
      lastActiveAt:    null,
      messageCount:    0,
      inactivityTimer: null,
    };
  }

  _emitUpdate() {
    const sessions = this.getSessions();
    this.emit('sessions', sessions);

    const states = sessions.map(s => s.state);
    let globalState = 'sleep';
    if (states.some(s => s === 'require_action' || s === 'alert')) globalState = 'require_action';
    else if (states.some(s => s === 'act' || s === 'thinking')) globalState = 'act';
    else if (states.some(s => s === 'replied' || s === 'success')) globalState = 'success';
    this.emit('state', globalState);
  }
}

module.exports = SSHMonitor;
