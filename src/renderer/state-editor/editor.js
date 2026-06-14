// ── Constants ─────────────────────────────────────────────────

const STATE_COLORS = {
  idle:    { bg: 'rgba(74,222,128,0.07)',  border: '#4ade80', text: '#4ade80'  },
  bored:   { bg: 'rgba(168,85,247,0.07)', border: '#a855f7', text: '#a855f7'  },
  working: { bg: 'rgba(96,165,250,0.07)', border: '#60a5fa', text: '#60a5fa'  },
  done:    { bg: 'rgba(251,146,60,0.07)', border: '#fb923c', text: '#fb923c'  },
  drag:    { bg: 'rgba(248,113,113,0.07)',border: '#f87171', text: '#f87171'  },
};

const STATE_LABELS = {
  idle:    '待机  IDLE',
  bored:   '无聊  BORED',
  working: '工作中  WORKING',
  done:    '工作结束  DONE',
  drag:    '拖动  DRAG',
};

// CORE_STATES and FIXED_TRANSITIONS are loaded from ../../lib/graph.js

const CUSTOM_COLORS = [
  { bg: 'rgba(129,140,248,0.07)', border: '#818cf8', text: '#818cf8' },
  { bg: 'rgba(52,211,153,0.07)',  border: '#34d399', text: '#34d399' },
  { bg: 'rgba(251,113,133,0.07)', border: '#fb7185', text: '#fb7185' },
  { bg: 'rgba(251,191,36,0.07)',  border: '#fbbf24', text: '#fbbf24' },
  { bg: 'rgba(167,139,250,0.07)', border: '#a78bfa', text: '#a78bfa' },
];

const EDGE_COLORS = ['#818cf8', '#34d399', '#fb7185', '#fbbf24', '#a78bfa'];

const NODE_W = 200;

// ── State ─────────────────────────────────────────────────────

let preset = null;
let selectedKey = null;   // 'clipId' (selected in lib or on node)
let selectedState = null; // stateId the selected clip belongs to
let _dragging = null;     // { stateId, startMX, startMY, startX, startY }
let _openDrop = null;     // active dropdown element
let _helpOpen = false;

const canvas     = document.getElementById('canvas');
const svgEl      = document.getElementById('svg-arrows');
const statusBar  = document.getElementById('status-bar');
const propSect   = document.getElementById('prop-section');

// ── Utilities ─────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function nodeHeight(stateId) {
  const clips = preset?.states?.[stateId]?.clips ?? [];
  return 37 + clips.length * 33 + 37 + (CORE_STATES.includes(stateId) ? 0 : 34);
}

function nodeBox(stateId) {
  const lay = preset?.layout?.[stateId] ?? { x: 100, y: 100 };
  return { x: lay.x, y: lay.y, w: NODE_W, h: nodeHeight(stateId) };
}

function status(msg, ok = true) {
  statusBar.textContent = msg;
  statusBar.style.color = ok ? '#4ade80' : '#f87171';
  clearTimeout(status._t);
  status._t = setTimeout(() => { statusBar.textContent = ''; statusBar.style.color = ''; }, 2500);
}

function closeDrop() {
  if (_openDrop) { _openDrop.remove(); _openDrop = null; }
}

// canReachTarget and autoCompleteGraph are loaded from ../../lib/graph.js

function runAutoComplete() {
  if (!preset) return;
  preset.transitions = autoCompleteGraph(
    Object.keys(preset.states ?? {}),
    [...FIXED_TRANSITIONS, ...(preset.transitions ?? [])],
    [...(preset.transitions ?? [])],
  );
  renderAll();
}

// ── Render ────────────────────────────────────────────────────

function renderAll() {
  renderNodes();
  renderArrows();
  renderLibrary();
  renderProps();
}

