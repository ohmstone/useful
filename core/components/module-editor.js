// <module-editor course="..." module="...">
// Full editing interface for a module.
//
// Layout (top-to-bottom):
//   nav bar  →  back button + save status + play
//   top row  →  [slide textarea] | [16:9 slide-preview]
//   middle   →  <audio-track>
//   bottom   →  <audio-library>

import { parseSlides } from './slide-preview.js';

const STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  ::-webkit-scrollbar        { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track  { background: transparent; }
  ::-webkit-scrollbar-thumb  { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

  /* ── Nav bar ── */
  .editor-nav {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .back-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 13px;
    font-family: var(--font);
    cursor: pointer;
    padding: 0;
    transition: color 0.15s;
  }
  .back-btn:hover { color: var(--text); }

  .play-btn {
    display: inline-flex;
    align-items: center;
    padding: 5px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--accent-deep);
    background: var(--accent-deep);
    color: #fff;
    font-size: 12px;
    font-family: var(--font);
    cursor: pointer;
    margin-left: auto;
    transition: background 0.15s, border-color 0.15s;
  }
  .play-btn:hover { background: var(--accent); border-color: var(--accent); }
  .play-btn.playing { background: var(--danger); border-color: var(--danger); }

  .save-status {
    font-size: 11px;
    color: var(--text-dim);
  }

  /* ── Scrollable body ── */
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
  }

  /* ── Top row: editor + preview ── */
  .top-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;
  }

  .editor-pane {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .pane-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .slides-textarea {
    min-height: 240px;
    max-height: 480px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 14px;
    color: var(--text);
    font-size: 15px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    line-height: 1.7;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
    width: 100%;
    box-sizing: border-box;
  }
  .slides-textarea:focus { border-color: var(--accent); }

  .format-hint {
    font-size: 11px;
    color: var(--text-dim);
    line-height: 1.5;
  }

  /* ── Dividers ── */
  .divider {
    height: 1px;
    background: var(--border);
    flex-shrink: 0;
  }

  /* Loading */
  .loading { font-size: 13px; color: var(--text-muted); padding: 40px; text-align: center; }
`;

class ModuleEditor extends HTMLElement {
  static observedAttributes = ['course', 'module'];

  #slides     = '';
  #loading    = true;
  #saveStatus = '';
  #saveTimer  = null;

  // Playback state
  #playing      = false;
  #playRaf      = null;
  #playTimeouts = [];
  #playAudios   = [];
  #playStart    = 0;

  get course() { return this.getAttribute('course') ?? ''; }
  get module() { return this.getAttribute('module') ?? ''; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback()        { this.#load(); }
  attributeChangedCallback() { if (this.isConnected) this.#load(); }

  async #load() {
    this.#stop();
    this.#loading = true;
    this.#render();
    try {
      const res    = await fetch(`/api/slides/${enc(this.course)}/${enc(this.module)}`);
      this.#slides = await res.text();
    } catch { this.#slides = ''; }
    this.#loading = false;
    this.#render();
  }

  async #autoSave() {
    const statusEl = this.shadowRoot?.querySelector('#save-status');
    if (statusEl) statusEl.textContent = 'Saving…';
    try {
      await fetch(`/api/slides/${enc(this.course)}/${enc(this.module)}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body:    this.#slides,
      });
      this.#saveStatus = 'Saved';
    } catch {
      this.#saveStatus = 'Save failed';
    }
    const el = this.shadowRoot?.querySelector('#save-status');
    if (el) el.textContent = this.#saveStatus;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveStatus = '';
      const el = this.shadowRoot?.querySelector('#save-status');
      if (el) el.textContent = '';
    }, 2500);
  }

  #scheduleAutoSave() {
    clearTimeout(this.#saveTimer);
    const statusEl = this.shadowRoot?.querySelector('#save-status');
    if (statusEl) statusEl.textContent = '●';
    this.#saveTimer = setTimeout(() => this.#autoSave(), 800);
  }

  #updateTrackDuration(slides) {
    const total = slides.reduce((sum, s) => sum + s.duration, 0);
    const track = this.shadowRoot?.querySelector('#track');
    if (track) track.totalDuration = total || 60;
  }

  async #play() {
    const slides = parseSlides(this.#slides);
    if (slides.length === 0) return;

    const res   = await fetch(`/api/track/${enc(this.course)}/${enc(this.module)}`);
    const clips = await res.json().catch(() => []);

    this.#playing   = true;
    this.#playStart = performance.now();
    this.#updatePlayBtn();

    // Schedule audio clips
    this.#playTimeouts = clips.map(clip => {
      return setTimeout(() => {
        const url   = `/api/audio/${enc(this.course)}/${enc(this.module)}/${enc(clip.file)}`;
        const audio = new Audio(url);
        audio.play().catch(() => {});
        this.#playAudios.push(audio);
      }, clip.startTime * 1000);
    });

    const totalDuration = slides.reduce((sum, s) => sum + s.duration, 0);
    const preview = this.shadowRoot.querySelector('#preview');
    const track   = this.shadowRoot.querySelector('#track');

    const tick = () => {
      if (!this.#playing) return;
      const elapsed = (performance.now() - this.#playStart) / 1000;
      if (elapsed >= totalDuration) { this.#stop(); return; }

      // Find current slide index
      let acc = 0, idx = 0;
      for (let i = 0; i < slides.length; i++) {
        acc += slides[i].duration;
        if (elapsed < acc) { idx = i; break; }
        idx = i;
      }
      if (preview) preview.currentIndex = idx;
      if (track)   track.playTime = elapsed;

      this.#playRaf = requestAnimationFrame(tick);
    };
    this.#playRaf = requestAnimationFrame(tick);
  }

  #stop() {
    if (!this.#playing && !this.#playRaf) return;
    this.#playing = false;
    cancelAnimationFrame(this.#playRaf);
    this.#playRaf = null;
    this.#playTimeouts.forEach(t => clearTimeout(t));
    this.#playAudios.forEach(a => { try { a.pause(); } catch {} });
    this.#playTimeouts = [];
    this.#playAudios  = [];
    const track = this.shadowRoot?.querySelector('#track');
    if (track) track.playTime = -1;
    this.#updatePlayBtn();
  }

  #updatePlayBtn() {
    const btn = this.shadowRoot?.querySelector('#btn-play');
    if (!btn) return;
    btn.textContent = this.#playing ? '⏹ Stop' : '▶ Play';
    btn.classList.toggle('playing', this.#playing);
  }

  #render() {
    const sr = this.shadowRoot;

    if (this.#loading) {
      sr.innerHTML = `<style>${STYLES}</style><div class="loading">Loading module…</div>`;
      return;
    }

    sr.innerHTML = `
      <style>${STYLES}</style>

      <div class="editor-nav">
        <button class="back-btn" id="btn-back">← Back</button>
        <span class="save-status" id="save-status">${esc(this.#saveStatus)}</span>
        <button class="play-btn" id="btn-play">▶ Play</button>
      </div>

      <div class="body">

        <div class="top-row">
          <div class="editor-pane">
            <div class="pane-label">Slides</div>
            <textarea class="slides-textarea" id="slides-ta"
              spellcheck="false">${esc(this.#slides)}</textarea>
            <div class="format-hint">
              Start each slide with <code>=== &lt;seconds&gt;</code> (decimals ok, e.g. <code>=== 2.5</code>)
            </div>
          </div>

          <div class="editor-pane">
            <div class="pane-label">Preview</div>
            <slide-preview id="preview"></slide-preview>
          </div>
        </div>

        <div class="divider"></div>

        <audio-track id="track"
          course="${esc(this.course)}"
          module="${esc(this.module)}">
        </audio-track>

        <div class="divider"></div>

        <audio-library id="library"
          course="${esc(this.course)}"
          module="${esc(this.module)}">
        </audio-library>

      </div>
    `;

    // Initial slide parse → preview + track duration
    const preview = sr.querySelector('#preview');
    const slides  = parseSlides(this.#slides);
    preview.slides = slides;
    // Set track duration after it has connected
    requestAnimationFrame(() => this.#updateTrackDuration(slides));

    // Live update: preview, track duration, auto-save
    const ta = sr.querySelector('#slides-ta');
    ta.addEventListener('input', () => {
      this.#slides = ta.value;
      const parsed = parseSlides(this.#slides);
      preview.slides = parsed;
      this.#updateTrackDuration(parsed);
      this.#scheduleAutoSave();
    });

    // Play button
    sr.querySelector('#btn-play').addEventListener('click', () => {
      if (this.#playing) { this.#stop(); } else { this.#play(); }
    });

    // Back button
    sr.querySelector('#btn-back').addEventListener('click', () => {
      this.#stop();
      this.dispatchEvent(new CustomEvent('nav-back', { bubbles: true, composed: true }));
    });
  }
}

const enc = encodeURIComponent;
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('module-editor', ModuleEditor);
