// <audio-editor file="..." course="..." module="...">
// Inline audio clip editor. Uses Web Audio API.
//
// Features:
//   - Waveform visualization (canvas)
//   - Play with sweeping cursor line
//   - Click + drag to select a region (or click to set marker)
//   - Cut: removes the selected region
//   - Insert Silence: inserts 1s of silence at the marker/selection start
//   - Save: PUT /api/audio/:course/:module/:file with new WAV data
//
// Dispatches (bubbles, composed):
//   'audio-edited'       { file, duration }  — after a successful save
//   'audio-editor-close'                     — when closed without saving

const STYLES = `
  :host {
    display: block;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 14px 16px;
    margin-top: 8px;
  }

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .editor-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius);
    line-height: 1;
    transition: color 0.1s;
  }
  .close-btn:hover { color: var(--text); }

  /* Waveform canvas */
  .canvas-wrap {
    position: relative;
    width: 100%;
    height: 80px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    cursor: crosshair;
    margin-bottom: 10px;
    background: #0d0d0f;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .selection-overlay {
    position: absolute;
    top: 0;
    height: 100%;
    background: rgba(129, 140, 248, 0.25);
    border-left: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
    pointer-events: none;
  }
  .marker-line {
    position: absolute;
    top: 0;
    height: 100%;
    width: 1px;
    background: var(--accent);
    pointer-events: none;
    display: none;
  }

  /* Tools row */
  .tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
    font-family: var(--font);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .btn:hover:not(:disabled) { border-color: var(--accent); background: var(--surface-raised); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-primary { background: var(--accent-deep); border-color: var(--accent-deep); color: #fff; }
  .btn-primary:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); }

  .btn-danger { border-color: var(--danger); color: var(--danger); }
  .btn-danger:hover:not(:disabled) { background: rgba(248,113,113,0.1); }

  .btn-play-audio {
    padding: 6px 10px;
    min-width: 32px;
    justify-content: center;
  }

  .sel-info {
    font-size: 11px;
    color: var(--text-dim);
    margin-left: auto;
  }

  .status-msg {
    font-size: 11px;
    color: var(--text-dim);
    margin-left: 8px;
  }
  .status-msg.err { color: var(--danger); }

  .loading-msg {
    font-size: 12px;
    color: var(--text-muted);
    padding: 20px;
    text-align: center;
  }
`;

// ── WAV helpers ────────────────────────────────────────────────────────────────

function encodeWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate  = audioBuffer.sampleRate;
  const numSamples  = audioBuffer.length;
  const channels    = Array.from({ length: numChannels }, (_, i) => audioBuffer.getChannelData(i));

  const dataLen  = numSamples * numChannels * 2; // 16-bit PCM
  const buf      = new ArrayBuffer(44 + dataLen);
  const v        = new DataView(buf);
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };

  ws(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);          // PCM
  v.setUint16(20, 1, true);           // format
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numChannels * 2, true); // byteRate
  v.setUint16(32, numChannels * 2, true);              // blockAlign
  v.setUint16(34, 16, true);          // bits per sample
  ws(36, 'data');
  v.setUint32(40, dataLen, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      v.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
      offset += 2;
    }
  }
  return buf;
}

function cutRegion(buffer, startSec, endSec) {
  const sr      = buffer.sampleRate;
  const s0      = Math.round(startSec * sr);
  const s1      = Math.min(Math.round(endSec * sr), buffer.length);
  const newLen  = buffer.length - (s1 - s0);
  if (newLen <= 0) return null;
  const ctx    = new AudioContext();
  const newBuf = ctx.createBuffer(buffer.numberOfChannels, newLen, sr);
  ctx.close();
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = newBuf.getChannelData(ch);
    dst.set(src.subarray(0, s0), 0);
    dst.set(src.subarray(s1), s0);
  }
  return newBuf;
}

