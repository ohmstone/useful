// <audio-library course="..." module="...">
// Lists generated audio clips + TTS generation form.
// Clips are draggable onto <audio-track>.
// dataTransfer format: application/json → { file, text, duration }
// Clips have an Edit button that shows <audio-editor> inline.

const STYLES = `
  :host { display: flex; flex-direction: column; gap: 12px; }

  ::-webkit-scrollbar        { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track  { background: transparent; }
  ::-webkit-scrollbar-thumb  { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /* Voice section */
  .voice-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .voice-sel {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 7px 10px;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font);
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .voice-sel:focus { border-color: var(--accent); }

  .add-voice-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .add-voice-row {
    display: flex;
    gap: 8px;
    align-items: center;
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
  .btn-sm { padding: 6px 10px; font-size: 12px; }
  .btn-danger { border-color: var(--danger); color: var(--danger); }
  .btn-danger:hover { background: rgba(248,113,113,0.1); border-color: var(--danger); }

  .file-label {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-size: 12px;
    font-family: var(--font);
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s;
  }
  .file-label:hover { border-color: var(--accent); color: var(--text); }
  .file-label.has-file { color: var(--text); border-color: var(--accent-deep); }

  .gen-error, .voice-error {
    font-size: 12px;
    color: var(--danger);
    min-height: 16px;
  }

  /* Clip list */
  .clip-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
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

  .play-btn, .edit-btn, .del-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 12px;
    line-height: 1;
    color: var(--text-muted);
    transition: color 0.1s, background 0.1s;
  }
  .play-btn:hover { color: var(--accent); }
  .edit-btn:hover { color: var(--text); background: var(--surface-raised); }
  .del-btn:hover  { color: var(--danger); background: rgba(248,113,113,0.1); }

  .drag-hint { font-size: 11px; color: var(--text-dim); }
  .empty-msg { font-size: 13px; color: var(--text-muted); padding: 8px 0; }
`;

class AudioLibrary extends HTMLElement {
  static observedAttributes = ['course', 'module'];

