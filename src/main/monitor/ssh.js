const { Client } = require('ssh2');
const EventEmitter = require('events');

class SSHMonitor extends EventEmitter {
  constructor(config) {
    super();
    // config: { host, port, username, password? privateKey? }
    this._config = config;
    this._client = null;
    this._pollTimer = null;
    this._connected = false;
  }

  connect() {
    this._client = new Client();

    this._client.on('ready', () => {
      this._connected = true;
      this.emit('connected', this._config.host);
      this._startPolling();
    });

    this._client.on('error', (err) => {
      this.emit('state', 'alert');
      this.emit('error', err.message);
    });

    this._client.on('end', () => {
      this._connected = false;
      this._stopPolling();
      this.emit('state', 'alert');
      this.emit('disconnected');
    });

    this._client.connect({
      host: this._config.host,
      port: this._config.port ?? 22,
      username: this._config.username,
      password: this._config.password,
      privateKey: this._config.privateKey,
    });
  }

  disconnect() {
    this._stopPolling();
    if (this._client) this._client.end();
  }

  _startPolling(intervalMs = 3000) {
    this._poll();
    this._pollTimer = setInterval(() => this._poll(), intervalMs);
  }

  _stopPolling() {
    clearInterval(this._pollTimer);
  }

  _poll() {
    if (!this._connected) return;
    this._exec('ps aux | grep -E "[c]laude" | grep -v grep', (out) => {
      this.emit('state', out.trim() ? 'act' : 'sleep');
    });
  }

  _exec(cmd, cb) {
    this._client.exec(cmd, (err, stream) => {
      if (err) return;
      let out = '';
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', () => {});
      stream.on('close', () => cb(out));
    });
  }
}

module.exports = SSHMonitor;
