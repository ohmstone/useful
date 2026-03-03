// <app-root> — top-level shell. Owns the app state machine and navigation stack.
//
// States:   loading → setup (no projectDir) | ready (projectDir set)
// Navigation (when ready):
//   null                          → course list
//   { type:'course', course }     → course module list
//   { type:'module', course, mod} → module editor

const STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 48px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--bg);
  }

  .logo {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.02em;
  }
  .logo em { font-style: normal; color: var(--accent); }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .breadcrumb .sep { color: var(--text-dim); }
  .breadcrumb .cur { color: var(--text); }

  main {
    flex: 1;
    overflow-y: auto;
    padding: 28px 24px;
  }
  main.editor-view {
    padding: 0;
    overflow: hidden;
  }

  .centered {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 14px;
  }

  dir-picker { height: 100%; }
`;

class AppRoot extends HTMLElement {
  #state = 'loading'; // 'loading' | 'setup' | 'ready'
  #config = null;
  #nav = null; // null | { type:'course', course } | { type:'module', course, mod }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.addEventListener('config-updated', (e) => {
      this.#config = e.detail;
      this.#state  = 'ready';
      this.#nav    = null;
      this.#render();
    });

    this.addEventListener('course-open', (e) => {
      this.#nav = { type: 'course', course: e.detail.name };
      this.#render();
    });

    this.addEventListener('module-open', (e) => {
      this.#nav = { type: 'module', course: e.detail.course, mod: e.detail.name };
      this.#render();
    });

    this.addEventListener('nav-back', () => {
      if (this.#nav?.type === 'module') {
        this.#nav = { type: 'course', course: this.#nav.course };
      } else {
        this.#nav = null;
      }
      this.#render();
    });
  }

  connectedCallback() {
    this.#render();
    this.#loadConfig();
  }

  async #loadConfig() {
    try {
      const res    = await fetch('/api/config');
      this.#config = await res.json();
      this.#state  = this.#config.projectDir ? 'ready' : 'setup';
    } catch {
      this.#state = 'setup';
    }
    this.#render();
  }

  #breadcrumb() {
    const nav = this.#nav;
    if (!nav) return '';
    if (nav.type === 'course') {
      return `<span>Courses</span><span class="sep">›</span><span class="cur">${esc(nav.course)}</span>`;
    }
    if (nav.type === 'module') {
      return `<span>Courses</span><span class="sep">›</span><span>${esc(nav.course)}</span><span class="sep">›</span><span class="cur">${esc(nav.mod)}</span>`;
    }
    return '';
  }

  #mainView() {
    const { '#state': state, '#nav': nav } = { '#state': this.#state, '#nav': this.#nav };
    if (state === 'loading') return `<div class="centered">Loading…</div>`;
    if (state === 'setup')   return `<dir-picker></dir-picker>`;
    if (!nav)                return `<course-list></course-list>`;
    if (nav.type === 'course') {
      return `<course-view course="${esc(nav.course)}"></course-view>`;
    }
    if (nav.type === 'module') {
      return `<module-editor course="${esc(nav.course)}" module="${esc(nav.mod)}"></module-editor>`;
    }
    return '';
  }

  #render() {
    const isEditor = this.#nav?.type === 'module';
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <header>
        <div class="logo">use<em>ful</em></div>
        <div class="breadcrumb">${this.#breadcrumb()}</div>
      </header>
      <main class="${isEditor ? 'editor-view' : ''}">
        ${this.#mainView()}
      </main>
    `;
  }
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('app-root', AppRoot);