  #clips       = [];
  #voices      = { builtin: [], custom: [] };
  #voice       = 'cosette';
  #addingVoice = false;
  #audio       = null; // current HTMLAudioElement
  #editingFile = null; // file currently open in editor

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
      const [clipsRes, voicesRes, prefRes] = await Promise.all([
        fetch(`/api/audio/${enc(this.course)}/${enc(this.module)}`),
        fetch('/api/voices'),
        fetch('/api/voice'),
      ]);
      this.#clips  = await clipsRes.json();
      this.#voices = await voicesRes.json();
      const pref   = await prefRes.json();
      this.#voice  = pref.voice ?? 'cosette';
    } catch {
      this.#clips  = [];
      this.#voices = { builtin: [], custom: [] };
    }
    this.#render();
  }

  async #saveVoice(voice) {
    this.#voice = voice;
    await fetch('/api/voice', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice }),
    });
    // no re-render needed; select already reflects the value
  }

  async #registerVoice(name, file, btn, errorEl) {
    if (!name) { errorEl.textContent = 'Name required'; return; }
    if (!file)  { errorEl.textContent = 'WAV file required'; return; }
    btn.disabled    = true;
    btn.textContent = 'Uploading…';
    errorEl.textContent = '';
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`/api/voices?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: buf,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Reload voices, select the new one, close add form
      const vRes       = await fetch('/api/voices');
      this.#voices     = await vRes.json();
      this.#voice      = name;
      this.#addingVoice = false;
      await fetch('/api/voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: name }),
      });
      this.#render();
    } catch (e) {
      errorEl.textContent = e.message;
      btn.disabled    = false;
      btn.textContent = 'Upload';
    }
  }

  async #deleteVoice(name) {
    await fetch(`/api/voices/${enc(name)}`, { method: 'DELETE' });
    const vRes   = await fetch('/api/voices');
    this.#voices = await vRes.json();
    if (this.#voice === name) {
      this.#voice = 'cosette';
      await fetch('/api/voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: 'cosette' }),
      });
    }
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
    if (this.#editingFile === file) this.#editingFile = null;
    this.#render();
  }

  #play(file) {
    this.#audio?.pause();
    const url   = `/api/audio/${enc(this.course)}/${enc(this.module)}/${enc(file)}`;
    this.#audio = new Audio(url);
    this.#audio.play();
  }

  #voiceOptions() {
    const builtin = (this.#voices.builtin ?? []);
    const custom  = (this.#voices.custom  ?? []);
    const all     = [...builtin, ...custom];
    // If current voice isn't in the list yet (e.g. server starting), include it
    if (this.#voice && !all.includes(this.#voice)) builtin.unshift(this.#voice);

    const opts = (names, group) => names.map(n =>
      `<option value="${esc(n)}" ${n === this.#voice ? 'selected' : ''}>${esc(n)}</option>`
    ).join('');

    if (custom.length) {
      return `<optgroup label="Built-in">${opts(builtin)}</optgroup>
              <optgroup label="Custom">${opts(custom)}</optgroup>`;
    }
    return opts(builtin);
  }

  #render() {
    const sr = this.shadowRoot;
    const isCustom = (this.#voices.custom ?? []).includes(this.#voice);

    sr.innerHTML = `
      <style>${STYLES}</style>

      <div class="section-label">Voice</div>
      <div class="voice-row">
        <select class="voice-sel" id="voice-sel">${this.#voiceOptions()}</select>
        ${isCustom ? `<button class="btn btn-sm btn-danger" id="btn-del-voice" title="Remove this voice">Remove</button>` : ''}
        <button class="btn btn-sm" id="btn-add-voice">${this.#addingVoice ? 'Cancel' : '+ Add'}</button>
      </div>

      ${this.#addingVoice ? `
        <div class="add-voice-form">
          <div class="add-voice-row">
            <input class="input" id="voice-name-inp" type="text"
              placeholder="Voice name (letters, digits, hyphens)" autocomplete="off" />
            <label class="file-label" id="voice-file-label" for="voice-file-inp">Choose WAV</label>
            <input type="file" id="voice-file-inp" accept="audio/wav,.wav" style="display:none" />
            <button class="btn btn-sm btn-primary" id="btn-upload-voice">Upload</button>
          </div>
          <div class="voice-error" id="voice-error"></div>
        </div>
      ` : ''}

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
                <button class="edit-btn" data-file="${esc(c.file)}" title="Edit">✎</button>
                <button class="del-btn"  data-file="${esc(c.file)}" title="Delete">✕</button>
              </div>
              ${this.#editingFile === c.file ? `
                <audio-editor
                  file="${esc(c.file)}"
                  course="${esc(this.course)}"
                  module="${esc(this.module)}">
                </audio-editor>
              ` : ''}
            `).join('')}
      </div>
      ${this.#clips.length ? `<div class="drag-hint">Drag clips onto the track above</div>` : ''}
    `;

    // Voice selector change
    sr.querySelector('#voice-sel').addEventListener('change', (e) => {
      this.#saveVoice(e.target.value);
    });

    // Add / Cancel voice form toggle
    sr.querySelector('#btn-add-voice').addEventListener('click', () => {
      this.#addingVoice = !this.#addingVoice;
      this.#render();
    });

    // Remove custom voice
    sr.querySelector('#btn-del-voice')?.addEventListener('click', () => {
      this.#deleteVoice(this.#voice);
    });

    // Add voice form wiring
    if (this.#addingVoice) {
      let chosenFile = null;

      const fileInp   = sr.querySelector('#voice-file-inp');
      const fileLabel = sr.querySelector('#voice-file-label');

      fileInp.addEventListener('change', () => {
        chosenFile = fileInp.files[0] ?? null;
        if (chosenFile) {
          fileLabel.textContent = chosenFile.name;
          fileLabel.classList.add('has-file');
        } else {
          fileLabel.textContent = 'Choose WAV';
          fileLabel.classList.remove('has-file');
        }
      });

      sr.querySelector('#btn-upload-voice').addEventListener('click', () => {
        const nameInp = sr.querySelector('#voice-name-inp');
        const btn     = sr.querySelector('#btn-upload-voice');
        const errorEl = sr.querySelector('#voice-error');
        this.#registerVoice(nameInp.value.trim(), chosenFile, btn, errorEl);
      });
    }

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

    // Edit buttons — toggle inline editor
    sr.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.#editingFile = this.#editingFile === btn.dataset.file ? null : btn.dataset.file;
        this.#render();
      });
    });

    // Delete buttons
    sr.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.#delete(btn.dataset.file);
      });
    });

    // Audio editor events
    const editor = sr.querySelector('audio-editor');
    if (editor) {
      editor.addEventListener('audio-edited', (e) => {
        const { file, duration } = e.detail;
        this.#clips = this.#clips.map(c => c.file === file ? { ...c, duration } : c);
        this.#editingFile = null;
        this.#render();
      });
      editor.addEventListener('audio-editor-close', () => {
        this.#editingFile = null;
        this.#render();
      });
    }

    // Drag-and-drop: set transfer data
    sr.querySelectorAll('.clip[draggable]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        el.setAttribute('dragging', '');
        e.dataTransfer.effectAllowed = 'copy';
        // Store payload in a window variable — Chrome drops getData() across shadow roots
        window.__audioDragPayload = {
          file:     el.dataset.file,
          text:     el.dataset.text,
          duration: parseFloat(el.dataset.duration) || 0,
        };
        e.dataTransfer.setData('text/plain', el.dataset.file); // signals a valid drag

        // Compact drag ghost instead of the full-width row
        const ghost = document.createElement('div');
        ghost.textContent = el.dataset.text || el.dataset.file;
        ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;'
          + 'background:#1e3a8a;color:#fff;border-radius:4px;'
          + 'padding:3px 12px;font:12px/1.8 sans-serif;'
          + 'white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 60, 14);
        setTimeout(() => ghost.remove(), 0);
      });
      el.addEventListener('dragend', () => {
        el.removeAttribute('dragging');
        window.__audioDragPayload = null;
      });
    });
  }
}

const enc = encodeURIComponent;
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

customElements.define('audio-library', AudioLibrary);