function renderNodes() {
  canvas.querySelectorAll('.state-node').forEach(n => n.remove());
  closeDrop();

  const customKeys = Object.keys(preset.states ?? {}).filter(k => !CORE_STATES.includes(k));

  for (const [sid, stateDef] of Object.entries(preset.states ?? {})) {
    const lay      = preset.layout?.[sid] ?? { x: 100, y: 100 };
    const isCustom = !CORE_STATES.includes(sid);
    const customIdx = isCustom ? customKeys.indexOf(sid) : 0;
    const colors   = STATE_COLORS[sid] ?? CUSTOM_COLORS[customIdx % CUSTOM_COLORS.length];
    const clips    = stateDef.clips ?? [];

    const node = document.createElement('div');
    node.className = 'state-node';
    node.dataset.state = sid;
    node.style.cssText = [
      `left:${lay.x}px`, `top:${lay.y}px`,
      `background:${colors.bg}`, `border-color:${colors.border}`,
    ].join(';');

    const clipRows = clips.map((cid, i) => {
      const sel = (selectedKey === cid && selectedState === sid) ? ' selected' : '';
      return `
        <div class="clip-item${sel}" data-sid="${sid}" data-cid="${esc(cid)}" data-idx="${i}">
          <span class="clip-dot" style="background:${colors.text}"></span>
          <span class="clip-name" title="${esc(cid)}">${esc(cid)}</span>
          <button class="clip-remove" data-sid="${sid}" data-idx="${i}"
                  title="移除">×</button>
        </div>`;
    }).join('');

    const headerInner = isCustom
      ? `<span style="color:${colors.text}">${esc(STATE_LABELS[sid] ?? sid)}</span>
         <button class="node-delete-btn" data-sid="${esc(sid)}" title="删除状态">×</button>`
      : `<span style="color:${colors.text}">${STATE_LABELS[sid] ?? sid}</span>`;

    const headerStyle = isCustom
      ? 'display:flex;justify-content:space-between;align-items:center'
      : '';

    // Show connect button on all nodes (core nodes use it to connect to custom states)
    const allEdgesNow = [...FIXED_TRANSITIONS, ...(preset.transitions ?? [])];
    const alreadyOut  = new Set(allEdgesNow.filter(e => e.from === sid).map(e => e.to));
    const hasTargets  = Object.keys(preset.states ?? {}).some(
      id => id !== sid && !alreadyOut.has(id)
    );

    node.innerHTML = `
      <div class="node-header" style="${headerStyle}">${headerInner}</div>
      <div class="node-clips">${clipRows}</div>
      <button class="node-add" data-sid="${sid}">+ 添加 Clip</button>
      ${hasTargets ? `<button class="node-connect-btn" data-sid="${esc(sid)}">→ 连接至…</button>` : ''}`;

    canvas.appendChild(node);

    // Drag header
    node.querySelector('.node-header').addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.target.classList.contains('node-delete-btn')) return;
      e.preventDefault();
      const cur = preset.layout?.[sid] ?? { x: 100, y: 100 };
      _dragging = {
        stateId: sid,
        startMX: e.clientX, startMY: e.clientY,
        startX: cur.x, startY: cur.y,
      };
    });

    // Select clip
    node.querySelectorAll('.clip-item').forEach(el => {
      el.addEventListener('click', ev => {
        if (ev.target.classList.contains('clip-remove')) return;
        selectedKey   = el.dataset.cid;
        selectedState = el.dataset.sid;
        renderNodes();
        renderProps();
      });
    });

    // Remove clip
    node.querySelectorAll('.clip-remove').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const { sid: s, idx } = btn.dataset;
        preset.states[s].clips.splice(Number(idx), 1);
        if (selectedState === s && selectedKey === preset.states[s].clips[idx]) {
          selectedKey = null; selectedState = null;
        }
        renderAll();
      });
    });

    // Add clip dropdown
    node.querySelector('.node-add').addEventListener('click', ev => {
      ev.stopPropagation();
      showDropdown(sid, node.querySelector('.node-add'));
    });

    // Connect button (present on any node that has connectable targets)
    node.querySelector('.node-connect-btn')?.addEventListener('click', ev => {
      ev.stopPropagation();
      showConnectDropdown(sid, node.querySelector('.node-connect-btn'));
    });

    if (isCustom) {
      // Delete this custom state
      node.querySelector('.node-delete-btn').addEventListener('click', ev => {
        ev.stopPropagation();
        if (!confirm(`确定要删除状态 "${sid}" 吗？`)) return;
        delete preset.states[sid];
        delete preset.layout[sid];
        preset.transitions = (preset.transitions ?? []).filter(
          t => t.from !== sid && t.to !== sid
        );
        if (selectedState === sid) { selectedKey = null; selectedState = null; }
        runAutoComplete();
        status(`已删除状态: ${sid}`);
      });
    }
  }
}

