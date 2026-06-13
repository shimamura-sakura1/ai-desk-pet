// ============================================================
// CONFIG
// ============================================================
const BORED_DURATION = 5000;
const LONG_PRESS_MS  = 600;
const DRAG_THRESH    = 8;     // px of movement to trigger drag early

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

function _loadClips(resolvedClips) {
  for (const [id, def] of Object.entries(resolvedClips)) {
    const imgs = def.frames.map(src => {
      const img = new Image();
      img.src = src;
      return img;
    });
    _clips[id] = { imgs, fps: def.fps, threePhase: def.threePhase };
  }
}

// ============================================================
// EXTERNAL STATE INPUTS
// ============================================================
let _sessionState     = 'idle';   // idle | answering | finished
let _isDragging       = false;
let _isFinishedLocked = false;
let _isBored          = false;
let _boredTimer       = null;

function _targetState() {
  if (_isDragging)                   return 'drag';
  if (_sessionState === 'answering') return 'working';
  if (_isFinishedLocked)             return 'done';
  if (_isBored)                      return 'bored';
  return 'idle';
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

function _pickClip(stateName) {
  const list = _preset?.states?.[stateName]?.clips ?? [];
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
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

function _enterState(newState) {
  _curState = newState;
  _pending  = null;
  const id  = _pickClip(newState);
  if (!id) return;
  const clip   = _clips[id];
  const phase  = (clip?.threePhase && clip.imgs.length >= 3) ? 'intro' : 'loop';
  _startClip(id, phase);
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
  if (status === 'answering') {
    _isFinishedLocked = false;
    _isBored = false;
    clearTimeout(_boredTimer);
  } else if (status === 'finished') {
    _isFinishedLocked = true;
    _isBored = false;
    clearTimeout(_boredTimer);
  }
}

function _onPetClick() {
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

function _mapBridgeState(s) {
  switch (s) {
    case 'act':
    case 'thinking':      return 'answering';
    case 'require_action':
    case 'alert':
    case 'success':       return 'finished';
    default:              return 'idle';
  }
}

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
  window.petBridge.openSettings();
});

stage.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  _mouseDownX = e.screenX; _mouseDownY = e.screenY;
  _offX = e.screenX - window.screenX;
  _offY = e.screenY - window.screenY;
  _longPressTimer = setTimeout(_beginDrag, LONG_PRESS_MS);
});

window.addEventListener('mousemove', e => {
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

window.petBridge.onStateChange(s => onSessionChange(_mapBridgeState(s)));

window.petBridge.onPresetReload(() => {
  // Reset playback state so engine picks up new clips
  _preset    = null;
  _curClipId = null;
  _curState  = null;
  _pending   = null;
  for (const k of Object.keys(_clips)) delete _clips[k];
  window.petBridge.getPreset().then(p => {
    _preset = p;
    _loadClips(p.resolvedClips);
    _enterState(_targetState());
  });
});

// ============================================================
// INIT
// ============================================================
window.petBridge.getPreset().then(preset => {
  _preset = preset;
  _loadClips(preset.resolvedClips);
  requestAnimationFrame(_tick);
});
