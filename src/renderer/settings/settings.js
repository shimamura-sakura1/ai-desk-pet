const STATE_NAME_MAP = {
  idle:      '待机',
  bored:     '无聊',
  working:   '工作中',
  done:      '工作结束',
  drag:      '拖动',
  attention: '等待回应',
};

let cfg = {};
let _sshCreds = [];   // stored in ~/.ai-desk-pet/credentials.json
let _authType = 'password';

async function load() {
  cfg = await window.settingsBridge.getConfig();
  _sshCreds = await window.settingsBridge.getSSHCreds();

  // One-time migration: move cfg.ssh → credentials store
  if (Array.isArray(cfg.ssh) && cfg.ssh.length && !_sshCreds.length) {
    _sshCreds = cfg.ssh.map(s => ({ ...s, authType: s.authType ?? 'password' }));
    await window.settingsBridge.saveSSHCreds(_sshCreds);
    delete cfg.ssh;
    await window.settingsBridge.saveConfig(cfg);
  } else if (cfg.ssh) {
    // Clean out the old field even if creds already migrated
    delete cfg.ssh;
    await window.settingsBridge.saveConfig(cfg);
  }

  document.getElementById('localLogDir').value = cfg.monitor?.localLogDir ?? '';
  document.getElementById('pollInterval').value = cfg.monitor?.pollIntervalMs ?? 2000;
  document.getElementById('maxSessions').value  = cfg.board?.maxSessions ?? 3;

  // Preset is the source of truth for clipsRootFolder (State Process Editor may have changed it)
  const preset = await window.settingsBridge.getPreset();
  const savedRoot = preset.clipsRootFolder ?? cfg.clipsRootFolder ?? '';
  if (savedRoot) {
    document.getElementById('clipsRoot').value = savedRoot;
    await scanClipsRoot(savedRoot);
  }

  renderSSHList();
}

