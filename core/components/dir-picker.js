// <dir-picker> — first-run project directory setup.
// Wraps <dir-browser> in a card. Listens for 'dir-selected', saves the config,
// then dispatches 'config-updated' (bubbles, composed) to <app-root>.

const STYLES = `
  :host {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 28px 32px;
    width: 100%;
    max-width: 540px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
  }

  .description {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.7;
    margin-top: -8px;
  }

  .error {
    font-size: 12px;
    color: var(--danger);
    min-height: 16px;
  }
`;

class DirPicker extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // Catch dir-selected bubbling up from <dir-browser> through shadow boundaries
    this.addEventListener('dir-selected', (e) => this.#setProjectDir(e.detail.path));
  }

  connectedCallback() {
    this.#render();
  }

  async #setProjectDir(path) {
    try {
      const res  = await fetch('/api/config', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectDir: path }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      this.dispatchEvent(new CustomEvent('config-updated', {
        detail:   data,
        bubbles:  true,
        composed: true,
      }));
    } catch (e) {
      // Write error without re-rendering — preserves dir-browser navigation state
      const el = this.shadowRoot.querySelector('#error');
      if (el) el.textContent = e.message;
    }
  }

  #render() {
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="card">
        <div class="title">Set up your project</div>
        <div class="description">
          Browse to the directory where you'd like to store your courses,
          then select it or create a new folder within it.
        </div>
        <dir-browser></dir-browser>
        <div class="error" id="error"></div>
      </div>
    `;
  }
}

customElements.define('dir-picker', DirPicker);
