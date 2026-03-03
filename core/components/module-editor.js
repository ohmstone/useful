// <module-editor course="..." module="...">
// Full editing interface for a module.
//
// Layout (top-to-bottom):
//   nav bar  →  back button + breadcrumb + save status
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

  .save-btn {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    padding: 5px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
    font-family: var(--font);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .save-btn:hover { border-color: var(--accent); background: var(--surface-raised); }
  .save-btn:disabled { opacity: 0.45; cursor: not-allowed; }

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
  }

  /* ── Top row: editor + preview ── */
  .top-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    min-height: 0;
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
    flex: 1;
    min-height: 240px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 14px;
    color: var(--text);
    font-size: 13px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    line-height: 1.7;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
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

  get course() { return this.getAttribute('course') ?? ''; }
  get module() { return this.getAttribute('module') ?? ''; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback()        { this.#load(); }
  attributeChangedCallback() { if (this.isConnected) this.#load(); }

  async #load() {
    this.#loading = true;
    this.#render();
    try {
      const res    = await fetch(`/api/slides/${enc(this.course)}/${enc(this.module)}`);
      this.#slides = await res.text();
    } catch { this.#slides = ''; }
    this.#loading = false;
    this.#render();
  }

  async #save() {
    const btn = this.shadowRoot.querySelector('#btn-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
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
    if (btn) { btn.disabled = false; btn.textContent = 'Save Slides'; }
    const statusEl = this.shadowRoot.querySelector('#save-status');
    if (statusEl) statusEl.textContent = this.#saveStatus;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveStatus = '';
      const el = this.shadowRoot.querySelector('#save-status');
      if (el) el.textContent = '';
    }, 2500);
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
        <button class="save-btn" id="btn-save">Save Slides</button>
        <span class="save-status" id="save-status">${esc(this.#saveStatus)}</span>
      </div>

      <div class="body">

        <div class="top-row">
          <div class="editor-pane">
            <div class="pane-label">Slides</div>
            <textarea class="slides-textarea" id="slides-ta"
              spellcheck="false">${esc(this.#slides)}</textarea>
            <div class="format-hint">
              Start each slide with <code>=== &lt;seconds&gt;</code><br>
              e.g. <code>=== 5</code> then the slide text below it.
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

    // Initial slide parse → preview
    const preview = sr.querySelector('#preview');
    preview.slides = parseSlides(this.#slides);

    // Live update preview as user types
    const ta = sr.querySelector('#slides-ta');
    ta.addEventListener('input', () => {
      this.#slides  = ta.value;
      preview.slides = parseSlides(this.#slides);
    });

    // Save button
    sr.querySelector('#btn-save').addEventListener('click', () => this.#save());

    // Back button
    sr.querySelector('#btn-back').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('nav-back', { bubbles: true, composed: true }));
    });
  }
}

const enc = encodeURIComponent;
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('module-editor', ModuleEditor);