function renderSSHList() {
  const list = document.getElementById('ssh-list');
  if (!_sshCreds.length) {
    list.innerHTML = '<div style="color:#6c7086;font-size:13px">暂无远程机器</div>';
    return;
  }
  list.innerHTML = _sshCreds.map((s, i) => `
    <div class="ssh-item">
      <div>
        <div class="name">${esc(s.name)}</div>
        <div class="host">${esc(s.username)}@${esc(s.host)}:${s.port ?? 22}
          <span style="margin-left:6px;font-size:11px;color:#6c7086">
            [${s.authType === 'key' ? 'SSH 密钥' : '密码'}]
          </span>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="reconnect" data-i="${i}" style="background:none;border:1px solid #6c7086;color:#a6adc8;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px">重连</button>
        <button class="del" data-i="${i}">×</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.reconnect').forEach(btn => {
    btn.addEventListener('click', async () => {
      setStatus('status-ssh', '重连中…', true);
      const res = await window.settingsBridge.reconnectSSH(Number(btn.dataset.i));
      if (res?.ok) {
        setStatus('status-ssh', '重连成功', true);
      } else if (res?.error === 'timeout') {
        setStatus('status-ssh', '连接超时', false);
      } else {
        setStatus('status-ssh', `重连失败：${res?.error ?? '未知错误'}`, false);
      }
    });
  });

  list.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', async () => {
      _sshCreds.splice(Number(btn.dataset.i), 1);
      await window.settingsBridge.saveSSHCreds(_sshCreds);
      renderSSHList();
    });
  });
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setStatus(id, msg, ok) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status ' + (ok ? 'ok' : 'err');
}

function setAuthType(type) {
  _authType = type;
  document.querySelectorAll('.auth-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.auth === type);
  });
  document.getElementById('auth-password-fields').style.display = type === 'password' ? '' : 'none';
  document.getElementById('auth-key-fields').style.display      = type === 'key'      ? '' : 'none';
}

// Tab 切换
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
  });
});

// 保存监控配置
document.getElementById('btn-save-monitor').addEventListener('click', async () => {
  cfg.monitor = {
    localLogDir:   document.getElementById('localLogDir').value.trim(),
    pollIntervalMs: Number(document.getElementById('pollInterval').value),
  };
  cfg.board = {
    ...cfg.board,
    maxSessions: Math.max(1, Number(document.getElementById('maxSessions').value) || 3),
  };
  await window.settingsBridge.saveConfig(cfg);
  setStatus('status-monitor', '已保存', true);
});

// Auth 类型切换
document.querySelectorAll('.auth-btn').forEach(btn => {
  btn.addEventListener('click', () => setAuthType(btn.dataset.auth));
});

// SSH 测试
document.getElementById('btn-test-ssh').addEventListener('click', async () => {
  setStatus('status-ssh', '连接中…', true);
  const payload = {
    host:     document.getElementById('ssh-host').value,
    port:     Number(document.getElementById('ssh-port').value) || 22,
    username: document.getElementById('ssh-user').value,
    authType: _authType,
  };
  if (_authType === 'key') {
    payload.keyPath    = document.getElementById('ssh-key-path').value;
    payload.passphrase = document.getElementById('ssh-key-pass').value;
  } else {
    payload.password = document.getElementById('ssh-pass').value;
  }
  const res = await window.settingsBridge.testSSH(payload);
  setStatus('status-ssh', res.ok ? '连接成功' : `失败：${res.error}`, res.ok);
});

// SSH 添加
document.getElementById('btn-add-ssh').addEventListener('click', async () => {
  const host     = document.getElementById('ssh-host').value.trim();
  const username = document.getElementById('ssh-user').value.trim();
  if (!host || !username) { setStatus('status-ssh', '请填写 Host 和用户名', false); return; }

  const entry = {
    name:     document.getElementById('ssh-name').value.trim() || host,
    host,
    port:     Number(document.getElementById('ssh-port').value) || 22,
    username,
    authType: _authType,
  };
  if (_authType === 'key') {
    const keyPath = document.getElementById('ssh-key-path').value.trim();
    if (!keyPath) { setStatus('status-ssh', '请选择私钥文件', false); return; }
    entry.keyPath    = keyPath;
    entry.passphrase = document.getElementById('ssh-key-pass').value;
  } else {
    entry.password = document.getElementById('ssh-pass').value;
  }

  _sshCreds.push(entry);
  await window.settingsBridge.saveSSHCreds(_sshCreds);
  renderSSHList();

  // Clear form
  ['ssh-name','ssh-host','ssh-port','ssh-user','ssh-pass','ssh-key-path','ssh-key-pass'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id === 'ssh-port' ? '22' : '';
  });
  setAuthType('password');
  setStatus('status-ssh', '已添加，凭据安全存储在 ~/.ai-desk-pet/', true);
});

// ── 动作设置 ──────────────────────────────────────────────────

let _detectedClips = [];

function mapClipNameToState(name) {
  const lower = name.toLowerCase();
  if (lower === 'idle'      || lower.startsWith('idle-'))      return 'idle';
  if (lower === 'drag'      || lower.startsWith('drag-'))      return 'drag';
  if (lower === 'working'   || lower.startsWith('working-'))   return 'working';
  if (lower === 'done'      || lower.startsWith('done-'))      return 'done';
  if (lower === 'bored'     || lower.startsWith('bored-'))     return 'bored';
  if (lower === 'attention' || lower.startsWith('attention-')) return 'attention';
  return null;
}

async function scanClipsRoot(folder) {
  const subdirs = await window.settingsBridge.scanClipsFolder(folder);
  _detectedClips = subdirs.map(name => ({
    name,
    state: mapClipNameToState(name),
    path: folder + '/' + name,
  }));
  renderClipsPreview();
}

function renderClipsPreview() {
  const preview = document.getElementById('clips-preview');
  if (!_detectedClips.length) { preview.style.display = 'none'; return; }

  const byState = {};
  const unmatched = [];
  for (const c of _detectedClips) {
    if (c.state) {
      const label = STATE_NAME_MAP[c.state] ?? c.state;
      (byState[label] = byState[label] ?? []).push(c.name);
    } else {
      unmatched.push(c.name);
    }
  }

  const rows = Object.entries(byState).map(([label, names]) => `
    <div class="clips-group">
      <span class="state-tag">${label}</span>
      <span class="clips-names">${names.join('、')}</span>
    </div>`).join('');

  const unknownRow = unmatched.length ? `
    <div class="clips-group">
      <span class="state-tag unmatched-tag">未识别</span>
      <span class="clips-names unmatched-tag">${unmatched.join('、')}</span>
    </div>` : '';

  preview.style.display = 'block';
  preview.innerHTML = rows + unknownRow;
}

document.getElementById('btn-browse-root')?.addEventListener('click', async () => {
  const folder = await window.settingsBridge.selectFolder();
  if (!folder) return;
  document.getElementById('clipsRoot').value = folder;
  cfg.clipsRootFolder = folder;
  await scanClipsRoot(folder);
});

document.getElementById('btn-apply-clips')?.addEventListener('click', async () => {
  const folder = document.getElementById('clipsRoot').value;
  if (!folder || !_detectedClips.length) {
    setStatus('status-actions', '请先选择 Clips 根目录', false);
    return;
  }

  const preset = await window.settingsBridge.getPreset();
  delete preset.resolvedClips;

  // Build new root clip set
  const newClipDefs = {};
  const stateClips  = {};
  for (const clip of _detectedClips) {
    newClipDefs[clip.name] = { folder: clip.path, fps: 2.78, threePhase: true };
    if (clip.state) {
      (stateClips[clip.state] = stateClips[clip.state] ?? []).push(clip.name);
    }
  }

  const prevRootIds = new Set(preset.rootClipIds ?? []);
  const rootChanged = !preset.clipsRootFolder || preset.clipsRootFolder !== folder;

  if (rootChanged) {
    // Different root → full reset: wipe all clips (root + custom), start fresh
    preset.clipDefs = { ...newClipDefs };
    for (const state of Object.keys(preset.states ?? {})) {
      preset.states[state].clips = stateClips[state] ?? [];
    }
  } else {
    // Same root → replace root-derived clips, keep user-added custom clips
    const customDefs = {};
    for (const [id, def] of Object.entries(preset.clipDefs ?? {})) {
      if (!prevRootIds.has(id)) customDefs[id] = def;
    }
    preset.clipDefs = { ...customDefs, ...newClipDefs };

    for (const state of Object.keys(preset.states ?? {})) {
      const customInState = (preset.states[state].clips ?? []).filter(c => !prevRootIds.has(c));
      preset.states[state].clips = [...customInState, ...(stateClips[state] ?? [])];
    }
  }

  // Record which clip IDs came from this root scan
  preset.rootClipIds     = Object.keys(newClipDefs);
  preset.clipsRootFolder = folder;

  await window.settingsBridge.savePreset(preset);
  cfg.clipsRootFolder = folder;
  await window.settingsBridge.saveConfig(cfg);
  window.petBridge.applyPreset();
  const base = rootChanged ? '已重置 Clip 库' : '已更新 Clip 库';
  setStatus('status-actions', `✓ ${base}`, true);
  setTimeout(() => setStatus('status-actions', '', true), 8000);
  alert(`${base} — 成功！\n\n请打开 State Process Editor，点击右上角「应用执行」使 Clip 更改立即生效。`);
});

document.getElementById('btn-open-editor')?.addEventListener('click', () => {
  window.petBridge.openStateEditor();
});

load();
