// <course-view course="..."> — shows the ordered module list for a course.
// Each module card dispatches 'module-open' (bubbles, composed) when clicked.
// Modules can be reordered by dragging; order is persisted via PUT /api/modules/:course.

const STYLES = `
  :host { display: block; }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

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
  }
  .btn:hover { border-color: var(--accent); background: var(--surface-raised); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-primary { background: var(--accent-deep); border-color: var(--accent-deep); color: #fff; }
  .btn-primary:hover { background: var(--accent); border-color: var(--accent); }

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

  /* Create form */
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
  .input {
    width: 100%;
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
  .form-row { display: flex; gap: 8px; }
  .form-error { font-size: 12px; color: var(--danger); }

  .state-msg { font-size: 14px; color: var(--text-muted); padding: 32px 0; text-align: center; }
  .error-msg { font-size: 13px; color: var(--danger); }
`;

class CourseView extends HTMLElement {
  static observedAttributes = ['course'];

  #modules  = [];
  #loading  = true;
  #creating = false;
  #error    = null;
  #dragIdx  = null;
  #dropIdx  = null;

  get course() { return this.getAttribute('course') ?? ''; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback()        { this.#load(); }
  attributeChangedCallback() { if (this.isConnected) this.#load(); }

  async #load() {
    this.#loading = true;
    this.#error   = null;
    this.#render();
    try {
      const res  = await fetch(`/api/modules/${enc(this.course)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      this.#modules = data;
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

  #render() {
    const sr = this.shadowRoot;
    sr.innerHTML = `
      <style>${STYLES}</style>

      <div class="header">
        <div style="display:flex;align-items:center;gap:16px">
          <button class="back-btn" id="btn-back">← Back</button>
          <span class="section-label">Modules</span>
        </div>
        ${!this.#creating ? `<button class="btn" id="btn-new">+ New Module</button>` : ''}
      </div>

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
        <div class="module-list" id="list">
          ${this.#modules.length === 0
            ? `<p class="state-msg">No modules yet — create your first one.</p>`
            : this.#modules.map((m, i) => `
                <div class="module-card" data-name="${esc(m)}" data-idx="${i}" draggable="true">
                  <div class="module-left">
                    <span class="drag-handle" title="Drag to reorder">⠿</span>
                    <div>
                      <div class="module-idx">${i + 1}</div>
                      <div class="module-name">${esc(m)}</div>
                    </div>
                  </div>
                  <span class="module-arrow">›</span>
                </div>
              `).join('')}
        </div>
      ` : ''}
    `;

    sr.querySelector('#btn-back')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('nav-back', { bubbles: true, composed: true }));
    });

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

    // Click to open (not on drag handle)
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

    // Drag-to-reorder
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
