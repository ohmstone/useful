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

  connectedCallback()        { this.#render(); }
  attributeChangedCallback() { this.#render(); }

  #render() {
    const { name } = this;
    const count = this.#contents.length;
    const meta = count === 1 ? '1 module' : `${count} modules`;

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="card">
        <div class="name">${esc(name)}</div>
        <div class="meta">${meta}</div>
      </div>
    `;

    this.shadowRoot.querySelector('.card').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('course-open', {
        detail:   { name: this.name },
        bubbles:  true,
        composed: true,
      }));
    });
  }
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('course-card', CourseCard);