function insertSilenceAt(buffer, atSec, silenceSecs = 1) {
  const sr     = buffer.sampleRate;
  const s0     = Math.round(atSec * sr);
  const silLen = Math.round(silenceSecs * sr);
  const newLen = buffer.length + silLen;
  const ctx    = new AudioContext();
  const newBuf = ctx.createBuffer(buffer.numberOfChannels, newLen, sr);
  ctx.close();
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = newBuf.getChannelData(ch);
    dst.set(src.subarray(0, s0), 0);           // before marker
    // silence fills s0..s0+silLen automatically (Float32Array is zero-init)
    dst.set(src.subarray(s0), s0 + silLen);    // after marker
  }
  return newBuf;
}

// ── Component ─────────────────────────────────────────────────────────────────

class AudioEditor extends HTMLElement {
  static observedAttributes = ['file', 'course', 'module'];

  #buffer   = null;   // AudioBuffer (current state after edits)
  #loading  = true;
  #error    = null;
  #selStart = null;   // selection start (0–1 fraction of total)
  #selEnd   = null;
  #dragging = false;

  // Playback
  #playAudio = null;
  #playRaf   = null;
  #playing   = false;
  #playStart = 0;

  get file()   { return this.getAttribute('file') ?? ''; }
  get course() { return this.getAttribute('course') ?? ''; }
  get module() { return this.getAttribute('module') ?? ''; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback()        { this.#load(); }
  attributeChangedCallback() { if (this.isConnected) this.#load(); }

  async #load() {
    this.#stopPlay();
    this.#loading = true;
    this.#error   = null;
    this.#buffer  = null;
    this.#selStart = null;
    this.#selEnd   = null;
    this.#render();
    try {
      const url = `/api/audio/${enc(this.course)}/${enc(this.module)}/${enc(this.file)}`;
      const res = await fetch(url);
      const raw = await res.arrayBuffer();
      const ctx = new AudioContext();
      this.#buffer = await ctx.decodeAudioData(raw);
      ctx.close();
    } catch (e) {
      this.#error = `Could not load audio: ${e.message}`;
    }
    this.#loading = false;
    this.#render();
  }

  #drawWaveform(cursorFrac = -1) {
    const canvas = this.shadowRoot.querySelector('canvas');
    if (!canvas || !this.#buffer) return;
    const W  = canvas.width;
    const H  = canvas.height;
    const cx = canvas.getContext('2d');
    const data = this.#buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / W));

    cx.clearRect(0, 0, W, H);
    cx.fillStyle = '#818cf8';
    const mid = H / 2;
    for (let x = 0; x < W; x++) {
      let max = 0;
      for (let i = 0; i < step; i++) {
        const s = Math.abs(data[x * step + i] || 0);
        if (s > max) max = s;
      }
      const h = max * mid;
      cx.fillRect(x, mid - h, 1, h * 2 || 1);
    }

    // Playback cursor
    if (cursorFrac >= 0 && cursorFrac <= 1) {
      cx.fillStyle = 'rgba(248, 113, 113, 0.9)';
      cx.fillRect(Math.round(cursorFrac * W), 0, 2, H);
    }
  }

  #renderSelection() {
    const wrap    = this.shadowRoot.querySelector('.canvas-wrap');
    const overlay = this.shadowRoot.querySelector('.selection-overlay');
    const marker  = this.shadowRoot.querySelector('.marker-line');
    if (!wrap || !overlay || !marker) return;

    const hasRange = this.#selStart !== null && this.#selEnd !== null
      && Math.abs(this.#selEnd - this.#selStart) > 0.001;
    const hasCursor = this.#selStart !== null;

    if (!hasCursor) {
      overlay.style.display = 'none';
      marker.style.display  = 'none';
      return;
    }

    const W = wrap.getBoundingClientRect().width;

    if (hasRange) {
      const l = Math.min(this.#selStart, this.#selEnd);
      const r = Math.max(this.#selStart, this.#selEnd);
      overlay.style.display = 'block';
      overlay.style.left  = `${l * W}px`;
      overlay.style.width = `${(r - l) * W}px`;
      marker.style.display = 'none';
    } else {
      overlay.style.display = 'none';
      marker.style.display = 'block';
      marker.style.left = `${this.#selStart * W}px`;
    }
  }

  #selDuration() {
    if (this.#selStart === null || this.#selEnd === null || !this.#buffer) return 0;
    return Math.abs(this.#selEnd - this.#selStart) * this.#buffer.duration;
  }

  #markerTimeSec() {
    if (this.#selStart === null || !this.#buffer) return null;
    return Math.min(this.#selStart, this.#selEnd ?? this.#selStart) * this.#buffer.duration;
  }

  async #applyEdit(op) {
    if (!this.#buffer) return;
    if (this.#selStart === null) return;
    this.#stopPlay();

    const d = this.#buffer.duration;
    const l = Math.min(this.#selStart, this.#selEnd ?? this.#selStart) * d;
    const r = Math.max(this.#selStart, this.#selEnd ?? this.#selStart) * d;

    let newBuf;
    if (op === 'cut') {
      if (Math.abs(r - l) < 0.001) return;
      newBuf = cutRegion(this.#buffer, l, r);
    } else if (op === 'insert-silence') {
      newBuf = insertSilenceAt(this.#buffer, l, 1.0);
    }
    if (!newBuf) return;
    this.#buffer   = newBuf;
    this.#selStart = null;
    this.#selEnd   = null;
    this.#render();
  }

  async #saveAudio() {
    if (!this.#buffer) return;
    const statusEl = this.shadowRoot.querySelector('#status');
    const saveBtn  = this.shadowRoot.querySelector('#btn-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    if (statusEl) { statusEl.className = 'status-msg'; statusEl.textContent = ''; }
    try {
      const wavData = encodeWav(this.#buffer);
      const res = await fetch(
        `/api/audio/${enc(this.course)}/${enc(this.module)}/${enc(this.file)}`,
        { method: 'PUT', body: wavData, headers: { 'Content-Type': 'audio/wav' } }
      );
      const { duration } = await res.json();
      this.dispatchEvent(new CustomEvent('audio-edited', {
        detail:   { file: this.file, duration },
        bubbles:  true,
        composed: true,
      }));
    } catch (e) {
      if (statusEl) { statusEl.className = 'status-msg err'; statusEl.textContent = e.message; }
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    }
  }

  // ── Playback ────────────────────────────────────────────────────────────────

  #startPlay() {
    if (!this.#buffer) return;
    if (this.#playing) { this.#stopPlay(); return; }

    const wavData = encodeWav(this.#buffer);
    const blob    = new Blob([wavData], { type: 'audio/wav' });
    const url     = URL.createObjectURL(blob);
    this.#playAudio  = new Audio(url);
    this.#playStart  = performance.now();
    this.#playing    = true;

    this.#playAudio.play().catch(() => this.#stopPlay());
    this.#playAudio.addEventListener('ended', () => this.#stopPlay());

    const tick = () => {
      if (!this.#playing) return;
      const elapsed  = (performance.now() - this.#playStart) / 1000;
      const fraction = Math.min(elapsed / this.#buffer.duration, 1);
      this.#drawWaveform(fraction);
      this.#playRaf = requestAnimationFrame(tick);
    };
    this.#playRaf = requestAnimationFrame(tick);
    this.#updatePlayBtn();
  }

  #stopPlay() {
    if (!this.#playing && !this.#playRaf) return;
    this.#playing = false;
    if (this.#playAudio) { this.#playAudio.pause(); this.#playAudio = null; }
    cancelAnimationFrame(this.#playRaf);
    this.#playRaf = null;
    // Redraw without cursor (deferred since canvas may not exist yet)
    requestAnimationFrame(() => this.#drawWaveform());
    this.#updatePlayBtn();
  }

  #updatePlayBtn() {
    const btn = this.shadowRoot?.querySelector('#btn-play-audio');
    if (btn) btn.textContent = this.#playing ? '⏹' : '▶';
  }

  // ── ────────────────────────────────────────────────────────────────────────

  #close() {
    this.#stopPlay();
    this.dispatchEvent(new CustomEvent('audio-editor-close', { bubbles: true, composed: true }));
  }

  #render() {
    const sr = this.shadowRoot;
    const hasRange  = this.#selStart !== null && this.#selEnd !== null
      && Math.abs(this.#selEnd - this.#selStart) > 0.001;
    const hasCursor = this.#selStart !== null;
    const selDur    = this.#selDuration();

    let selInfoText = 'Click to set marker, drag to select';
    if (hasRange) selInfoText = `${selDur.toFixed(2)}s selected`;
    else if (hasCursor) selInfoText = `Marker at ${(this.#markerTimeSec() ?? 0).toFixed(2)}s`;

    sr.innerHTML = `
      <style>${STYLES}</style>

      <div class="editor-header">
        <span class="editor-title">Edit: ${esc(this.file.replace(/\.wav$/, ''))}</span>
        <button class="close-btn" id="btn-close">×</button>
      </div>

      ${this.#loading
        ? `<div class="loading-msg">Loading audio…</div>`
        : this.#error
          ? `<div class="loading-msg" style="color:var(--danger)">${esc(this.#error)}</div>`
          : `
            <div class="canvas-wrap" id="canvas-wrap">
              <canvas id="waveform" width="800" height="80"></canvas>
              <div class="selection-overlay" style="display:none"></div>
              <div class="marker-line" style="display:none"></div>
            </div>
            <div class="tools">
              <button class="btn btn-play-audio" id="btn-play-audio" title="Play">▶</button>
              <button class="btn btn-danger" id="btn-cut" ${!hasRange ? 'disabled' : ''}>Cut</button>
              <button class="btn" id="btn-insert-silence" ${!hasCursor ? 'disabled' : ''}>Insert Silence</button>
              <span class="sel-info">${selInfoText}</span>
              <button class="btn btn-primary" id="btn-save">Save</button>
              <span class="status-msg" id="status"></span>
            </div>
          `
      }
    `;

    sr.querySelector('#btn-close')?.addEventListener('click', () => this.#close());

    if (this.#loading || this.#error) return;

    // Draw waveform after DOM is ready
    requestAnimationFrame(() => {
      this.#drawWaveform();
      this.#renderSelection();
    });

    // Canvas selection drag
    const wrap = sr.querySelector('#canvas-wrap');
    wrap.addEventListener('mousedown', (e) => {
      this.#dragging = true;
      const frac = (e.clientX - wrap.getBoundingClientRect().left) / wrap.getBoundingClientRect().width;
      this.#selStart = Math.max(0, Math.min(1, frac));
      this.#selEnd   = this.#selStart;
      this.#renderSelection();
      this.#updateToolBtns();
    });

    wrap.addEventListener('mousemove', (e) => {
      if (!this.#dragging) return;
      const frac = (e.clientX - wrap.getBoundingClientRect().left) / wrap.getBoundingClientRect().width;
      this.#selEnd = Math.max(0, Math.min(1, frac));
      this.#renderSelection();
      this.#updateToolBtns();
    });

    const endDrag = () => { this.#dragging = false; };
    wrap.addEventListener('mouseup', endDrag);
    wrap.addEventListener('mouseleave', endDrag);

    sr.querySelector('#btn-play-audio')?.addEventListener('click', () => this.#startPlay());
    sr.querySelector('#btn-cut')?.addEventListener('click', () => this.#applyEdit('cut'));
    sr.querySelector('#btn-insert-silence')?.addEventListener('click', () => this.#applyEdit('insert-silence'));
    sr.querySelector('#btn-save')?.addEventListener('click', () => this.#saveAudio());
  }

  // Update tool buttons without full re-render
  #updateToolBtns() {
    const sr = this.shadowRoot;
    const hasRange  = this.#selStart !== null && this.#selEnd !== null
      && Math.abs(this.#selEnd - this.#selStart) > 0.001;
    const hasCursor = this.#selStart !== null;
    const selDur    = this.#selDuration();

    sr.querySelector('#btn-cut')?.toggleAttribute('disabled', !hasRange);
    sr.querySelector('#btn-insert-silence')?.toggleAttribute('disabled', !hasCursor);

    const info = sr.querySelector('.sel-info');
    if (info) {
      if (hasRange) info.textContent = `${selDur.toFixed(2)}s selected`;
      else if (hasCursor) info.textContent = `Marker at ${(this.#markerTimeSec() ?? 0).toFixed(2)}s`;
      else info.textContent = 'Click to set marker, drag to select';
    }
  }
}

const enc = encodeURIComponent;
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('audio-editor', AudioEditor);