function showDropdown(sid, anchor) {
  closeDrop();

  const existing  = preset.states[sid]?.clips ?? [];
  const available = Object.keys(preset.clipDefs ?? {}).filter(id => !existing.includes(id));

  const rect   = anchor.getBoundingClientRect();
  const wrRect = document.getElementById('canvas-wrapper').getBoundingClientRect();

  const drop = document.createElement('div');
  drop.className = 'clip-dropdown';

  const dropLeft = Math.min(rect.left - wrRect.left, wrRect.width - 180);
  const dropTop  = rect.bottom - wrRect.top + document.getElementById('canvas-wrapper').scrollTop + 4;
  drop.style.cssText = `left:${dropLeft}px;top:${dropTop}px`;

  if (available.length === 0) {
    drop.innerHTML = `<div class="clip-dd-empty">暂无可用 Clip</div>`;
  } else {
    drop.innerHTML = available.map(id =>
      `<div class="clip-dd-item" data-cid="${esc(id)}">${esc(id)}</div>`
    ).join('');
    drop.querySelectorAll('.clip-dd-item').forEach(item => {
      item.addEventListener('click', () => {
        preset.states[sid].clips.push(item.dataset.cid);
        closeDrop();
        renderAll();
      });
    });
  }

  document.getElementById('canvas-wrapper').appendChild(drop);
  _openDrop = drop;
}

function showConnectDropdown(sid, anchor) {
  closeDrop();

  const allEdges = [...FIXED_TRANSITIONS, ...(preset.transitions ?? [])];
  const alreadyConnected = new Set(allEdges.filter(e => e.from === sid).map(e => e.to));
  const available = Object.keys(preset.states ?? {}).filter(
    id => id !== sid && !alreadyConnected.has(id)
  );

  const rect   = anchor.getBoundingClientRect();
  const wrRect = document.getElementById('canvas-wrapper').getBoundingClientRect();

  const drop = document.createElement('div');
  drop.className = 'clip-dropdown';

  const dropLeft = Math.min(rect.left - wrRect.left, wrRect.width - 180);
  const dropTop  = rect.bottom - wrRect.top + document.getElementById('canvas-wrapper').scrollTop + 4;
  drop.style.cssText = `left:${dropLeft}px;top:${dropTop}px`;

  if (available.length === 0) {
    drop.innerHTML = `<div class="clip-dd-empty">已全部连接</div>`;
  } else {
    drop.innerHTML = available.map(id =>
      `<div class="clip-dd-item" data-tid="${esc(id)}">${esc(STATE_LABELS[id] ?? id)}</div>`
    ).join('');
    drop.querySelectorAll('.clip-dd-item').forEach(item => {
      item.addEventListener('click', () => {
        preset.transitions.push({ from: sid, to: item.dataset.tid, label: '' });
        closeDrop();
        runAutoComplete();
      });
    });
  }

  document.getElementById('canvas-wrapper').appendChild(drop);
  _openDrop = drop;
}

function ensureMarker(color) {
  const id = 'arr-end-' + color.replace('#', '');
  if (!svgEl.getElementById(id)) {
    let defs = svgEl.querySelector('defs');
    if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svgEl.prepend(defs); }
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.id = id;
    marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '7'); marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0 0, 8 3, 0 6'); poly.setAttribute('fill', color);
    marker.appendChild(poly); defs.appendChild(marker);
  }
  return id;
}

