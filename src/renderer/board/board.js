let maxSessions = 3;
let expandedId   = null;
let _lastSessions = [];

// ── Utilities ───────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function relTime(ms) {
  if (!ms) return null;
  const d = Date.now() - ms;
  if (d < 60_000)        return '刚刚';
  if (d < 3_600_000)     return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000)    return `${Math.floor(d / 3_600_000)} 小时前`;
  if (d < 2_592_000_000) return `${Math.floor(d / 86_400_000)} 天前`;
  return `${Math.floor(d / 2_592_000_000)} 个月前`;
}

function durStr(startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return null;
  const d = endMs - startMs;
  if (d < 60_000)    return '< 1 分钟';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟`;
  const h = Math.floor(d / 3_600_000);
  const m = Math.floor((d % 3_600_000) / 60_000);
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

function stateInfo(state) {
  switch (state) {
    case 'require_action': return { cls: 'alert',    dot: 'dot-alert'    };
    case 'thinking':       return { cls: 'thinking', dot: 'dot-thinking' };
    case 'act':            return { cls: 'active',   dot: 'dot-active'   };
    case 'replied':        return { cls: 'done',     dot: 'dot-done'     };
    case 'success':        return { cls: 'done',     dot: 'dot-done'     };
    default:               return { cls: 'sleep',    dot: 'dot-sleep'    };
  }
}

function sortSessions(sessions) {
  const rank = { require_action: 3, thinking: 2, act: 2, replied: 1, success: 1, sleep: 0 };
  return [...sessions].sort((a, b) => {
    const dr = (rank[b.state] ?? 0) - (rank[a.state] ?? 0);
    if (dr !== 0) return dr;
    return (b.lastActiveAt ?? b.createdAt ?? 0) - (a.lastActiveAt ?? a.createdAt ?? 0);
  });
}

// ── Card builder ────────────────────────────────────────────────

function buildCard(s, isExpanded) {
  const info        = stateInfo(s.state);
  const isSSH       = s.source === 'ssh';
  const sourceLabel = isSSH ? (s.sourceLabel || 'SSH') : 'LOCAL';
  const sourceCls   = isSSH ? 'source-ssh' : 'source-local';

  // ── Collapsed header row ──────────────────────────────────────
  const header = `
    <div class="card-row">
      <span class="dot ${info.dot}"></span>
      <span class="source-badge ${sourceCls}">${esc(sourceLabel)}</span>
      <span class="card-project">${esc(s.project || s.name)}</span>
      <span class="card-badge">Claude Code</span>
      <svg class="card-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>`;

  if (!isExpanded) return `
    <div class="card card-${info.cls}" data-id="${esc(s.id)}" role="button" tabindex="0">
      ${header}
    </div>`;

  // ── Expanded detail section ───────────────────────────────────
  const longIdle   = s.lastActiveAt && (Date.now() - s.lastActiveAt > 2 * 3_600_000);
  const startTime  = relTime(s.createdAt);
  const dur        = durStr(s.createdAt, s.lastActiveAt ?? s.createdAt);
  const lastActive = s.state === 'sleep' ? relTime(s.lastActiveAt) : null;

  const chips = [];
  if (startTime)  chips.push(`<span class="time-chip">开始 ${startTime}</span>`);
  if (dur)        chips.push(`<span class="time-sep">·</span><span class="time-chip">持续 ${dur}</span>`);
  if (lastActive) chips.push(`<span class="time-sep">·</span>`
    + `<span class="time-chip${longIdle ? ' time-warn' : ''}">活跃 ${lastActive}</span>`);

  const nameLine  = (s.project && s.name !== s.project)
    ? `<div class="detail-name">${esc(s.name)}</div>` : '';
  const msgLine   = s.lastMessage
    ? `<div class="detail-msg">${esc(s.lastMessage)}</div>` : '';
  const timeLine  = chips.length
    ? `<div class="detail-time">${chips.join('')}</div>` : '';
  const actionBanner = s.state === 'require_action' ? `
    <div class="detail-action">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 1.5L10.5 9.5H1.5L6 1.5Z" stroke="currentColor"
              stroke-width="1.3" stroke-linejoin="round" fill="none"/>
        <line x1="6" y1="4.5" x2="6" y2="7" stroke="currentColor"
              stroke-width="1.3" stroke-linecap="round"/>
        <circle cx="6" cy="8.2" r="0.65" fill="currentColor"/>
      </svg>
      Claude 需要你的授权
    </div>`
  : s.state === 'replied' ? `
    <div class="detail-action detail-action-reply">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 9.5L5 6.5L2 3.5M6.5 9.5h3.5" stroke="currentColor"
              stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Claude 已完成，等待下一步指令
    </div>` : '';
  const openBtn = s.filePath ? `
    <button class="detail-open"
      data-filepath="${esc(s.filePath)}"
      data-source="${esc(s.source ?? 'local')}"
      data-sid="${esc(s.id)}">打开项目</button>` : '';

  const chatBtn = (s.filePath && s.source !== 'ssh') ? `
    <button class="detail-chat"
      data-filepath="${esc(s.filePath)}"
      data-source="${esc(s.source ?? 'local')}"
      data-sid="${esc(s.id)}"
      data-agent="${esc(s.agent ?? 'claude-cli')}">跳转到聊天</button>` : '';

  const actionBtns = (openBtn || chatBtn) ? `
    <div class="detail-actions">${chatBtn}${openBtn}</div>` : '';

  return `
    <div class="card card-${info.cls} expanded" data-id="${esc(s.id)}" role="button" tabindex="0">
      ${header}
      <div class="card-detail">
        ${nameLine}${msgLine}${timeLine}${actionBanner}${actionBtns}
      </div>
    </div>`;
}

