// <app-root> — top-level shell. Manages app state and renders the active view.
// States: loading → setup (no projectDir) | ready (projectDir configured)

const STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Header ── */
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
  .logo em {
    font-style: normal;
    color: var(--accent);
  }

  .project-path {
    font-size: 11px;
    color: var(--text-dim);
    font-family: monospace;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Main content ── */
  main {
    flex: 1;
    overflow-y: auto;
    padding: 28px 24px;
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
  #state  = 'loading'; // 'loading' | 'setup' | 'ready'
  #config = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // Listen for config-updated bubbling up from dir-picker (composed event)
    this.addEventListener('config-updated', (e) => {
      this.#config = e.detail;
      this.#state  = 'ready';
      this.#render();
    });
  }

  connectedCallback() {
    this.#render();
    this.#loadConfig();
  }

  async #loadConfig() {
    try {
      const res   = await fetch('/api/config');
      this.#config = await res.json();
      this.#state  = this.#config.projectDir ? 'ready' : 'setup';
    } catch {
      this.#state = 'setup';
    }
    this.#render();
  }

  #render() {
    const state  = this.#state;
    const config = this.#config;

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>

      <header>
        <div class="logo">use<em>ful</em></div>
        ${config?.projectDir
          ? `<div class="project-path">${esc(config.projectDir)}</div>`
          : ''}
      </header>

      <main>
        ${state === 'loading' ? `<div class="centered">Loading…</div>` : ''}
        ${state === 'setup'   ? `<dir-picker></dir-picker>`             : ''}
        ${state === 'ready'   ? `<course-list></course-list>`           : ''}
      </main>
    `;
  }
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('app-root', AppRoot);
