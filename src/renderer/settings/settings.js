const DEFAULT_ACTIONS = [
  { id: 'idle',    name: '待机'         },
  { id: 'bored',   name: '无聊'         },
  { id: 'working', name: '工作中'       },
  { id: 'done',    name: '工作结束'     },
  { id: 'drag',    name: '鼠标点击拖动' },
];

let cfg = {};

async function load() {
  cfg = await window.settingsBridge.getConfig();

  document.getElementById('localLogDir').value = cfg.monitor?.localLogDir ?? '';
  document.getElementById('pollInterval').value = cfg.monitor?.pollIntervalMs ?? 2000;
  document.getElementById('pet-size').value = cfg.pet?.size ?? 120;
  document.getElementById('pet-skin').value = cfg.pet?.activePet ?? 'default';

  // Merge saved actions with defaults (preserve order & folder from cfg)
  const saved = cfg.actions ?? [];
  cfg.actions = DEFAULT_ACTIONS.map(def => {
    const found = saved.find(a => a.id === def.id);
    return { ...def, folder: found?.folder ?? '' };
  });
  renderActions();
  renderSSHList();
}

function renderSSHList() {
  const list = document.getElementById('ssh-list');
  const items = cfg.ssh ?? [];
  if (!items.length) { list.innerHTML = '<div style="color:#6c7086;font-size:13px">暂无远程机器</div>'; return; }
  list.innerHTML = items.map((s, i) => `
    <div class="ssh-item">
      <div><div class="name">${s.name}</div><div class="host">${s.username}@${s.host}:${s.port??22}</div></div>
      <button class="del" data-i="${i}">×</button>
    </div>
  `).join('');

  list.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => {
      cfg.ssh.splice(Number(btn.dataset.i), 1);
      renderSSHList();
    });
  });
}

function setStatus(id, msg, ok) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status ' + (ok ? 'ok' : 'err');
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
    localLogDir: document.getElementById('localLogDir').value.trim(),
    pollIntervalMs: Number(document.getElementById('pollInterval').value),
  };
  await window.settingsBridge.saveConfig(cfg);
  setStatus('status-monitor', '已保存', true);
});

// SSH 测试
document.getElementById('btn-test-ssh').addEventListener('click', async () => {
  setStatus('status-ssh', '连接中…', true);
  const res = await window.settingsBridge.testSSH({
    host: document.getElementById('ssh-host').value,
    port: Number(document.getElementById('ssh-port').value) || 22,
    username: document.getElementById('ssh-user').value,
    password: document.getElementById('ssh-pass').value,
  });
  setStatus('status-ssh', res.ok ? '连接成功' : `失败：${res.error}`, res.ok);
});

// SSH 添加
document.getElementById('btn-add-ssh').addEventListener('click', async () => {
  const entry = {
    name: document.getElementById('ssh-name').value || 'Server',
    host: document.getElementById('ssh-host').value,
    port: Number(document.getElementById('ssh-port').value) || 22,
    username: document.getElementById('ssh-user').value,
    password: document.getElementById('ssh-pass').value,
  };
  if (!entry.host || !entry.username) { setStatus('status-ssh', '请填写 Host 和用户名', false); return; }
  cfg.ssh = cfg.ssh ?? [];
  cfg.ssh.push(entry);
  await window.settingsBridge.saveConfig(cfg);
  renderSSHList();
  setStatus('status-ssh', '已添加', true);
});

// 保存桌宠设置
document.getElementById('btn-save-pet').addEventListener('click', async () => {
  cfg.pet = {
    activePet: document.getElementById('pet-skin').value,
    size: Number(document.getElementById('pet-size').value),
  };
  await window.settingsBridge.saveConfig(cfg);
});

// ── 动作设置 ──────────────────────────────────────────────────

function renderActions() {
  const list = document.getElementById('action-list');
  if (!list) return;
  const actions = cfg.actions ?? [];

  list.innerHTML = actions.map((a, i) => `
    <div class="action-row" data-idx="${i}">
      <div class="action-header">
        <div class="action-order-btns">
          <button class="btn-order" data-dir="-1" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn-order" data-dir="1"  data-idx="${i}" ${i === actions.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <span class="action-name-tag">${a.name}</span>
      </div>
      <div class="action-path-row">
        <input type="text" readonly placeholder="未设置 — 使用内置默认帧"
               value="${a.folder ? a.folder.replace(/</g,'&lt;') : ''}">
        <button class="btn btn-secondary btn-browse" data-idx="${i}">选择文件夹</button>
        ${a.folder ? `<button class="action-path-clear" data-idx="${i}" title="清除">×</button>` : ''}
      </div>
    </div>
  `).join('');

  // 上下移动
  list.querySelectorAll('.btn-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      const dir = Number(btn.dataset.dir);
      const arr = cfg.actions;
      if (idx + dir < 0 || idx + dir >= arr.length) return;
      [arr[idx], arr[idx + dir]] = [arr[idx + dir], arr[idx]];
      renderActions();
    });
  });

  // 选择文件夹
  list.querySelectorAll('.btn-browse').forEach(btn => {
    btn.addEventListener('click', async () => {
      const path = await window.settingsBridge.selectFolder();
      if (path) {
        cfg.actions[Number(btn.dataset.idx)].folder = path;
        renderActions();
      }
    });
  });

  // 清除路径
  list.querySelectorAll('.action-path-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      cfg.actions[Number(btn.dataset.idx)].folder = '';
      renderActions();
    });
  });
}

document.getElementById('btn-save-actions')?.addEventListener('click', async () => {
  await window.settingsBridge.saveConfig(cfg);
  setStatus('status-actions', '已保存', true);
  setTimeout(() => setStatus('status-actions', '', true), 2000);
});

document.getElementById('btn-open-editor')?.addEventListener('click', () => {
  window.petBridge.openStateEditor();
});

load();
