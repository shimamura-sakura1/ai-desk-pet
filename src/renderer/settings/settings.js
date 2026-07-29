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

  // Optical-flow frame interpolation
  const of = cfg.pet?.opticFlow ?? { enabled: false, factor: 2, quality: 'balanced' };
  document.getElementById('of-enabled').checked = !!of.enabled;
  document.getElementById('of-factor').value = String(of.factor ?? 2);
  document.getElementById('of-quality').value = of.quality ?? 'balanced';

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

// ── 光流补帧设置 ──────────────────────────────────────────────
document.getElementById('btn-apply-of')?.addEventListener('click', async () => {
  cfg.pet = cfg.pet ?? {};
  cfg.pet.opticFlow = {
    enabled: document.getElementById('of-enabled').checked,
    factor:  Number(document.getElementById('of-factor').value) || 2,
    quality: document.getElementById('of-quality').value || 'balanced',
  };
  await window.settingsBridge.saveConfig(cfg);
  window.petBridge.applyPreset(); // reload pet window with new interpolation config
  setStatus('status-of', '已应用，桌宠正在重载…', true);
  setTimeout(() => setStatus('status-of', '', true), 6000);
});

// ── 导入角色（一键导入）────────────────────────────────────────────
const IMPORT_COLS = 7;
let _importImg = null;   // HTMLImageElement of the uploaded sprite sheet

function initImportCharacter() {
  const pickBtn   = document.getElementById('btn-pick-img');
  const fileInput = document.getElementById('charImage');
  const rowCount  = document.getElementById('rowCount');

  pickBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        _importImg = img;
        const rows = clampRows(Number(rowCount.value) || 6);
        rowCount.value = rows;
        updateImgInfo(rows);
        document.getElementById('importPreview').style.display = 'block';
        renderImportPreview();
        renderRowMapping();
      };
      img.onerror = () => setStatus('status-import', '图片加载失败', false);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  rowCount?.addEventListener('change', () => {
    const rows = clampRows(Number(rowCount.value) || 6);
    rowCount.value = rows;
    if (_importImg) {
      updateImgInfo(rows);
      renderImportPreview();
      renderRowMapping();
    }
  });

  document.getElementById('btn-import-char')?.addEventListener('click', doImportCharacter);
}

function clampRows(n) {
  return Math.max(1, Math.min(20, n || 1));
}

function updateImgInfo(rows) {
  if (!_importImg) return;
  const fw = Math.round(_importImg.width / IMPORT_COLS);
  const fh = Math.round(_importImg.height / rows);
  document.getElementById('imgInfo').textContent =
    `图片 ${_importImg.width}×${_importImg.height}px · 每帧约 ${fw}×${fh}px`;
}

function renderImportPreview() {
  const canvas = document.getElementById('importCanvas');
  if (!canvas || !_importImg) return;
  const ctx = canvas.getContext('2d');
  const maxW = 360;
  const scale = Math.min(1, maxW / _importImg.width);
  const w = Math.round(_importImg.width * scale);
  const h = Math.round(_importImg.height * scale);
  canvas.width = w; canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(_importImg, 0, 0, w, h);

  const rows = Number(document.getElementById('rowCount').value) || 6;
  ctx.strokeStyle = 'rgba(203,166,247,0.7)';
  ctx.lineWidth = 1;
  for (let c = 1; c < IMPORT_COLS; c++) {
    const x = (c / IMPORT_COLS) * w;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    const y = (r / rows) * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function renderRowMapping() {
  const container = document.getElementById('rowMapping');
  if (!container || !_importImg) return;
  const rows   = Number(document.getElementById('rowCount').value) || 6;
  const states = ['idle', 'bored', 'working', 'done', 'drag', 'attention'];
  container.innerHTML = '';
  for (let r = 0; r < rows; r++) {
    const def = states[r % states.length];
    const item = document.createElement('div');
    item.className = 'row-map-item';
    item.innerHTML = `
      <span class="row-label">第 ${r + 1} 行</span>
      <select data-row="${r}">
        ${states.map(s => `<option value="${s}" ${s === def ? 'selected' : ''}>${STATE_NAME_MAP[s] ?? s}（${s}）</option>`).join('')}
      </select>`;
    container.appendChild(item);
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload  = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function doImportCharacter() {
  if (!_importImg) { setStatus('status-import', '请先选择角色图片', false); return; }
  const name = document.getElementById('petName').value.trim();
  if (!name) { setStatus('status-import', '请填写宠物名称', false); return; }

  const rows   = Number(document.getElementById('rowCount').value) || 6;
  const selects = [...document.querySelectorAll('#rowMapping select')];

  setStatus('status-import', '切割中…', true);
  const imgW = _importImg.width, imgH = _importImg.height;
  const cellW = imgW / IMPORT_COLS, cellH = imgH / rows;

  const payloadRows = [];
  for (let r = 0; r < rows; r++) {
    const state  = selects[r]?.value || 'idle';
    const frames = [];
    for (let c = 0; c < IMPORT_COLS; c++) {
      const cw = Math.max(1, Math.round(cellW));
      const ch = Math.max(1, Math.round(cellH));
      const off = document.createElement('canvas');
      off.width = cw; off.height = ch;
      const octx = off.getContext('2d');
      octx.clearRect(0, 0, cw, ch);
      octx.drawImage(_importImg, c * cellW, r * cellH, cellW, cellH, 0, 0, cw, ch);
      const blob = await new Promise(res => off.toBlob(res, 'image/png'));
      if (!blob) continue;
      frames.push(await blobToDataURL(blob));
    }
    payloadRows.push({ state, frames });
  }

  const result = await window.settingsBridge.importCharacter({ name, rows: payloadRows });
  if (result?.ok) {
    setStatus('status-import', `✓ 已导入「${name}」并切换为当前角色，桌宠正在重载…`, true);
    setTimeout(() => setStatus('status-import', '', true), 8000);
  } else {
    setStatus('status-import', `导入失败：${result?.error ?? '未知错误'}`, false);
  }
}

load();
initImportCharacter();
