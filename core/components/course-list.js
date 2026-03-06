// <course-list> — fetches and displays all courses in the project directory.
// Dispatches nothing upward; handles all course CRUD internally.

const STYLES = `
  :host { display: block; }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /* ── Buttons ── */
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
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .btn:hover  { border-color: var(--accent); background: var(--surface-raised); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .btn-primary {
    background: var(--accent-deep);
    border-color: var(--accent-deep);
    color: #fff;
  }
  .btn-primary:hover { background: var(--accent); border-color: var(--accent); }

  /* ── New-course form ── */
  .create-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .create-box label {
    font-size: 12px;
    color: var(--text-muted);
  }
  .input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 12px;
    color: var(--text);
    outline: none;
    transition: border-color 0.15s;
  }
  .input:focus { border-color: var(--accent); }
  .input::placeholder { color: var(--text-dim); }

  .form-row { display: flex; gap: 8px; align-items: center; }
  .form-error { font-size: 12px; color: var(--danger); }

  /* ── Search ── */
  .search-row {
    margin-bottom: 16px;
  }
  .search-input {
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
  .search-input:focus { border-color: var(--accent); }
  .search-input::placeholder { color: var(--text-dim); }

  /* ── Course grid ── */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }

  .state-msg {
    font-size: 14px;
    color: var(--text-muted);
    padding: 40px 0;
    text-align: center;
  }
  .state-msg.error { color: var(--danger); text-align: left; }
`;

class CourseList extends HTMLElement {
  #courses  = [];
  #loading  = true;
  #error    = null;
  #creating = false;
  #search   = '';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.#load(); }

  async #load() {
    this.#loading = true;
    this.#error   = null;
    this.#render();
    try {
      const res  = await fetch('/api/courses');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      this.#courses = data;
    } catch (e) {
      this.#error = e.message;
    }
    this.#loading = false;
    this.#render();
  }

  async #createCourse(name, submitBtn, errorEl) {
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Creating…';
    errorEl.textContent   = '';
    try {
      const res  = await fetch('/api/courses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      this.#courses  = [...this.#courses, data].sort((a, b) => a.name.localeCompare(b.name));
      this.#creating = false;
      this.#render();
    } catch (e) {
      errorEl.textContent   = e.message;
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Create';
    }
  }

  #render() {
    const sr = this.shadowRoot;
    sr.innerHTML = `
      <style>${STYLES}</style>

      <div class="header">
        <span class="section-label">Courses</span>
        ${!this.#creating ? `<button class="btn" id="btn-new">+ New Course</button>` : ''}
      </div>

      ${this.#creating ? `
        <form class="create-box" id="form-create">
          <label for="inp-name">Course name</label>
          <input class="input" id="inp-name" type="text"
            placeholder="e.g. intro-to-typescript" autocomplete="off" />
          <div class="form-row">
            <button class="btn btn-primary" id="btn-submit" type="submit">Create</button>
            <button class="btn" id="btn-cancel" type="button">Cancel</button>
          </div>
          <span class="form-error" id="form-error"></span>
        </form>
      ` : ''}

      ${this.#loading  ? `<p class="state-msg">Loading…</p>` : ''}
      ${this.#error    ? `<p class="state-msg error">${esc(this.#error)}</p>` : ''}

      ${!this.#loading && !this.#error ? (() => {
        const visible = this.#courses.filter(c =>
          !this.#search || c.name.toLowerCase().includes(this.#search.toLowerCase())
        );
        if (this.#courses.length === 0) return `<p class="state-msg">No courses yet — create your first one.</p>`;
        return `
          <div class="search-row">
            <input class="search-input" id="search" type="search"
              placeholder="Search courses…" value="${esc(this.#search)}" autocomplete="off" />
          </div>
          ${visible.length === 0
            ? `<p class="state-msg">No courses match "${esc(this.#search)}"</p>`
            : `<div class="grid" id="grid"></div>`}
        `;
      })() : ''}
    `;

    // Populate course cards (avoids innerHTML injection of user data)
    const grid = sr.querySelector('#grid');
    if (grid) {
      const visible = this.#courses.filter(c =>
        !this.#search || c.name.toLowerCase().includes(this.#search.toLowerCase())
      );
      for (const course of visible) {
        const card = document.createElement('course-card');
        card.setAttribute('name', course.name);
        card.contents = course.contents;
        grid.appendChild(card);
      }
    }

    // Search input — preserve value, update filter reactively
    const searchEl = sr.querySelector('#search');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        this.#search = searchEl.value;
        this.#render();
        // Restore focus and cursor position after re-render
        const next = sr.querySelector('#search');
        if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
      });
    }

    // Wire up buttons
    sr.querySelector('#btn-new')?.addEventListener('click', () => {
      this.#creating = true;
      this.#render();
      this.shadowRoot.querySelector('#inp-name')?.focus();
    });

    sr.querySelector('#btn-cancel')?.addEventListener('click', () => {
      this.#creating = false;
      this.#render();
    });

    sr.querySelector('#form-create')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name      = sr.querySelector('#inp-name')?.value?.trim() ?? '';
      const submitBtn = sr.querySelector('#btn-submit');
      const errorEl   = sr.querySelector('#form-error');
      if (!name) return;
      this.#createCourse(name, submitBtn, errorEl);
    });
  }
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('course-list', CourseList);
