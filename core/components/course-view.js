// <course-view course="..."> — shows the ordered module list for a course.
// Each module card dispatches 'module-open' (bubbles, composed) when clicked.
// Modules can be reordered by dragging; order is persisted via PUT /api/modules/:course.
// Also provides course metadata editing (title, description, author, tags, thumbnail)
// and export directory configuration.

const STYLES = `
  :host { display: block; }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 8px;
  }

  .header-left { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 13px;
    font-family: var(--font);
    cursor: pointer;
    padding: 4px 0;
    transition: color 0.15s;
    flex-shrink: 0;
  }
  .back-btn:hover { color: var(--text); }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    white-space: nowrap;
  }
  .btn:hover { border-color: var(--accent); background: var(--surface-raised); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary { background: var(--accent-deep); border-color: var(--accent-deep); color: #fff; }
  .btn-primary:hover { background: var(--accent); border-color: var(--accent); }
  .btn-active { border-color: var(--accent); color: var(--accent); }

  /* Module list */
  .module-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .module-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface);
    border: 1px solid var(--border);
    border-top: 2px solid transparent;
    border-radius: var(--radius-lg);
    padding: 14px 18px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    user-select: none;
  }
  .module-card:hover { border-color: var(--accent-deep); background: var(--surface-raised); }
  .module-card.drag-over { border-top-color: var(--accent); }
  .module-card.dragging  { opacity: 0.4; }

  .module-left { display: flex; align-items: center; gap: 12px; }
  .drag-handle {
    color: var(--text-dim);
    font-size: 14px;
    cursor: grab;
    padding: 2px 4px;
    line-height: 1;
    flex-shrink: 0;
  }
  .drag-handle:active { cursor: grabbing; }

  .module-name { font-size: 14px; font-weight: 600; color: var(--text); }
  .module-idx  { font-size: 12px; color: var(--text-dim); }
  .module-arrow { color: var(--text-dim); font-size: 16px; }

  /* Panel (metadata form, export dir form) */
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .panel-title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label { font-size: 12px; color: var(--text-muted); }
  .field-hint { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
  .input {
    width: 100%;
    box-sizing: border-box;
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
  textarea.input { resize: vertical; min-height: 64px; }
  .form-row { display: flex; gap: 8px; align-items: center; }
  .form-error { font-size: 12px; color: var(--danger); }
  .form-ok    { font-size: 12px; color: var(--accent); }

  /* Create module form */
  .create-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 14px 18px;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .create-box label { font-size: 12px; color: var(--text-muted); }

  .state-msg { font-size: 14px; color: var(--text-muted); padding: 32px 0; text-align: center; }
  .error-msg { font-size: 13px; color: var(--danger); }

  /* Export dir status */
  .export-dir-path {
    font-size: 12px;
    color: var(--accent);
    font-family: monospace;
    word-break: break-all;
  }
  .export-dir-unset {
    color: var(--text-dim);
    font-style: italic;
  }

  /* Modules section header */
  .modules-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
`;

class CourseView extends HTMLElement {
  static observedAttributes = ['course'];

  #modules     = [];
  #meta        = {};
  #exportDir   = null;
  #loading     = true;
  #creating    = false;
  #editingMeta = false;
  #editingExport = false;
  #error       = null;
  #metaMsg     = null;  // { ok: bool, text: string }
  #exportMsg   = null;
  #dragIdx     = null;
  #dropIdx     = null;

