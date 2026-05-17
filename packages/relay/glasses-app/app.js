import { consumeUrlPairing } from './pairing.js';
import { connect } from './relay-ws.js';

const els = {
  status: document.getElementById('status-text'),
  talkBtn: document.getElementById('talk-btn'),
  talkBtnLabel: document.getElementById('talk-btn-label'),
  transcript: document.getElementById('transcript'),
  screenMain: document.getElementById('screen-main'),
  screenNotPaired: document.getElementById('screen-not-paired'),
};

const state = {
  paired: null,
  relay: null,
  recording: false,
  focusables: [],
  focusIndex: 0,
};

function setStatus(text) {
  els.status.textContent = text;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function appendTurn(kind, text) {
  const div = document.createElement('div');
  div.className = `turn turn-${kind}`;
  const label = document.createElement('span');
  label.className = 'turn-label';
  label.textContent = kind === 'you' ? 'you' : 'claude';
  const body = document.createElement('div');
  body.textContent = text;
  div.appendChild(label);
  div.appendChild(body);
  els.transcript.appendChild(div);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function setRecording(on, label) {
  state.recording = on;
  els.talkBtn.classList.toggle('recording', on);
  els.talkBtnLabel.textContent = label ?? (on ? 'Asked phone to listen…' : 'Tap to talk');
}

// D-pad: Up/Down toggles focus between talk button and transcript.
function rebuildFocusables() {
  state.focusables = [els.talkBtn, els.transcript];
  state.focusIndex = 0;
  applyFocus();
}

function applyFocus() {
  state.focusables.forEach((el, i) => {
    el.classList.toggle('focused', i === state.focusIndex);
  });
  state.focusables[state.focusIndex]?.focus();
}

function moveFocus(delta) {
  const next = (state.focusIndex + delta + state.focusables.length) % state.focusables.length;
  state.focusIndex = next;
  applyFocus();
}

document.addEventListener('keydown', (e) => {
  if (state.focusables.length === 0) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    moveFocus(-1);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    moveFocus(1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    if (state.focusables[state.focusIndex] === els.talkBtn) {
      e.preventDefault();
      handleTalkPress();
    }
  } else if (e.key === 'Escape' || e.key === 'Backspace') {
    state.focusIndex = 0;
    applyFocus();
  }
});

els.talkBtn.addEventListener('click', handleTalkPress);

// Plan 5: hands-free trigger. Tapping the talk button (EMG, D-pad Enter, or
// click) sends a trigger_record control message; the phone receives it and
// runs the SR pipeline. Local Web Speech API is unavailable on the Display
// browser, so we don't attempt it.
function handleTalkPress() {
  if (!state.relay) {
    setStatus('not connected');
    return;
  }
  if (state.recording) return;  // ignore re-press while phone is recording
  state.relay.send({ type: 'trigger_record' });
  setRecording(true);
}

// Boot.
(async () => {
  setStatus('initializing…');
  const paired = await consumeUrlPairing();
  if (!paired || paired.error) {
    showScreen('screen-not-paired');
    setStatus(paired?.error ?? 'not paired');
    return;
  }
  state.paired = paired;
  showScreen('screen-main');
  rebuildFocusables();

  state.relay = connect({
    paired,
    onStatus: setStatus,
    onMessage: (obj) => {
      // Any decrypted msg from a peer means our trigger landed and the phone
      // is doing its job (or has finished). Reset the recording UI.
      if (state.recording) setRecording(false);
      if (obj.type === 'prompt' && typeof obj.text === 'string') {
        appendTurn('you', obj.text);
      } else if (obj.type === 'reply' && typeof obj.text === 'string') {
        appendTurn('claude', obj.text);
      }
    },
  });
})();
