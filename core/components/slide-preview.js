// <slide-preview> — 16:9 rich slide renderer.
//
// API:
//   set slides(parsedSlides)  — replace slide array, re-render
//   set currentIndex(n)       — jump to slide n, re-render
//   set slideTime(t)          — update sub-slide time (seconds); triggers emph/inject, no full re-render
//
// parseSlides is no longer exported here — import from ../slide-parser.js

import { parseInline } from '../slide-parser.js';

// ── Styles ───────────────────────────────────────────────────────────────────

const STYLES = `
  :host { display: flex; flex-direction: column; gap: 10px; }

  /* ── Stage ── */
  .stage {
    aspect-ratio: 16 / 9;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    position: relative;
    background: #12121a;
    display: block;
  }

  /* ── Slide ── */
  .slide {
    position: absolute; inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font);
  }

  /* ── Header bar ── */
  .slide-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2.5% 5%;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    flex-shrink: 0;
    gap: 8px;
    font-size: 1.3em;
  }
  .slide-header img { height: 1.6em; object-fit: contain; vertical-align: middle; }
  .hdr-right { text-align: right; }

  /* ── Body ── */
  .slide-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 4% 7%;
    gap: 0.6em;
    overflow: hidden;
    min-height: 0;
  }

  /* ── Columns ── */
  .columns {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .col-inner {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 4% 5%;
    gap: 0.5em;
    overflow: hidden;
  }

  /* ── Block: paragraph ── */
  .para        { margin: 0; line-height: 1.55; }
  .para.big    { font-size: 1.55em; }
  .para.small  { font-size: 0.75em; }
  .para.center { text-align: center; }
  .para.right  { text-align: right; }

  /* ── Block: heading ── */
  .h1 { font-size: 2em;   font-weight: 700; line-height: 1.2; margin: 0; }
  .h2 { font-size: 1.4em; font-weight: 600; line-height: 1.3; margin: 0; }
  .h1.center, .h2.center { text-align: center; }
  .h1.right,  .h2.right  { text-align: right; }

  /* ── Block: list ── */
  ul, ol {
    margin: 0;
    padding-left: 1.4em;
    line-height: 1.6;
  }
  ul.big li, ol.big li { font-size: 1.35em; }
  ul.small li, ol.small li { font-size: 0.75em; }
  ul.center, ol.center { text-align: center; list-style-position: inside; padding-left: 0; }

  /* ── Block: code ── */
  .code-block {
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    padding: 0.7em 1em;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.72em;
    white-space: pre;
    overflow: auto;
    line-height: 1.5;
  }

  /* ── Block: image ── */
  .img-wrap      { display: flex; justify-content: center; align-items: center; overflow: hidden; }
  .img-wrap.cover   { flex: 1; }
  .img-wrap img  { display: block; }
  .img-cover     { width: 100%; height: 100%; object-fit: cover; }
  .img-contain   { max-width: 100%; max-height: 14em; object-fit: contain; }

  /* ── Inline styles ── */
  strong { font-weight: 700; }
  em     { font-style: italic; }
  u      { text-decoration: underline; }

  /* ── Emph block ── */
  .emph-indicator {
    border-left: 2px solid rgba(255, 200, 60, 0.5);
    padding-left: 0.6em;
    display: flex;
    flex-direction: column;
    gap: 0.3em;
  }
  .emph-label {
    font-size: 0.6em;
    opacity: 0.5;
    font-style: italic;
    letter-spacing: 0.04em;
  }

  /* ── Emph dimming (active during playback) ── */
  .emph-active .block:not(.is-emph) { opacity: 0.1; transition: opacity 0.25s; }
  .emph-active .block.is-emph       { opacity: 1;   transition: opacity 0.25s; }
  .block { transition: opacity 0.25s; }

  /* ── Inject block ── */
  .inject-slot {
    border: 1px dashed rgba(120, 180, 255, 0.35);
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 5em;
    position: relative;
  }
  .inject-placeholder {
    position: absolute; inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    font-size: 0.65em;
    opacity: 0.45;
    pointer-events: none;
  }
  .inject-output {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  /* ── Nav ── */
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
  .slide-meta  { font-size: 11px; color: var(--text-dim); text-align: right; }
  .empty-msg   { color: #333; font-size: 13px; text-align: center; }
`;

// ── Component ────────────────────────────────────────────────────────────────

class SlidePreview extends HTMLElement {
  #slides    = [];
  #index     = 0;
  #slideTime = -1;      // -1 = not in playback
  #injectCache = new Map();  // file → module default export fn

  constructor() { super(); this.attachShadow({ mode: 'open' }); }

