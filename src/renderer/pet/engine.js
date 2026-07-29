// ============================================================
// CONFIG
// ============================================================
const BORED_DURATION = 5000;
const LONG_PRESS_MS  = 600;
const DRAG_THRESH    = 8;     // px of movement to trigger drag early
const DONE_CYCLES    = 3;

// ============================================================
// DOM  ── dual img crossfade (prevents transparent-window flicker)
// ============================================================
const petA = document.getElementById('petA');
const petB = document.getElementById('petB');
let _active    = petA;
let _standby   = petB;
let _inFade    = false;

function _crossfade(src, onDone) {
  _inFade = true;
  _standby.src = src;
  const finish = () => {
    _standby.style.opacity = '1';
    _active.style.opacity  = '0';
    [_active, _standby] = [_standby, _active];
    _inFade = false;
    onDone?.();
  };
  if (_standby.complete && _standby.naturalWidth > 0) finish();
  else { _standby.onload = () => { _standby.onload = null; finish(); }; }
}

// ============================================================
// PRESET & CLIPS
// ============================================================
let _preset = null;
// _clips[id] = { imgs: [Image...], fps: number, threePhase: boolean }
const _clips = {};
// Optical-flow frame interpolation config (from user.json → cfg.pet.opticFlow)
let _opticFlowCfg = { enabled: false, factor: 2, quality: 'balanced' };

function _decodeImg(img) {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  if (img.decode) return img.decode().catch(() => {});
  return new Promise(res => { img.onload = () => res(); img.onerror = () => res(); });
}

async function _loadClips(resolvedClips, opticFlowCfg) {
  for (const [id, def] of Object.entries(resolvedClips)) {
    const imgs = def.frames.map(src => {
      const img = new Image();
      img.src = src;
      return img;
    });
    let threePhase = def.threePhase;
    const useOF = opticFlowCfg?.enabled && (opticFlowCfg.factor || 1) > 1 && imgs.length > 1 && window.opticalFlow;
    if (useOF) {
      try {
        const expanded = await window.opticalFlow.buildInterpolatedImages(imgs, opticFlowCfg);
        if (expanded && expanded.length > imgs.length) {
          imgs.length = 0;
          imgs.push(...expanded);
          threePhase = false; // interpolated frames form a continuous loop; drop intro/outro split
        }
      } catch (e) {
        console.warn('[optic-flow] interpolation failed, using original frames:', e);
      }
    }
    _clips[id] = { imgs, fps: def.fps, threePhase };
  }
}

// ============================================================
// EXTERNAL STATE INPUTS
// ============================================================
let _sessionState      = 'idle';   // idle | answering | attention | finished
let _isDragging        = false;
let _isFinishedLocked  = false;
let _isAttentionLocked = false;
let _isBored           = false;
let _boredTimer        = null;
let _doneTimer         = null;

function _targetState() {
  if (_debugState) return _debugState;
  return targetState({
    isDragging:        _isDragging,
    sessionState:      _sessionState,
    isFinishedLocked:  _isFinishedLocked,
    isAttentionLocked: _isAttentionLocked,
    isBored:           _isBored,
  });
}

// ============================================================
// PLAYBACK STATE
// ============================================================
let _curState    = null;
let _curClipId   = null;
let _phase       = 'loop';  // 'intro' | 'loop' | 'outro'
let _frameIdx    = 0;
let _lastFrameTs = 0;
let _pending     = null;    // state to enter after current outro

// ============================================================
// DEBUG STATE OVERRIDE
// ============================================================
let _isDebugPet  = false;  // true when this window is the isolated debug preview
let _debugState  = null;   // when set, overrides normal state machine
let _debugClipId = null;   // when set via forceClip, plays a single specific clip
let _debugSeqIdx = 0;      // which clip to play next (sequential)
let _debugTimer  = null;

function _debugScheduleNext() {
  clearTimeout(_debugTimer);
  if (!_debugState) return;
  const clips = _preset?.states?.[_debugState]?.clips ?? [];
  if (clips.length === 0) return;
  const clipId = clips[_debugSeqIdx % clips.length];
  const clip   = _clips[clipId];
  const cycleDuration = clip
    ? Math.max(1500, Math.min((clip.imgs.length / clip.fps) * 1000 * 2, 5000))
    : 2000;
  _debugTimer = setTimeout(_debugAdvance, cycleDuration);
}

function _debugAdvance() {
  if (!_debugState) return;
  const clips = _preset?.states?.[_debugState]?.clips ?? [];
  if (clips.length === 0) return;

  _debugSeqIdx = (_debugSeqIdx + 1) % clips.length;

  // Trigger outro then re-enter, or switch immediately
  _pending = _debugState;
  if (_curClipId && _phase === 'loop') {
    const clip = _clips[_curClipId];
    const N    = clip?.imgs.length ?? 0;
    if (clip?.threePhase && N >= 3) {
      _phase       = 'outro';
      _frameIdx    = N - 1;
      _lastFrameTs = performance.now();
    } else {
      _enterState(_debugState);
    }
  } else {
    _enterState(_debugState);
  }
  _debugScheduleNext();
}

