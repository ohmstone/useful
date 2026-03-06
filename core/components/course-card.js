// <course-card name="..."> — displays a single course directory.
// Set .contents = string[] after inserting into the DOM.

const STYLES = `
  :host { display: block; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    user-select: none;
  }
  .card:hover {
    border-color: var(--accent-deep);
    background: var(--surface-raised);
  }

  .name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 10px;
  }
  .meta:last-child { margin-bottom: 0; }

  .contents {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item {
    font-size: 12px;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 1px 0;
  }
  .item::before {
    content: '';
    display: block;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--text-dim);
    flex-shrink: 0;
  }
  .overflow {
    font-size: 12px;
    color: var(--text-muted);
    padding: 2px 0 0 11px;
  }
`;

class CourseCard extends HTMLElement {
  static observedAttributes = ['name'];

  #contents = [];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get name() { return this.getAttribute('name') ?? ''; }

  set contents(val) {
    this.#contents = Array.isArray(val) ? val : [];
    this.#render();
  }

  connectedCallback()            { this.#render(); }
  attributeChangedCallback()     { this.#render(); }

  #render() {
    const { name } = this;
    const items = this.#contents;
    const visible = items.slice(0, 8);
    const overflow = items.length - visible.length;
    const meta = items.length === 1 ? '1 item' : `${items.length} items`;

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="card">
        <div class="name">${esc(name)}</div>
        <div class="meta">${meta}</div>
        ${visible.length ? `
          <div class="contents">
            ${visible.map(c => `<div class="item">${esc(c)}</div>`).join('')}
            ${overflow ? `<div class="overflow">+${overflow} more</div>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('course-card', CourseCard);