  connectedCallback() { this.#renderFull(); }

  set slides(val) {
    this.#slides    = Array.isArray(val) ? val : [];
    this.#index     = Math.min(this.#index, Math.max(0, this.#slides.length - 1));
    this.#slideTime = -1;
    this.#renderFull();
  }

  set currentIndex(val) {
    const idx = Math.max(0, Math.min(Math.floor(val), this.#slides.length - 1));
    if (idx !== this.#index) { this.#index = idx; this.#slideTime = -1; this.#renderFull(); }
  }

  set slideTime(t) {
    this.#slideTime = t;
    this.#updateTiming();
  }

  // ── Full render ────────────────────────────────────────────────────────────

  #renderFull() {
    const sr    = this.shadowRoot;
    const slide = this.#slides[this.#index];
    const total = this.#slides.length;
    const idx   = this.#index;

    sr.innerHTML = `<style>${STYLES}</style>
      <div class="stage">
        ${slide ? this.#buildSlide(slide) : `<div style="display:flex;align-items:center;justify-content:center;height:100%"><div class="empty-msg">No slides yet — write some above.</div></div>`}
      </div>
      ${slide ? `<div class="slide-meta">${slide.duration}s</div>` : ''}
      <div class="nav">
        <button class="nav-btn" id="btn-prev" ${idx === 0 ? 'disabled' : ''}>← Prev</button>
        <span class="slide-count">${total === 0 ? '—' : `${idx + 1} / ${total}`}</span>
        <button class="nav-btn" id="btn-next" ${idx >= total - 1 ? 'disabled' : ''}>Next →</button>
      </div>`;

    sr.querySelector('#btn-prev')?.addEventListener('click', () => {
      if (this.#index > 0) { this.#index--; this.#slideTime = -1; this.#renderFull(); }
    });
    sr.querySelector('#btn-next')?.addEventListener('click', () => {
      if (this.#index < this.#slides.length - 1) { this.#index++; this.#slideTime = -1; this.#renderFull(); }
    });
  }

  // ── Build slide HTML ───────────────────────────────────────────────────────

  #buildSlide(slide) {
    const textColor = autoTextColor(slide.bg);
    const bgStyle   = slide.bg ? `background:${slide.bg};` : '';
    const colorStyle = `color:${textColor};`;

    let headerHtml = '';
    if (slide.header) {
      headerHtml = `<div class="slide-header" style="${colorStyle}">
        <span class="hdr-left">${spansToHTML(parseInline(slide.header.left))}</span>
        <span class="hdr-right">${spansToHTML(parseInline(slide.header.right))}</span>
      </div>`;
    }

    const bodyHtml = this.#buildBody(slide.body, textColor);

    return `<div class="slide" style="${bgStyle}${colorStyle}">
      ${headerHtml}
      <div class="slide-body" id="slide-body">${bodyHtml}</div>
    </div>`;
  }

  #buildBody(blocks, textColor, blockIdPrefix = '') {
    return blocks.map((b, i) => {
      const bid = blockIdPrefix ? `${blockIdPrefix}-${i}` : String(i);
      return this.#buildBlock(b, i, textColor, bid);
    }).join('');
  }

  #buildBlock(b, i, textColor, bid) {
    switch (b.type) {

      case 'paragraph':
        return `<p class="para block ${b.size !== 'normal' ? b.size : ''} ${b.align !== 'left' ? b.align : ''}"
                   style="${b.color ? `color:${b.color}` : ''}"
                   data-block="${bid}">${spansToHTML(b.spans)}</p>`;

      case 'heading': {
        const cls = b.level === 1 ? 'h1' : 'h2';
        return `<div class="${cls} block ${b.align !== 'left' ? b.align : ''}" data-block="${bid}">${spansToHTML(b.spans)}</div>`;
      }

      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = b.items.map(spans => `<li>${spansToHTML(spans)}</li>`).join('');
        return `<${tag} class="block ${b.size !== 'normal' ? b.size : ''} ${b.align !== 'left' ? b.align : ''}"
                         data-block="${bid}">${items}</${tag}>`;
      }

      case 'image':
        return this.#buildImage(b, bid);

      case 'code':
        return `<pre class="code-block block" data-block="${bid}"><code>${escHtml(b.text)}</code></pre>`;

      case 'columns':
        return this.#buildColumns(b, textColor, bid);

      case 'emph':
        return this.#buildEmph(b, textColor, bid);

      case 'inject':
        return this.#buildInject(b, bid);

      default:
        return '';
    }
  }

  #buildImage(b, bid) {
    const isPercent = /^\d+(\.\d+)?%$/.test(b.fit);
    const isCover   = b.fit === 'cover';
    if (isCover) {
      return `<div class="img-wrap cover block" data-block="${bid}" style="flex:1">
        <img class="img-cover" src="${escAttr(b.src)}" alt="${escAttr(b.alt)}">
      </div>`;
    }
    const width = isPercent ? `width:${b.fit}` : '';
    return `<div class="img-wrap block" data-block="${bid}">
      <img class="img-contain" src="${escAttr(b.src)}" alt="${escAttr(b.alt)}" style="${width ? `max-width:${b.fit};height:auto` : ''}">
    </div>`;
  }

