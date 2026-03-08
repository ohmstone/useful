// <module-editor course="..." module="...">
// Full editing interface for a module.
//
// Layout (top-to-bottom):
//   nav bar  →  back button + save status + play
//   top row  →  [slide textarea] | [16:9 slide-preview]
//   middle   →  <audio-track>
//   bottom   →  <audio-library>

import { parseSlides } from '../slide-parser.js';

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

  .syntax-btn, .files-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-dim);
    font-size: 11px;
    font-family: var(--font);
    padding: 4px 9px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .syntax-btn:hover, .files-btn:hover { color: var(--text); border-color: var(--accent); }

  /* ── Syntax reference modal ── */
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 10px);
    padding: 24px 28px;
    max-width: 640px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    position: relative;
  }
  .modal h2 {
    margin: 0 0 16px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .modal-close {
    position: absolute;
    top: 16px; right: 18px;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 18px;
    cursor: pointer;
    line-height: 1;
    padding: 2px 6px;
  }
  .modal-close:hover { color: var(--text); }
  .ref { font-size: 12px; line-height: 1.7; }
  .ref h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin: 14px 0 4px; }
  .ref table { border-collapse: collapse; width: 100%; }
  .ref td { padding: 3px 8px 3px 0; vertical-align: top; color: var(--text); }
  .ref td:first-child { color: var(--text-dim); white-space: nowrap; }
  .ref code { font-family: 'JetBrains Mono','Fira Code',monospace; font-size: 1em; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; }
  .ref pre { margin: 6px 0; background: rgba(0,0,0,0.3); border-radius: 4px; padding: 8px 12px; white-space: pre; overflow-x: auto; font-family: 'JetBrains Mono','Fira Code',monospace; font-size: 0.85em; line-height: 1.6; }

  /* ── File manager modal ── */
  .file-list { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
  .file-row {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 12px;
  }
  .file-name { flex: 1; font-family: 'JetBrains Mono','Fira Code',monospace; color: var(--text); }
  .file-size { color: var(--text-dim); white-space: nowrap; }
  .file-del {
    background: none; border: none; color: var(--text-dim);
    cursor: pointer; font-size: 14px; padding: 0 2px; line-height: 1;
    transition: color 0.15s;
  }
  .file-del:hover { color: var(--danger); }
  .file-empty { font-size: 12px; color: var(--text-dim); padding: 8px 0; }
  .file-upload-row {
    display: flex; align-items: center; gap: 8px; margin-top: 8px;
  }
  .file-upload-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: 12px; font-family: var(--font);
    padding: 5px 12px; cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .file-upload-btn:hover { color: var(--text); border-color: var(--accent); }
  .file-upload-note { font-size: 11px; color: var(--text-dim); }

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
    height: 100%;
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

    const preview = this.shadowRoot.querySelector('#preview');
    const track   = this.shadowRoot.querySelector('#track');

    // Compute time offset from the currently viewed slide
    const startIdx = preview?.currentIndex ?? 0;
    let startOffset = 0;
    for (let i = 0; i < startIdx && i < slides.length; i++) startOffset += slides[i].duration;

    this.#playing   = true;
    this.#playStart = performance.now() - startOffset * 1000;
    this.#updatePlayBtn();

    // Schedule audio clips that start at or after the start offset
    this.#playTimeouts = clips
      .filter(clip => clip.startTime >= startOffset)
      .map(clip => {
        return setTimeout(() => {
          const url   = `/api/audio/${enc(this.course)}/${enc(this.module)}/${enc(clip.file)}`;
          const audio = new Audio(url);
          audio.play().catch(() => {});
          this.#playAudios.push(audio);
        }, (clip.startTime - startOffset) * 1000);
      });

    const totalDuration = slides.reduce((sum, s) => sum + s.duration, 0);

    const tick = () => {
      if (!this.#playing) return;
      const elapsed = (performance.now() - this.#playStart) / 1000;
      if (elapsed >= totalDuration) { this.#stop(); return; }

      // Find current slide index and elapsed time within that slide
      let acc = 0, idx = slides.length - 1, slideStart = 0;
      for (let i = 0; i < slides.length; i++) {
        if (elapsed < acc + slides[i].duration) { idx = i; slideStart = acc; break; }
        acc += slides[i].duration;
      }
      if (preview) {
        preview.currentIndex = idx;
        preview.slideTime    = elapsed - slideStart;
      }
      if (track) track.playTime = elapsed;

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
    this.#playAudios.forEach(a => { try { a.pause(); } catch {/* */} });
    this.#playTimeouts = [];
    this.#playAudios  = [];
    const track   = this.shadowRoot?.querySelector('#track');
    const preview = this.shadowRoot?.querySelector('#preview');
    if (track)   track.playTime   = -1;
    if (preview) preview.slideTime = -1;
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
        <button class="files-btn" id="btn-files">Files</button>
        <button class="syntax-btn" id="btn-syntax">? Syntax</button>
        <button class="play-btn" id="btn-play">▶ Play</button>
      </div>

      <div class="body">

        <div class="top-row">
          <div class="editor-pane">
            <div class="pane-label">Slides</div>
            <textarea class="slides-textarea" id="slides-ta"
              spellcheck="false">${esc(this.#slides)}</textarea>
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

    // Files modal
    sr.querySelector('#btn-files').addEventListener('click', () => this.#showFilesModal());

    // Syntax reference modal
    sr.querySelector('#btn-syntax').addEventListener('click', () => this.#showSyntaxModal());
  }
  async #showFilesModal() {
    const sr = this.shadowRoot;
    if (sr.querySelector('#files-modal-backdrop')) return;

    const backdrop = document.createElement('div');
    backdrop.id = 'files-modal-backdrop';
    backdrop.className = 'modal-backdrop';

    const renderModal = async () => {
      let files = [];
      try {
        files = await fetch('/api/inject').then(r => r.json());
      } catch { /* ignore */ }

      const rows = files.length
        ? files.map(f => `
            <div class="file-row">
              <span class="file-name">${esc(f.name)}</span>
              <span class="file-size">${fmtSize(f.size)}</span>
              <button class="file-del" data-name="${esc(f.name)}" title="Delete">&times;</button>
            </div>`).join('')
        : `<div class="file-empty">No files yet. Upload JS modules or data files below.</div>`;

      backdrop.innerHTML = `
        <div class="modal">
          <button class="modal-close" id="files-close">&times;</button>
          <h2>Project Files &mdash; _inject/</h2>
          <p style="font-size:12px;color:var(--text-dim);margin:0 0 12px">
            JS plugin files can be referenced with <code>@plugin file.js</code>.
            A data file can be passed as a second arg: <code>@plugin chart.js data.json</code>.
            These files are shared across all courses and modules.
          </p>
          <div class="file-list">${rows}</div>
          <div class="file-upload-row">
            <button class="file-upload-btn" id="files-pick">+ Upload file</button>
            <span class="file-upload-note">Any file type. JS files are loaded as ES modules.</span>
          </div>
          <input type="file" id="files-input" style="display:none" multiple>
        </div>`;

      backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
      backdrop.querySelector('#files-close').addEventListener('click', () => backdrop.remove());

      backdrop.querySelector('#files-pick').addEventListener('click', () => {
        backdrop.querySelector('#files-input').click();
      });

      backdrop.querySelector('#files-input').addEventListener('change', async e => {
        for (const file of e.target.files) {
          await fetch(`/api/inject/${encodeURIComponent(file.name)}`, {
            method: 'POST',
            body: file,
          }).catch(() => {});
        }
        await renderModal();
      });

      backdrop.querySelectorAll('.file-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          await fetch(`/api/inject/${encodeURIComponent(btn.dataset.name)}`, { method: 'DELETE' });
          await renderModal();
        });
      });
    };

    await renderModal();
    sr.appendChild(backdrop);
  }

  #showSyntaxModal() {
    const sr = this.shadowRoot;
    if (sr.querySelector('.modal-backdrop')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <button class="modal-close" id="modal-close">&times;</button>
        <h2>Slide Syntax Reference</h2>
        <div class="ref">

          <h3>Slide separator</h3>
          <pre>=== 5\nSlide content here.\n\n=== 10\nNext slide.</pre>
          <p>The number is the slide duration in seconds (decimals ok).</p>

          <h3>Slide-level directives</h3>
          <table>
            <tr><td><code>@header Left | Right</code></td><td>Header bar with left and right text (or image). Either side optional.</td></tr>
            <tr><td><code>@bg color</code></td><td>Slide background. Any CSS color: <code>#1a1a2e</code>, <code>navy</code>, <code>linear-gradient(to right, #0f0, #00f)</code></td></tr>
          </table>

          <h3>Headings &amp; paragraphs</h3>
          <table>
            <tr><td><code># Heading</code></td><td>Large heading</td></tr>
            <tr><td><code>## Sub-heading</code></td><td>Smaller heading</td></tr>
            <tr><td>Normal text</td><td>Regular paragraph (blank line to end)</td></tr>
          </table>

          <h3>Style hints</h3>
          <p>Put <code>{options}</code> on its own line before a paragraph, heading, list, or image to set its style:</p>
          <table>
            <tr><td><code>{big}</code> <code>{small}</code></td><td>Text size (default: normal)</td></tr>
            <tr><td><code>{center}</code> <code>{right}</code></td><td>Alignment (default: left)</td></tr>
            <tr><td><code>{color:white}</code></td><td>Explicit text color (any CSS color)</td></tr>
          </table>
          <pre>{big center}\nThis is big and centered.\n\n{small right}\nSmall, right-aligned text.</pre>

          <h3>Inline formatting</h3>
          <table>
            <tr><td><code>**bold**</code></td><td>Bold text</td></tr>
            <tr><td><code>*italic*</code></td><td>Italic text</td></tr>
            <tr><td><code>__underline__</code></td><td>Underlined text</td></tr>
          </table>

          <h3>Lists</h3>
          <table>
            <tr><td><code>- item</code></td><td>Unordered list (also <code>* item</code>)</td></tr>
            <tr><td><code>1. item</code></td><td>Ordered list (any number works)</td></tr>
          </table>

          <h3>Images</h3>
          <pre>@image hero.jpg cover\n@image diagram.png contain\n@image "team photo.jpg" fill</pre>
          <p>File must be in <code>_inject/</code> (use <strong>Files</strong> to upload). Image takes remaining slide height. Fit: <code>contain</code> (letterbox, default) &middot; <code>cover</code> (fill+crop) &middot; <code>fill</code> (stretch) &middot; <code>none</code> (natural size). Quote filenames with spaces.</p>

          <h3>Code blocks</h3>
          <pre>\`\`\`python\ndef hello():\n    print("hi")\n\`\`\`</pre>

          <h3>Two-column layout</h3>
          <pre>@columns 40\nLeft content (40% wide).\n@col\nRight content (60% wide).\n@end</pre>
          <p>Omit the number for 50/50. Each column can have its own <code>@bg</code>.</p>

          <h3>Emphasis (timed spotlight)</h3>
          <pre>@emph 2 3\nThis content is highlighted at 2s for 3s.\nAll other slide content fades.\n@end</pre>

          <h3>Plugin (external JS content)</h3>
          <pre>@plugin chart.js\n@plugin chart.js data.json\n@plugin "my chart.js" "sales data.json"</pre>
          <p>Loads <code>_inject/chart.js</code> and calls it when playback reaches this slide.
          Optional second arg is a default data file passed as <code>dataFn</code>.
          Use the <strong>Files</strong> button to manage files in <code>_inject/</code>. Quote filenames that contain spaces.</p>
          <pre>export default function(inFn, outFn, dataFn) {\n  const el = document.createElement('div');\n  outFn(el); // place your element once\n  function tick() {\n    if (!el.isConnected) return; // slide changed — stop\n    const { width, height, timeInSlide, remaining } = inFn();\n    // update el based on time...\n    requestAnimationFrame(tick);\n  }\n  tick();\n  // dataFn?.()              → fetch Response for default data file\n  // dataFn?.("other.bin")  → fetch Response for any file in _inject/\n}</pre>

        </div>
      </div>`;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('#modal-close').addEventListener('click', () => backdrop.remove());
    sr.appendChild(backdrop);
  }
}

const enc = encodeURIComponent;
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtSize(n) {
  return n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`;
}

customElements.define('module-editor', ModuleEditor);