function renderArrows() {
  svgEl.querySelectorAll('.arr').forEach(e => e.remove());
  document.querySelectorAll('.custom-edge-delete').forEach(el => el.remove());

  // Size svg to match canvas
  const cw = canvas.offsetWidth  || 840;
  const ch = canvas.offsetHeight || 540;
  svgEl.setAttribute('width',  cw);
  svgEl.setAttribute('height', ch);

  for (const t of FIXED_TRANSITIONS) {
    const fb = nodeBox(t.from);
    const tb = nodeBox(t.to);

    const fCx = fb.x + fb.w / 2, fCy = fb.y + fb.h / 2;
    const tCx = tb.x + tb.w / 2, tCy = tb.y + tb.h / 2;
    const dx = tCx - fCx, dy = tCy - fCy;

    let x1, y1, x2, y2;
    if (Math.abs(dx) >= Math.abs(dy)) {
      // Horizontal connect
      if (dx > 0) { x1 = fb.x + fb.w; y1 = fCy; x2 = tb.x;        y2 = tCy; }
      else         { x1 = fb.x;        y1 = fCy; x2 = tb.x + tb.w; y2 = tCy; }
    } else {
      // Vertical connect
      if (dy > 0) { x1 = fCx; y1 = fb.y + fb.h; x2 = tCx; y2 = tb.y; }
      else         { x1 = fCx; y1 = fb.y;         x2 = tCx; y2 = tb.y + tb.h; }
    }

    // Cubic bezier
    const cpx1 = x1 + dx * 0.4, cpy1 = y1;
    const cpx2 = x2 - dx * 0.4, cpy2 = y2;

    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.classList.add('arr');
    p.setAttribute('d', `M${x1} ${y1} C${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x2} ${y2}`);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'rgba(255,255,255,0.15)');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-dasharray', '5 4');
    p.setAttribute('marker-end', 'url(#arr-end)');
    if (t.bidir) p.setAttribute('marker-start', 'url(#arr-start)');
    svgEl.appendChild(p);

    // Label at midpoint
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 7;
    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl.classList.add('arr');
    lbl.setAttribute('x', mx);
    lbl.setAttribute('y', my);
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('fill', 'rgba(255,255,255,0.15)');
    lbl.setAttribute('font-size', '9.5');
    lbl.setAttribute('font-family', '-apple-system, PingFang SC, sans-serif');
    lbl.textContent = t.label ?? '';
    svgEl.appendChild(lbl);
  }

  // ── Custom transitions ───────────────────────────────────────
  const wrapper = document.getElementById('canvas-wrapper');

  for (let i = 0; i < (preset.transitions ?? []).length; i++) {
    const t = preset.transitions[i];
    if (!preset.states?.[t.from] || !preset.states?.[t.to]) continue;

    const fb = nodeBox(t.from);
    const tb = nodeBox(t.to);
    const fCx = fb.x + fb.w / 2, fCy = fb.y + fb.h / 2;
    const tCx = tb.x + tb.w / 2, tCy = tb.y + tb.h / 2;
    const dx = tCx - fCx, dy = tCy - fCy;

    let x1, y1, x2, y2;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx > 0) { x1 = fb.x + fb.w; y1 = fCy; x2 = tb.x;        y2 = tCy; }
      else         { x1 = fb.x;        y1 = fCy; x2 = tb.x + tb.w; y2 = tCy; }
    } else {
      if (dy > 0) { x1 = fCx; y1 = fb.y + fb.h; x2 = tCx; y2 = tb.y; }
      else         { x1 = fCx; y1 = fb.y;         x2 = tCx; y2 = tb.y + tb.h; }
    }

    const cpx1 = x1 + dx * 0.4, cpy1 = y1;
    const cpx2 = x2 - dx * 0.4, cpy2 = y2;

    const isAuto = !!t.auto;
    const color  = isAuto ? '#fbbf24' : EDGE_COLORS[i % EDGE_COLORS.length];
    const mid    = ensureMarker(color);

    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.classList.add('arr');
    p.setAttribute('d', `M${x1} ${y1} C${cpx1} ${cpy1} ${cpx2} ${cpy2} ${x2} ${y2}`);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-dasharray', isAuto ? '5 4' : 'none');
    p.setAttribute('marker-end', `url(#${mid})`);
    svgEl.appendChild(p);

    const mx2 = (x1 + x2) / 2, my2 = (y1 + y2) / 2 - 7;
    const lbl2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl2.classList.add('arr');
    lbl2.setAttribute('x', mx2); lbl2.setAttribute('y', my2);
    lbl2.setAttribute('text-anchor', 'middle');
    lbl2.setAttribute('fill', color);
    lbl2.setAttribute('font-size', '9.5');
    lbl2.setAttribute('font-family', '-apple-system, PingFang SC, sans-serif');
    lbl2.textContent = t.label ?? '';
    svgEl.appendChild(lbl2);

    if (!isAuto) {
      const btn = document.createElement('button');
      btn.className = 'custom-edge-delete';
      btn.textContent = '×';
      btn.dataset.from = t.from;
      btn.dataset.to   = t.to;
      btn.style.left = (mx2 - 9) + 'px';
      btn.style.top  = (my2 + 2 + wrapper.scrollTop) + 'px';
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const { from, to } = btn.dataset;
        preset.transitions = preset.transitions.filter(
          tr => !(tr.from === from && tr.to === to)
        );
        runAutoComplete();
      });
      wrapper.appendChild(btn);
    }
  }
}