  #buildColumns(b, _textColor, bid) {
    const cols = b.cols.map((col, ci) => {
      const bg = col.bg ? `background:${col.bg};` : '';
      const tc = col.bg ? `color:${autoTextColor(col.bg)};` : '';
      const colContent = this.#buildBody(col.blocks, col.bg ? autoTextColor(col.bg) : _textColor, `${bid}-${ci}`);
      return `<div class="col-inner" style="width:${col.width}%;${bg}${tc}">${colContent}</div>`;
    });
    return `<div class="columns block" data-block="${bid}">${cols.join('')}</div>`;
  }

  #buildEmph(b, textColor, bid) {
    // During editing (no slideTime): show with visual indicator showing timing info
    // During playback: emph-mode class on slide-body handles dimming via CSS
    const inner = this.#buildBody(b.blocks, textColor, `${bid}-emph`);
    return `<div class="emph-indicator block is-emph" data-block="${bid}"
               data-emph-start="${b.start}" data-emph-dur="${b.duration}">
      <div class="emph-label">emphasis — at ${b.start}s for ${b.duration}s</div>
      ${inner}
    </div>`;
  }

  #buildInject(b, bid) {
    return `<div class="inject-slot block" data-block="${bid}"
               data-inject-file="${escAttr(b.file)}"
               data-inject-start="${b.start}"
               data-inject-dur="${b.duration}">
      <div class="inject-placeholder">&#x2756; ${escHtml(b.file)} — at ${b.start}s for ${b.duration}s</div>
      <div class="inject-output"></div>
    </div>`;
  }

  // ── Timing update (called every animation frame during playback) ───────────

  #updateTiming() {
    const sr   = this.shadowRoot;
    const body = sr?.querySelector('#slide-body');
    if (!body) return;
    const t = this.#slideTime;

    // — Emph dimming —
    const emphEls  = body.querySelectorAll('[data-emph-start]');
    let emphActive = false;
    for (const el of emphEls) {
      const start = parseFloat(el.dataset.emphStart);
      const dur   = parseFloat(el.dataset.emphDur);
      if (t >= start && t < start + dur) { emphActive = true; break; }
    }
    body.classList.toggle('emph-active', emphActive && t >= 0);

    // — Inject slots —
    const slots = body.querySelectorAll('.inject-slot');
    for (const slot of slots) {
      const start    = parseFloat(slot.dataset.injectStart);
      const dur      = parseFloat(slot.dataset.injectDur);
      const file     = slot.dataset.injectFile;
      const output   = slot.querySelector('.inject-output');
      const ph       = slot.querySelector('.inject-placeholder');
      const isActive = t >= 0 && t >= start && t < start + dur;

      if (isActive) {
        slot.dataset._wasActive = '1';
        ph.style.display = 'none';
        this.#callInject(file, slot, output, t - start, dur - (t - start));
      } else if (slot.dataset._wasActive) {
        // Just became inactive — clear output
        delete slot.dataset._wasActive;
        output.innerHTML = '';
        ph.style.display = '';
      }
    }
  }

  async #callInject(file, slot, outputEl, time, remaining) {
    try {
      if (!this.#injectCache.has(file)) {
        const mod = await import(`/api/inject/${encodeURIComponent(file)}`);
        this.#injectCache.set(file, mod.default);
      }
      const fn = this.#injectCache.get(file);
      if (typeof fn !== 'function') return;

      const rect  = slot.getBoundingClientRect();
      const inFn  = () => ({ width: rect.width, height: rect.height, time, remaining });
      const outFn = el => { outputEl.innerHTML = ''; outputEl.appendChild(el); };
      fn(inFn, outFn);
    } catch (e) {
      outputEl.textContent = `inject error: ${e.message}`;
    }
  }
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

function spansToHTML(spans) {
  return spans.map(s => {
    if (s.type === 'text')      return escHtml(s.text);
    if (s.type === 'bold')      return `<strong>${spansToHTML(s.children)}</strong>`;
    if (s.type === 'italic')    return `<em>${spansToHTML(s.children)}</em>`;
    if (s.type === 'underline') return `<u>${spansToHTML(s.children)}</u>`;
    if (s.type === 'image')     return `<img src="${escAttr(s.src)}" alt="${escAttr(s.alt)}" style="height:1.4em;vertical-align:middle;object-fit:contain">`;
    return '';
  }).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escAttr(str) {
  return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}

// Uses Canvas to detect text color from ANY CSS background value.
// Falls back to light text for gradients or unknown formats.
function autoTextColor(bg) {
  if (!bg) return '#e8e8e8';
  if (/gradient/i.test(bg)) return '#ffffff';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#12121a'; // reset to dark so transparent gives dark
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#111111' : '#f0f0f0';
  } catch { return '#e8e8e8'; }
}

customElements.define('slide-preview', SlidePreview);