// ── Height calculation ───────────────────────────────────────────
//  collapsed card: 44px  |  card gap: 6px  |  container padding: 16px
//  expanded extra:  ~100px (name+msg+time+btn)  +30px if action banner

function calcHeight(visible) {
  const COLLAPSED  = 44;
  const GAP        = 6;
  const PADDING    = 16;
  const HEADER     = 38;   // drag header bar height
  const EXP_BASE   = 96;
  const EXP_ACTION = 30;

  let h = PADDING + HEADER + visible.length * COLLAPSED + Math.max(0, visible.length - 1) * GAP;
  const exp = visible.find(s => s.id === expandedId);
  if (exp) {
    h += EXP_BASE;
    if (exp.state === 'require_action' || exp.state === 'replied') h += EXP_ACTION;
    if (exp.filePath) h += 0; // already in EXP_BASE estimate
  }
  return Math.max(60, Math.min(520, h));
}

// ── Render ──────────────────────────────────────────────────────

function render(sessions) {
  _lastSessions = sessions;
  const list  = document.getElementById('card-list');
  const empty = document.getElementById('empty-state');

  const visible = sortSessions(sessions).slice(0, maxSessions);

  if (visible.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    document.getElementById('app').classList.remove('has-alert');
    window.petBridge.boardResize(72);
    return;
  }
  empty.classList.add('hidden');

  // Invalidate expandedId if that session is no longer visible
  if (expandedId && !visible.find(s => s.id === expandedId)) expandedId = null;

  list.innerHTML = visible.map(s => buildCard(s, s.id === expandedId)).join('');

  const hasAlert = visible.some(s => s.state === 'require_action');
  document.getElementById('app').classList.toggle('has-alert', hasAlert);

  // Card click: toggle expand (collapse if same, expand if different)
  for (const card of list.querySelectorAll('.card')) {
    card.addEventListener('click', e => {
      if (e.target.closest('.detail-open')) return; // let open-btn handle it
      expandedId = expandedId === card.dataset.id ? null : card.dataset.id;
      render(_lastSessions);
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        expandedId = expandedId === card.dataset.id ? null : card.dataset.id;
        render(_lastSessions);
      }
    });
  }

  // "跳转到项目" + "跳转到聊天" buttons
  for (const btn of list.querySelectorAll('.detail-open')) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      window.petBridge.openProject({
        filePath:  btn.dataset.filepath,
        source:    btn.dataset.source,
        sessionId: btn.dataset.sid,
      });
    });
  }
  for (const btn of list.querySelectorAll('.detail-chat')) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      window.petBridge.openChat({
        filePath:  btn.dataset.filepath,
        source:    btn.dataset.source,
        sessionId: btn.dataset.sid,
        agent:     btn.dataset.agent,
      });
    });
  }

  window.petBridge.boardResize(calcHeight(visible));
}

// ── Detected agents chip ─────────────────────────────────────────

function renderAgents(agents) {
  const chip = document.getElementById('agents-chip');
  if (!chip) return;
  if (!agents || !agents.length) { chip.classList.add('hidden'); return; }
  const labels = agents.map(a => {
    const map = {
      'claude-cli':  'Claude CLI',
      'codex-cli':   'Codex CLI',
      'claude-desk': 'Claude Desk',
      'codex-desk':  'Codex Desk',
    };
    return map[a] || a;
  });
  chip.textContent = '运行中：' + labels.join('、');
  chip.classList.remove('hidden');
}

function closeBoard() {
  window.close();
}

// ── Init ────────────────────────────────────────────────────────

window.petBridge.getUserConfig().then(cfg => {
  maxSessions = cfg?.board?.maxSessions ?? 3;
});

document.getElementById('board-close')?.addEventListener('click', closeBoard);
window.petBridge.onSessionsUpdate(sessions => render(sessions));
window.petBridge.onAgentsUpdate?.(agents => renderAgents(agents));
