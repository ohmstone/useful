// <audio-library course="..." module="...">
// Lists generated audio clips + TTS generation form.
// Clips are draggable onto <audio-track>.
// dataTransfer format: application/json → { file, text, duration }

const STYLES = `
  :host { display: flex; flex-direction: column; gap: 12px; }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /* Generate form */
  .gen-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 12px;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font);
    outline: none;
    transition: border-color 0.15s;
  }
  .input:focus { border-color: var(--accent); }
  .input::placeholder { color: var(--text-dim); }

  .btn {
    display: inline-flex;
    align-items: center;
    padding: 8px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font);
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s, background 0.15s;
  }
  .btn:hover { border-color: var(--accent); background: var(--surface-raised); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary { background: var(--accent-deep); border-color: var(--accent-deep); color: #fff; }
  .btn-primary:hover { background: var(--accent); border-color: var(--accent); }

  .gen-error { font-size: 12px; color: var(--danger); }

  /* Clip list */
  .clip-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
  }

  .clip {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 12px;
    cursor: grab;
    transition: border-color 0.15s, background 0.15s;
    user-select: none;
  }
  .clip:hover { border-color: var(--accent-deep); background: var(--surface-raised); }
  .clip[dragging] { opacity: 0.5; }

  .clip-text {
    flex: 1;
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .clip-duration {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .play-btn, .del-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 13px;
    line-height: 1;
    color: var(--text-muted);
    transition: color 0.1s, background 0.1s;
  }
  .play-btn:hover { color: var(--accent); }
  .del-btn:hover  { color: var(--danger); background: rgba(248,113,113,0.1); }

  .drag-hint { font-size: 11px; color: var(--text-dim); }
  .empty-msg { font-size: 13px; color: var(--text-muted); padding: 8px 0; }
`;

class AudioLibrary extends HTMLElement {
  static observedAttributes = ['course', 'module'];

  #clips  = [];
  #audio  = null; // current HTMLAudioElement

  get course() { return this.getAttribute('course') ?? ''; }
  get module() { return this.getAttribute('module') ?? ''; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback()        { this.#load(); }
  attributeChangedCallback() { if (this.isConnected) this.#load(); }

  async #load() {
    try {
      const res  = await fetch(`/api/audio/${enc(this.course)}/${enc(this.module)}`);
      this.#clips = await res.json();
    } catch { this.#clips = []; }
    this.#render();
  }

  async #generate(text, btn, errorEl, input) {
    btn.disabled    = true;
    btn.textContent = 'Generating…';
    errorEl.textContent = '';
    try {
      const res  = await fetch(`/api/audio/${enc(this.course)}/${enc(this.module)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      this.#clips = [...this.#clips, data];
      input.value = '';
      this.#render();
    } catch (e) {
      errorEl.textContent = e.message;
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Generate';
    }
  }

  async #delete(file) {
    await fetch(`/api/audio/${enc(this.course)}/${enc(this.module)}/${enc(file)}`, { method: 'DELETE' });
    this.#clips = this.#clips.filter(c => c.file !== file);
    this.#render();
  }

  #play(file) {
    this.#audio?.pause();
    const url   = `/api/audio/${enc(this.course)}/${enc(this.module)}/${enc(file)}`;
    this.#audio = new Audio(url);
    this.#audio.play();
  }

  #render() {
    const sr = this.shadowRoot;
    sr.innerHTML = `
      <style>${STYLES}</style>

      <div class="section-label">Generated Audio</div>

      <form id="form-gen">
        <div class="gen-row">
          <input class="input" id="inp-text" type="text"
            placeholder="Text to speak…" autocomplete="off" />
          <button class="btn btn-primary" id="btn-gen" type="submit">Generate</button>
        </div>
        <div class="gen-error" id="gen-error"></div>
      </form>

      <div class="clip-list">
        ${this.#clips.length === 0
          ? `<div class="empty-msg">No audio generated yet.</div>`
          : this.#clips.map(c => `
              <div class="clip" draggable="true" data-file="${esc(c.file)}"
                   data-text="${esc(c.text ?? '')}" data-duration="${c.duration ?? 0}">
                <button class="play-btn" data-file="${esc(c.file)}" title="Play">▶</button>
                <span class="clip-text" title="${esc(c.text ?? c.file)}">${esc(c.text || c.file)}</span>
                <span class="clip-duration">${(c.duration ?? 0).toFixed(1)}s</span>
                <button class="del-btn" data-file="${esc(c.file)}" title="Delete">✕</button>
              </div>
            `).join('')}
      </div>
      ${this.#clips.length ? `<div class="drag-hint">Drag clips onto the track above</div>` : ''}
    `;

    // Generate form
    sr.querySelector('#form-gen').addEventListener('submit', (e) => {
      e.preventDefault();
      const input   = sr.querySelector('#inp-text');
      const btn     = sr.querySelector('#btn-gen');
      const errorEl = sr.querySelector('#gen-error');
      const text    = input.value.trim();
      if (text) this.#generate(text, btn, errorEl, input);
    });

    // Play buttons
    sr.querySelectorAll('.play-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.#play(btn.dataset.file);
      });
    });

    // Delete buttons
    sr.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.#delete(btn.dataset.file);
      });
    });

    // Drag-and-drop: set transfer data
    sr.querySelectorAll('.clip[draggable]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        el.setAttribute('dragging', '');
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/json', JSON.stringify({
          file:     el.dataset.file,
          text:     el.dataset.text,
          duration: parseFloat(el.dataset.duration) || 0,
        }));
      });
      el.addEventListener('dragend', () => el.removeAttribute('dragging'));
    });
  }
}

const enc = encodeURIComponent;
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

customElements.define('audio-library', AudioLibrary);