  get course() { return this.getAttribute('course') ?? ''; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // dir-browser dispatches dir-selected with composed:true — catch it here
    this.addEventListener('dir-selected', (e) => this.#onDirSelected(e.detail.path));
  }

  connectedCallback()        { this.#load(); }
  attributeChangedCallback() { if (this.isConnected) this.#load(); }

  async #load() {
    this.#loading = true;
    this.#error   = null;
    this.#render();
    try {
      const [modsRes, metaRes, exportRes] = await Promise.all([
        fetch(`/api/modules/${enc(this.course)}`),
        fetch(`/api/meta/${enc(this.course)}`),
        fetch('/api/export/config'),
      ]);
      const mods = await modsRes.json();
      if (mods.error) throw new Error(mods.error);
      this.#modules   = mods;
      this.#meta      = await metaRes.json();
      const expCfg    = await exportRes.json();
      this.#exportDir = expCfg.exportDir ?? null;
    } catch (e) {
      this.#error = e.message;
    }
    this.#loading = false;
    this.#render();
  }

  async #saveOrder() {
    await fetch(`/api/modules/${enc(this.course)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(this.#modules),
    });
  }

  async #saveMeta(data) {
    const res = await fetch(`/api/meta/${enc(this.course)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to save metadata');
    this.#meta = data;
  }

  async #onDirSelected(path) {
    if (!this.#editingExport) return;
    try {
      await this.#saveExportDir(path);
      this.#exportMsg = { ok: true, text: `Set to: ${path}` };
    } catch (e) {
      this.#exportMsg = { ok: false, text: e.message };
    }
    this.#render();
  }

  async #saveExportDir(dir) {
    const res = await fetch('/api/export/config', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ exportDir: dir }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    this.#exportDir = data.exportDir;
  }

  #render() {
    const sr = this.shadowRoot;
    const m  = this.#meta;

    sr.innerHTML = `
      <style>${STYLES}</style>

      <div class="header">
        <div class="header-left">
          <button class="back-btn" id="btn-back">← Back</button>
          <span class="section-label">${esc(m.title || this.course)}</span>
        </div>
        <div class="header-right">
          <button class="btn ${this.#editingMeta ? 'btn-active' : ''}" id="btn-meta">
            ${this.#editingMeta ? '✕ Close' : '✎ Metadata'}
          </button>
          <button class="btn ${this.#editingExport ? 'btn-active' : ''}" id="btn-export"
            title="${this.#exportDir ? `Export dir: ${esc(this.#exportDir)}` : 'Set export directory'}">
            ${this.#editingExport ? '✕ Close' : '↑ Export'}
          </button>
        </div>
      </div>

      ${this.#editingMeta ? `
        <div class="panel" id="meta-panel">
          <p class="panel-title">Course Metadata</p>

          <div class="field">
            <label for="meta-title">Title</label>
            <input class="input" id="meta-title" type="text"
              value="${esc(m.title ?? '')}" placeholder="${esc(this.course)}" />
          </div>

          <div class="field">
            <label for="meta-desc">Description</label>
            <textarea class="input" id="meta-desc"
              placeholder="Brief description for SEO and social sharing">${esc(m.description ?? '')}</textarea>
          </div>

          <div class="field">
            <label for="meta-author">Author</label>
            <input class="input" id="meta-author" type="text"
              value="${esc(m.author ?? '')}" placeholder="Your name" />
          </div>

          <div class="field">
            <label for="meta-tags">Tags</label>
            <input class="input" id="meta-tags" type="text"
              value="${esc((m.tags ?? []).join(', '))}" placeholder="e.g. programming, web, beginner" />
            <span class="field-hint">Comma-separated</span>
          </div>

          <div class="field">
            <label for="meta-thumb">Thumbnail</label>
            <input class="input" id="meta-thumb" type="text"
              value="${esc(m.thumbnail ?? '')}" placeholder="e.g. thumbnail.jpg (from Files)" />
            <span class="field-hint">Filename in your project's Files (_inject/) folder</span>
          </div>

          <div class="form-row">
            <button class="btn btn-primary" id="btn-meta-save">Save</button>
            ${this.#metaMsg
              ? `<span class="${this.#metaMsg.ok ? 'form-ok' : 'form-error'}">${esc(this.#metaMsg.text)}</span>`
              : ''}
          </div>
        </div>
      ` : ''}

      ${this.#editingExport ? `
        <div class="panel" id="export-panel">
          <p class="panel-title">Export Directory</p>
          <p style="font-size:13px;color:var(--text-muted);margin:0">
            Exported courses will be placed as subdirectories here.
            ${this.#exportDir
              ? `Current: <span class="export-dir-path">${esc(this.#exportDir)}</span>`
              : '<span class="export-dir-unset">Not set — browse to select a folder.</span>'}
          </p>
          ${this.#exportMsg
            ? `<span class="${this.#exportMsg.ok ? 'form-ok' : 'form-error'}">${esc(this.#exportMsg.text)}</span>`
            : ''}
          <dir-browser></dir-browser>
        </div>
      ` : ''}

      ${this.#creating ? `
        <form class="create-box" id="form-create">
          <label for="inp-name">Module name</label>
          <input class="input" id="inp-name" type="text"
            placeholder="e.g. introduction" autocomplete="off" />
          <div class="form-row">
            <button class="btn btn-primary" id="btn-submit" type="submit">Create</button>
            <button class="btn" id="btn-cancel" type="button">Cancel</button>
          </div>
          <span class="form-error" id="form-error"></span>
        </form>
      ` : ''}

      ${this.#loading ? `<p class="state-msg">Loading…</p>` : ''}
      ${this.#error   ? `<p class="error-msg">${esc(this.#error)}</p>` : ''}

      ${!this.#loading && !this.#error ? `
        <div class="modules-header">
          <span class="section-label">Modules</span>
          ${!this.#creating ? `<button class="btn" id="btn-new">+ New Module</button>` : ''}
        </div>
        <div class="module-list" id="list">
          ${this.#modules.length === 0
            ? `<p class="state-msg">No modules yet — create your first one.</p>`
            : this.#modules.map((mod, i) => `
                <div class="module-card" data-name="${esc(mod)}" data-idx="${i}" draggable="true">
                  <div class="module-left">
                    <span class="drag-handle" title="Drag to reorder">⠿</span>
                    <div>
                      <div class="module-idx">${i + 1}</div>
                      <div class="module-name">${esc(mod)}</div>
                    </div>
                  </div>
                  <span class="module-arrow">›</span>
                </div>
              `).join('')}
        </div>
      ` : ''}
    `;

    // ── Back ────────────────────────────────────────────────────────────────
    sr.querySelector('#btn-back')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('nav-back', { bubbles: true, composed: true }));
    });

    // ── Metadata panel toggle ───────────────────────────────────────────────
    sr.querySelector('#btn-meta')?.addEventListener('click', () => {
      this.#editingMeta  = !this.#editingMeta;
      this.#editingExport = false;
      this.#metaMsg = null;
      this.#render();
      if (this.#editingMeta) sr.querySelector('#meta-title')?.focus();
    });

    sr.querySelector('#btn-meta-save')?.addEventListener('click', async () => {
      const btn = sr.querySelector('#btn-meta-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const tags = sr.querySelector('#meta-tags').value
          .split(',').map(t => t.trim()).filter(Boolean);
        const data = {
          title:       sr.querySelector('#meta-title').value.trim()   || undefined,
          description: sr.querySelector('#meta-desc').value.trim()    || undefined,
          author:      sr.querySelector('#meta-author').value.trim()  || undefined,
          thumbnail:   sr.querySelector('#meta-thumb').value.trim()   || undefined,
          tags:        tags.length ? tags : undefined,
        };
        // strip undefined fields
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await this.#saveMeta(data);
        this.#metaMsg = { ok: true, text: 'Saved' };
      } catch (e) {
        this.#metaMsg = { ok: false, text: e.message };
      }
      this.#render();
    });

    // ── Export panel toggle ─────────────────────────────────────────────────
    sr.querySelector('#btn-export')?.addEventListener('click', () => {
      this.#editingExport = !this.#editingExport;
      this.#editingMeta   = false;
      this.#exportMsg = null;
      this.#render();
    });

    // ── New module form ─────────────────────────────────────────────────────
    sr.querySelector('#btn-new')?.addEventListener('click', () => {
      this.#creating = true;
      this.#render();
      sr.querySelector('#inp-name')?.focus();
    });

    sr.querySelector('#btn-cancel')?.addEventListener('click', () => {
      this.#creating = false;
      this.#render();
    });

    sr.querySelector('#form-create')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name    = sr.querySelector('#inp-name')?.value?.trim() ?? '';
      const btn     = sr.querySelector('#btn-submit');
      const errorEl = sr.querySelector('#form-error');
      if (!name) return;
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const res  = await fetch(`/api/modules/${enc(this.course)}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        this.#modules = [...this.#modules, data.name];
        this.#creating = false;
        this.#render();
      } catch (err) {
        errorEl.textContent = err.message;
        btn.disabled = false; btn.textContent = 'Create';
      }
    });

    // ── Click to open module ────────────────────────────────────────────────
    sr.querySelectorAll('.module-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.drag-handle')) return;
        this.dispatchEvent(new CustomEvent('module-open', {
          detail:   { course: this.course, name: el.dataset.name },
          bubbles:  true,
          composed: true,
        }));
      });
    });

    // ── Drag-to-reorder ─────────────────────────────────────────────────────
    sr.querySelectorAll('.module-card').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        this.#dragIdx = parseInt(el.dataset.idx);
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', el.dataset.idx);
      });

      el.addEventListener('dragend', () => {
        this.#dragIdx = null;
        this.#dropIdx = null;
        sr.querySelectorAll('.module-card').forEach(c => c.classList.remove('drag-over', 'dragging'));
      });

      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const idx = parseInt(el.dataset.idx);
        if (idx !== this.#dropIdx) {
          this.#dropIdx = idx;
          sr.querySelectorAll('.module-card').forEach(c => {
            const i = parseInt(c.dataset.idx);
            c.classList.toggle('drag-over', i === idx && i !== this.#dragIdx);
          });
        }
      });

      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));

      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = this.#dragIdx;
        const to   = parseInt(el.dataset.idx);
        if (from === null || from === to) return;
        const mods = [...this.#modules];
        const [item] = mods.splice(from, 1);
        mods.splice(to, 0, item);
        this.#modules = mods;
        this.#dragIdx = null;
        this.#dropIdx = null;
        this.#render();
        this.#saveOrder();
      });
    });
  }
}

const enc = encodeURIComponent;
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

customElements.define('course-view', CourseView);