function renderLibrary() {
  const list = document.getElementById('lib-list');
  const defs = Object.entries(preset?.clipDefs ?? {});
  if (defs.length === 0) {
    list.innerHTML = `<div class="lib-empty">暂无 Clip 定义</div>`;
    return;
  }
  list.innerHTML = defs.map(([id, def]) => {
    const sel = (selectedKey === id && selectedState === null) ? ' lib-clip-selected' : '';
    return `
      <div class="lib-clip${sel}" data-cid="${esc(id)}" style="cursor:pointer">
        <div class="lib-clip-id">${esc(id)}</div>
        <div class="lib-clip-meta">fps ${def.fps} · ${def.threePhase ? '三段式' : '循环'}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.lib-clip').forEach(el => {
    el.addEventListener('click', () => {
      selectedKey   = el.dataset.cid;
      selectedState = null;
      // Deselect any node-level selection and refresh library highlight
      renderNodes();
      renderLibrary();
      renderProps();
    });
  });
}

function renderProps() {
  if (!selectedKey || !preset?.clipDefs?.[selectedKey]) {
    propSect.classList.add('hidden');
    return;
  }
  propSect.classList.remove('hidden');
  document.getElementById('prop-clip-id').textContent = selectedKey;

  const def = preset.clipDefs[selectedKey];
  document.getElementById('prop-fps').value       = def.fps ?? 2.78;
  document.getElementById('prop-threephase').checked = !!def.threePhase;
}

// ── Node drag ─────────────────────────────────────────────────

window.addEventListener('mousemove', e => {
  if (!_dragging) return;
  const dx = e.clientX - _dragging.startMX;
  const dy = e.clientY - _dragging.startMY;
  const nx = Math.max(0, _dragging.startX + dx);
  const ny = Math.max(0, _dragging.startY + dy);
  if (!preset.layout) preset.layout = {};
  preset.layout[_dragging.stateId] = { x: nx, y: ny };

  const node = canvas.querySelector(`.state-node[data-state="${_dragging.stateId}"]`);
  if (node) { node.style.left = nx + 'px'; node.style.top = ny + 'px'; }
  renderArrows();
});

window.addEventListener('mouseup', () => { _dragging = null; });

window.addEventListener('click', e => {
  if (_openDrop && !_openDrop.contains(e.target)) closeDrop();
  if (_helpOpen && !document.getElementById('help-tooltip').contains(e.target)
                && !document.getElementById('btn-help').contains(e.target)) {
    _helpOpen = false;
    document.getElementById('help-tooltip').classList.add('hidden');
  }
});

// ── Property changes ──────────────────────────────────────────

document.getElementById('prop-fps').addEventListener('input', e => {
  if (!selectedKey || !preset.clipDefs[selectedKey]) return;
  preset.clipDefs[selectedKey].fps = parseFloat(e.target.value) || 2.78;
  renderLibrary();
});

document.getElementById('prop-threephase').addEventListener('change', e => {
  if (!selectedKey || !preset.clipDefs[selectedKey]) return;
  preset.clipDefs[selectedKey].threePhase = e.target.checked;
  renderLibrary();
});

// ── Help tooltip ──────────────────────────────────────────────

document.getElementById('btn-help').addEventListener('click', ev => {
  ev.stopPropagation();
  _helpOpen = !_helpOpen;
  document.getElementById('help-tooltip').classList.toggle('hidden', !_helpOpen);
});

// ── Add custom state ──────────────────────────────────────────

document.getElementById('btn-add-state').addEventListener('click', () => {
  const form = document.getElementById('add-state-form');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) {
    document.getElementById('add-state-input').focus();
  }
});

function doAddState() {
  const input = document.getElementById('add-state-input');
  const sid   = input.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!sid) { status('状态名无效', false); return; }
  if (preset.states[sid]) { status('状态名已存在', false); return; }
  preset.states[sid] = { clips: [], mode: 'random' };
  const customCount = Object.keys(preset.states).filter(k => !CORE_STATES.includes(k)).length;
  preset.layout[sid] = { x: 80 + customCount * 30, y: 280 + customCount * 40 };
  input.value = '';
  document.getElementById('add-state-form').classList.add('hidden');
  runAutoComplete();
  status(`已添加状态: ${sid}`);
}

document.getElementById('add-state-confirm').addEventListener('click', doAddState);
document.getElementById('add-state-input').addEventListener('keydown', e => {
  if (e.key === 'Enter')  doAddState();
  if (e.key === 'Escape') document.getElementById('add-state-form').classList.add('hidden');
});

// ── Add custom clip ───────────────────────────────────────────

document.getElementById('btn-add-clip').addEventListener('click', async () => {
  const folder = await window.petBridge.selectFolder();
  if (!folder) return;

  let clipId = folder.split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'clip';
  const base = clipId;
  let n = 1;
  while (preset.clipDefs[clipId]) clipId = `${base}-${++n}`;

  preset.clipDefs[clipId] = { folder, fps: 2.78, threePhase: true };
  selectedKey = clipId;
  selectedState = null;
  renderAll();
  status(`已添加 Clip: ${clipId}`);
});

// ── Toolbar actions ───────────────────────────────────────────

function cleanPreset(p) {
  const copy = JSON.parse(JSON.stringify(p));
  delete copy.resolvedClips;
  return copy;
}

document.getElementById('btn-save').addEventListener('click', async () => {
  await window.petBridge.savePreset(cleanPreset(preset));
  status('预设已保存');
});

document.getElementById('btn-export').addEventListener('click', async () => {
  const ok = await window.petBridge.exportPreset(cleanPreset(preset));
  if (ok) status('预设已导出');
});

document.getElementById('btn-import').addEventListener('click', async () => {
  const imported = await window.petBridge.importPreset();
  if (!imported) return;
  preset = imported;
  preset.transitions = preset.transitions ?? [];
  selectedKey = null; selectedState = null;
  renderAll();
  status('预设已导入');
});

document.getElementById('btn-apply').addEventListener('click', async () => {
  await window.petBridge.savePreset(cleanPreset(preset));
  window.petBridge.applyPreset();
  status('已应用，宠物动画正在更新…');
});

// ── Init ─────────────────────────────────────────────────────

window.petBridge.getPreset().then(p => {
  preset = p;
  preset.transitions = preset.transitions ?? [];
  renderAll();
});