function _pickClip(stateName) {
  return pickClip({
    stateName,
    states: _preset?.states,
    debugState: _debugState,
    debugClipId: _debugClipId,
    debugSeqIdx: _debugSeqIdx,
  });
}

function _startClip(clipId, initPhase) {
  const clip = _clips[clipId];
  if (!clip?.imgs.length) return;
  _crossfade(clip.imgs[0].src, () => {
    _curClipId   = clipId;
    _phase       = initPhase;
    _frameIdx    = 0;
    _lastFrameTs = performance.now();
  });
}

function _scheduleDoneExit(clipId) {
  clearTimeout(_doneTimer);
  const clip = _clips[clipId];
  if (!clip) return;
  const N = clip.imgs.length;
  const loopFrames = clip.threePhase ? Math.max(1, N - 2) : N;
  const ms = Math.min((loopFrames / clip.fps) * 1000 * DONE_CYCLES, 30_000);
  _doneTimer = setTimeout(() => {
    if (_isFinishedLocked) {
      _isFinishedLocked = false;
      window.petBridge.notifyDoneComplete();
    }
  }, Math.max(ms, 2000));
}

function _enterState(newState) {
  _curState = newState;
  _pending  = null;
  const id  = _pickClip(newState);
  if (!id) return;
  const clip   = _clips[id];
  const phase  = (clip?.threePhase && clip.imgs.length >= 3) ? 'intro' : 'loop';
  _startClip(id, phase);
  if (newState === 'done') _scheduleDoneExit(id);
  else clearTimeout(_doneTimer);
}

// ============================================================
// RENDER LOOP
// ============================================================
function _tick(ts) {
  if (!_lastFrameTs) _lastFrameTs = ts;

  if (!_inFade && _curClipId) {
    const clip = _clips[_curClipId];
    if (clip) {
      const N          = clip.imgs.length;
      const msPerFrame = 1000 / clip.fps;
      const target     = _targetState();

      // ── State transition ──────────────────────────────────
      if (target !== _curState) {
        if (target === 'drag') {
          // Drag always interrupts immediately
          _enterState('drag');
        } else if (_phase === 'loop') {
          // Finish via outro if clip supports it, otherwise switch now
          _pending = target;
          if (clip.threePhase && N >= 3) {
            _phase       = 'outro';
            _frameIdx    = N - 1;
            _active.src  = clip.imgs[N - 1].src;
            _lastFrameTs = ts;
          } else {
            _enterState(target);
          }
        } else {
          // Already in intro/outro — just update pending destination
          _pending = target;
        }
      }

      // ── Frame advance ─────────────────────────────────────
      if (!_inFade && ts - _lastFrameTs >= msPerFrame) {
        _lastFrameTs += msPerFrame;
        // Catch up if we've fallen very far behind
        if (ts - _lastFrameTs > msPerFrame * 3) _lastFrameTs = ts;

        switch (_phase) {
          case 'intro':
            // Frame 0 was the intro — advance to loop
            _phase    = 'loop';
            _frameIdx = 1;
            _active.src = clip.imgs[Math.min(1, N - 1)].src;
            break;

          case 'loop': {
            const loopStart = clip.threePhase ? 1 : 0;
            const loopEnd   = clip.threePhase ? Math.max(1, N - 2) : N - 1;
            _frameIdx = (_frameIdx >= loopEnd) ? loopStart : _frameIdx + 1;
            _active.src = clip.imgs[_frameIdx].src;
            break;
          }

          case 'outro':
            // Outro frame played — now switch
            _enterState(_pending ?? _targetState());
            break;
        }
      }
    }
  } else if (!_inFade && !_curClipId && _preset) {
    // Nothing playing yet — start
    _enterState(_targetState());
  }

  requestAnimationFrame(_tick);
}

// ============================================================
// PUBLIC API  (called by state machine & mouse events)
// ============================================================
function onDragStart() { _isDragging = true; }
function onDragEnd()   { _isDragging = false; }

function onSessionChange(status) {
  _sessionState = status;
  // Always clear transient timers first; individual branches re-arm as needed.
  clearTimeout(_boredTimer);
  clearTimeout(_doneTimer);
  if (status === 'answering') {
    _isFinishedLocked  = false;
    _isAttentionLocked = false;
    _isBored = false;
  } else if (status === 'attention') {
    _isAttentionLocked = true;
    _isFinishedLocked  = false;
    _isBored = false;
  } else if (status === 'finished') {
    _isAttentionLocked = false;
    _isFinishedLocked  = true;
    _isBored = false;
  } else if (status === 'idle') {
    _isAttentionLocked = false;
    _isFinishedLocked  = false;
  }
}

