// <dir-browser> — filesystem navigator for selecting a project directory.
//
// Fetches GET /api/browse?path= to list subdirectories.
// Dispatches 'dir-selected' (bubbles, composed) with { path: string } when
// the user either clicks "Use this folder" or creates a new folder.

const STYLES = `
  :host { display: block; }

  /* ── Breadcrumb ── */
  .breadcrumb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin-bottom: 10px;
  }
  .crumb {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 12px;
    font-family: var(--font);
    cursor: pointer;
    padding: 2px 5px;
    border-radius: var(--radius);
    transition: color 0.1s, background 0.1s;
  }
  .crumb:hover             { color: var(--text); background: var(--surface-raised); }
  .crumb.current           { color: var(--text); cursor: default; }
  .crumb.current:hover     { background: none; }
  .sep                     { color: var(--text-dim); font-size: 11px; user-select: none; }

  /* ── Directory list ── */
  .dir-list {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    max-height: 220px;
    overflow-y: auto;
    margin-bottom: 14px;
  }
  .dir-entry {
    display: flex;
    align-items: center;
    padding: 7px 12px;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    transition: background 0.1s;
    gap: 8px;
  }
  .dir-entry:last-child { border-bottom: none; }
  .dir-entry:hover      { background: var(--surface-raised); }
  .dir-arrow            { color: var(--text-dim); font-size: 11px; margin-left: auto; }

  .empty {
    padding: 18px 12px;
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
  }

  /* ── Actions ── */
  .actions { display: flex; flex-direction: column; gap: 12px; }

  .btn {
    display: inline-flex;
    align-items: center;
    padding: 8px 16px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .btn:hover    { border-color: var(--accent); background: var(--surface-raised); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .btn-primary              { background: var(--accent-deep); border-color: var(--accent-deep); color: #fff; }
  .btn-primary:hover        { background: var(--accent); border-color: var(--accent); }

  .divider {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .divider::before, .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .create-row { display: flex; gap: 8px; align-items: center; }
  .input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 7px 12px;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font);
    outline: none;
    transition: border-color 0.15s;
  }
  .input:focus        { border-color: var(--accent); }
  .input::placeholder { color: var(--text-dim); }

  .msg       { font-size: 13px; color: var(--text-muted); }
  .error-msg { font-size: 12px; color: var(--danger); min-height: 16px; }
`;

class DirBrowser extends HTMLElement {
  #path    = null;
  #entries = [];
  #loading = true;
  #error   = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.#navigate(null); // null → server defaults to $HOME
  }

  async #navigate(path) {
    this.#loading = true;
    this.#error   = null;
    this.#render();
    try {
      const url  = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
      const res  = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      this.#path    = data.path;
      this.#entries = data.entries;
    } catch (e) {
      this.#error = e.message;
    }
    this.#loading = false;
    this.#render();
  }

  #crumbs() {
    const parts  = (this.#path ?? '').split('/').filter(Boolean);
    const result = [{ label: '/', path: '/' }];
    let acc = '';
    for (const p of parts) {
      acc += '/' + p;
      result.push({ label: p, path: acc });
    }
    return result;
  }

  #emit(path) {
    this.dispatchEvent(new CustomEvent('dir-selected', {
      detail:   { path },
      bubbles:  true,
      composed: true,
    }));
  }

  async #createFolder(name, btn, errorEl) {
    btn.disabled    = true;
    btn.textContent = 'Creating…';
    errorEl.textContent = '';
    try {
      const res  = await fetch('/api/mkdir', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ parent: this.#path, name }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      this.#emit(data.path);
    } catch (e) {
      errorEl.textContent = e.message;
      btn.disabled        = false;
      btn.textContent     = 'Create & Use';
    }
  }

  #render() {
    const sr      = this.shadowRoot;
    const crumbs  = this.#crumbs();
    const entries = this.#entries;

    sr.innerHTML = `
      <style>${STYLES}</style>

      ${!this.#loading ? `
        <div class="breadcrumb">
          ${crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return `
              ${i > 0 ? `<span class="sep">›</span>` : ''}
              <button class="crumb${last ? ' current' : ''}" data-path="${esc(c.path)}">
                ${esc(c.label)}
              </button>
            `;
          }).join('')}
        </div>
      ` : ''}

      ${this.#loading ? `<p class="msg">Loading…</p>` : `
        <div class="dir-list">
          ${entries.length === 0
            ? `<div class="empty">No subdirectories here</div>`
            : entries.map(e => `
                <div class="dir-entry" data-path="${esc(this.#path + '/' + e.name)}">
                  <span>${esc(e.name)}</span>
                  <span class="dir-arrow">›</span>
                </div>
              `).join('')}
        </div>

        <div class="actions">
          <button class="btn btn-primary" id="btn-use">Use this folder</button>
          <div class="divider">or create a new folder here</div>
          <form id="form-create">
            <div class="create-row">
              <input class="input" id="inp-name" type="text"
                placeholder="new-folder-name" autocomplete="off" spellcheck="false" />
              <button class="btn" id="btn-create" type="submit">Create & Use</button>
            </div>
          </form>
          <div class="error-msg" id="create-error"></div>
        </div>
      `}

      ${this.#error ? `<p class="error-msg">${esc(this.#error)}</p>` : ''}
    `;

    // Breadcrumb navigation
    sr.querySelectorAll('.crumb:not(.current)').forEach(el => {
      el.addEventListener('click', () => this.#navigate(el.dataset.path));
    });

    // Directory entry click → navigate into it
    sr.querySelectorAll('.dir-entry').forEach(el => {
      el.addEventListener('click', () => this.#navigate(el.dataset.path));
    });

    // Use current folder
    sr.querySelector('#btn-use')?.addEventListener('click', () => {
      this.#emit(this.#path);
    });

    // Create new folder
    sr.querySelector('#form-create')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name    = sr.querySelector('#inp-name')?.value?.trim() ?? '';
      const btn     = sr.querySelector('#btn-create');
      const errorEl = sr.querySelector('#create-error');
      if (name) this.#createFolder(name, btn, errorEl);
    });
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

customElements.define('dir-browser', DirBrowser);
