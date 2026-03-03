// <slide-preview> — 16:9 preview of parsed slides.
// Set .slides = [{ duration, content }] and navigate with prev/next.
//
// Slide text format parsed by the parent (module-editor):
//   === <seconds>
//   Slide content here.

const STYLES = `
  :host { display: flex; flex-direction: column; gap: 10px; }

  .stage {
    aspect-ratio: 16 / 9;
    background: #0d0d0f;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .slide-text {
    color: #e8e8e8;
    font-size: 18px;
    font-weight: 300;
    text-align: center;
    white-space: pre-wrap;
    word-wrap: break-word;
    padding: 8%;
    line-height: 1.6;
    max-width: 100%;
  }

  .empty-msg {
    color: #333;
    font-size: 13px;
  }

  .slide-meta {
    font-size: 11px;
    color: var(--text-dim);
    text-align: right;
  }

  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }

  .nav-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-size: 13px;
    font-family: var(--font);
    padding: 4px 12px;
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s;
  }
  .nav-btn:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
  .nav-btn:disabled { opacity: 0.3; cursor: default; }

  .slide-count { font-size: 12px; color: var(--text-muted); }
`;

export function parseSlides(text) {
  const slides = [];
  const blocks = text.split(/^===[ \t]+/m);
  for (const block of blocks) {
    const trimmed = block.trimStart();
    if (!trimmed) continue;
    const nl = trimmed.indexOf('\n');
    const durationStr = nl >= 0 ? trimmed.slice(0, nl) : trimmed;
    const content     = nl >= 0 ? trimmed.slice(nl + 1).trim() : '';
    const duration    = parseFloat(durationStr) || 5;
    slides.push({ duration, content });
  }
  return slides;
}

class SlidePreview extends HTMLElement {
  #slides = [];
  #index  = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  set slides(val) {
    this.#slides = Array.isArray(val) ? val : [];
    this.#index  = Math.min(this.#index, Math.max(0, this.#slides.length - 1));
    this.#render();
  }

  connectedCallback() { this.#render(); }

  #render() {
    const sr     = this.shadowRoot;
    const slides = this.#slides;
    const idx    = this.#index;
    const slide  = slides[idx];
    const total  = slides.length;

    sr.innerHTML = `
      <style>${STYLES}</style>

      <div class="stage">
        ${slide
          ? `<div class="slide-text">${esc(slide.content)}</div>`
          : `<div class="empty-msg">No slides yet — write some above.</div>`}
      </div>

      ${slide ? `<div class="slide-meta">${slide.duration}s</div>` : ''}

      <div class="nav">
        <button class="nav-btn" id="btn-prev" ${idx === 0 ? 'disabled' : ''}>← Prev</button>
        <span class="slide-count">${total === 0 ? '—' : `${idx + 1} / ${total}`}</span>
        <button class="nav-btn" id="btn-next" ${idx >= total - 1 ? 'disabled' : ''}>Next →</button>
      </div>
    `;

    sr.querySelector('#btn-prev')?.addEventListener('click', () => {
      if (this.#index > 0) { this.#index--; this.#render(); }
    });
    sr.querySelector('#btn-next')?.addEventListener('click', () => {
      if (this.#index < this.#slides.length - 1) { this.#index++; this.#render(); }
    });
  }
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('slide-preview', SlidePreview);