function _onPetClick() {
  if (_isAttentionLocked) {
    return; // attention 只由授权完成解锁，点击宠物不能解除
  }
  if (_isFinishedLocked) {
    _isFinishedLocked = false;
    return;
  }
  if (_curState === 'idle' && !_isBored) {
    _isBored = true;
    clearTimeout(_boredTimer);
    _boredTimer = setTimeout(() => { _isBored = false; }, BORED_DURATION);
  }
}

// mapBridgeState loaded from ../../lib/pet-state.js

// ============================================================
// MOUSE EVENTS  ── long press = drag, short click = board
// ============================================================
const stage = document.getElementById('stage');
let _mouseDownX = 0, _mouseDownY = 0, _offX = 0, _offY = 0;
let _longPressTimer = null;

function _beginDrag() {
  clearTimeout(_longPressTimer);
  _longPressTimer = null;
  if (!_isDragging) onDragStart();
}

stage.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!_isDebugPet) window.petBridge.openSettings();
});

stage.addEventListener('mousedown', e => {
  if (_isDebugPet || e.button !== 0) return;
  _mouseDownX = e.screenX; _mouseDownY = e.screenY;
  _offX = e.screenX - window.screenX;
  _offY = e.screenY - window.screenY;
  _longPressTimer = setTimeout(_beginDrag, LONG_PRESS_MS);
});

window.addEventListener('mousemove', e => {
  if (_isDebugPet) return;
  if (_isDragging) {
    window.petBridge.moveTo(e.screenX - _offX, e.screenY - _offY);
    return;
  }
  // If mouse button held and moved beyond threshold → start drag early
  if (_longPressTimer) {
    const dx = Math.abs(e.screenX - _mouseDownX);
    const dy = Math.abs(e.screenY - _mouseDownY);
    if (dx > DRAG_THRESH || dy > DRAG_THRESH) _beginDrag();
  }
});

window.addEventListener('mouseup', () => {
  if (_isDebugPet) return;
  const wasDragging = _isDragging;
  clearTimeout(_longPressTimer);
  _longPressTimer = null;
  if (wasDragging) {
    onDragEnd();
  } else {
    window.petBridge.toggleBoard();
    _onPetClick();
  }
});

window.petBridge.onStateChange(s => {
  if (_isDebugPet) return;
  onSessionChange(mapBridgeState(s));
});

window.petBridge.onInitDebug(() => {
  _isDebugPet = true;
  const lbl = document.getElementById('debug-label');
  if (lbl) { lbl.style.display = 'block'; lbl.textContent = '调试模式'; }
});

window.petBridge.onForceState(state => {
  clearTimeout(_debugTimer);
  _debugClipId = null;
  if (!state) {
    _debugState  = null;
    _debugSeqIdx = 0;
    _curState    = null;
    _enterState(_targetState());
    const lbl = document.getElementById('debug-label');
    if (lbl && _isDebugPet) lbl.textContent = '调试模式';
    return;
  }
  _debugState  = state;
  _debugSeqIdx = 0;
  _curState    = null;
  _enterState(state);
  _debugScheduleNext();
  const lbl = document.getElementById('debug-label');
  if (lbl && _isDebugPet) lbl.textContent = state;
});

window.petBridge.onForceClip(clipId => {
  if (!_clips[clipId]) return;
  clearTimeout(_debugTimer);
  _debugClipId = clipId;
  _debugState  = '__clip__';
  _debugSeqIdx = 0;
  _curState    = null;
  _pending     = null;
  _enterState('__clip__');
  const lbl = document.getElementById('debug-label');
  if (lbl) lbl.textContent = clipId;
});

window.petBridge.onPresetReload(() => {
  // Reset playback state so engine picks up new clips + optic-flow config
  _preset    = null;
  _curClipId = null;
  _curState  = null;
  _pending   = null;
  for (const k of Object.keys(_clips)) delete _clips[k];
  _initEngine();
});

// ============================================================
// INIT
// ============================================================
let _loopStarted = false;

async function _initEngine() {
  const preset = await window.petBridge.getPreset();
  _preset = preset;
  try {
    const cfg = await window.petBridge.getUserConfig();
    _opticFlowCfg = cfg?.pet?.opticFlow ?? _opticFlowCfg;
  } catch {}
  await _loadClips(preset.resolvedClips, _opticFlowCfg);
  _enterState(_targetState());
  if (!_loopStarted) {
    _loopStarted = true;
    requestAnimationFrame(_tick);
  }
}

window.petBridge.getPreset().then(() => _initEngine());
