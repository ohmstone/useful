// <slide-preview> — 16:9 rich slide renderer.
//
// API:
//   set slides(parsedSlides)  — replace slide array, re-render
//   set currentIndex(n)       — jump to slide n, re-render
//   set slideTime(t)          — update sub-slide time (seconds); triggers emph/plugin, no full re-render
//
// Rendering is always at an internal 1920×1080 canvas scaled to fit the stage,
// so layout is consistent regardless of browser window size.
//
// parseSlides is no longer exported here — import from ../slide-parser.js

import { parseInline } from '../slide-parser.js';

// ── Styles ───────────────────────────────────────────────────────────────────

const STYLES = `
  :host { display: flex; flex-direction: column; gap: 10px; }

  /* ── Fullscreen: host fills viewport, stage fills host, nav hidden ── */
  :host(:fullscreen) {
    background: #12121a;
    gap: 0;
  }
  :host(:fullscreen) .stage {
    flex: 1;
    aspect-ratio: unset;
    border: none;
    border-radius: 0;
  }
  :host(:fullscreen) .nav,
  :host(:fullscreen) .slide-meta { display: none; }

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

  /* ── 1920×1080 canvas (always this size, scaled to fit stage) ── */
  .slide-canvas {
    position: absolute;
    top: 0; left: 0;
    width: 1920px;
    height: 1080px;
    transform-origin: top left;
    font-size: 20px;
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
    width: 100%;
    overflow: hidden;
  }
  .col-inner {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
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
  .img-wrap     { flex: 1; min-height: 4em; overflow: hidden; }
  .img-wrap img { display: block; width: 100%; height: 100%; }

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
  /* Use > so only direct children of slide-body are dimmed, not blocks nested inside columns */
  .emph-active > .block:not(.is-emph) { opacity: 0.1; transition: opacity 0.25s; }
  .emph-active > .block.is-emph       { opacity: 1;   transition: opacity 0.25s; }
  .block { transition: opacity 0.25s; }

  /* Hide editing decoration during playback */
  .playing .emph-label        { display: none; }
  .playing .emph-indicator    { border-left: none; padding-left: 0; gap: 0; }

  /* ── Plugin block ── */
  .plugin-slot {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  /* Subtle editing decoration: dashed border + filename — hidden during playback */
  .plugin-label {
    position: absolute; inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed rgba(120, 180, 255, 0.25);
    border-radius: 4px;
    font-size: 0.55em;
    opacity: 0.4;
    pointer-events: none;
    font-style: italic;
  }
  .plugin-output {
    position: absolute; inset: 0;
    overflow: hidden;
  }
  .playing .plugin-label { display: none; }

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
  .empty-msg   { color: #555; font-size: 26px; text-align: center; }

  /* ── Fullscreen button ── */
  .fullscreen-btn {
    position: absolute;
    top: 8px; right: 8px;
    background: rgba(0,0,0,0.45);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    color: rgba(255,255,255,0.5);
    font-size: 14px;
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    z-index: 10;
    padding: 0;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
  }
  .fullscreen-btn:hover { background: rgba(0,0,0,0.75); color: rgba(255,255,255,0.9); }
`;

// ── Component ────────────────────────────────────────────────────────────────

class SlidePreview extends HTMLElement {
  #slides        = [];
  #index         = 0;
  #slideTime     = -1;      // -1 = not in playback
  #pluginCache   = new Map();  // file → module default export fn
  #pluginLoading = new Set();  // files currently being imported
  #resizeObs     = null;
  _fsHandler     = null;

  constructor() { super(); this.attachShadow({ mode: 'open' }); }

  connectedCallback() {
    this.#renderFull();
    this.#resizeObs = new ResizeObserver(() => this.#updateScale());
    this.#resizeObs.observe(this);
    this._fsHandler = () => requestAnimationFrame(() => this.#updateScale());
    document.addEventListener('fullscreenchange', this._fsHandler);
  }

  disconnectedCallback() {
    this.#resizeObs?.disconnect();
    document.removeEventListener('fullscreenchange', this._fsHandler);
  }

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

  // ── Scale the 1920×1080 canvas to fit the stage ────────────────────────────

  #updateScale() {
    const stage  = this.shadowRoot?.querySelector('.stage');
    const canvas = this.shadowRoot?.querySelector('.slide-canvas');
    if (!stage || !canvas) return;
    const scaleX = stage.clientWidth  / 1920;
    const scaleY = stage.clientHeight / 1080;
    const scale  = Math.min(scaleX, scaleY);
    // Translate to center when letterboxing (e.g. fullscreen on non-16:9 display)
    const tx = (stage.clientWidth  - 1920 * scale) / 2;
    const ty = (stage.clientHeight - 1080 * scale) / 2;
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  // ── Full render ────────────────────────────────────────────────────────────

  #renderFull() {
    const sr    = this.shadowRoot;
    const slide = this.#slides[this.#index];
    const total = this.#slides.length;
    const idx   = this.#index;

    sr.innerHTML = `<style>${STYLES}</style>
      <div class="stage" id="stage">
        <div class="slide-canvas" id="slide-canvas">
          ${slide ? this.#buildSlide(slide) : `<div style="display:flex;align-items:center;justify-content:center;height:100%"><div class="empty-msg">No slides yet.</div></div>`}
        </div>
        <button class="fullscreen-btn" id="btn-fullscreen" title="Fullscreen">&#x26F6;</button>
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
    sr.querySelector('#btn-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        this.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.();
      }
    });

    requestAnimationFrame(() => this.#updateScale());
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

      case 'plugin':
        return this.#buildPlugin(b, bid);

      default:
        return '';
    }
  }

  #buildImage(b, bid) {
    const fit = ['contain', 'cover', 'fill', 'none'].includes(b.fit) ? b.fit : 'contain';
    return `<div class="img-wrap block" data-block="${bid}">
      <img src="${escAttr(b.src)}" alt="${escAttr(b.alt)}" style="object-fit:${fit}">
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
    const inner = this.#buildBody(b.blocks, textColor, `${bid}-emph`);
    return `<div class="emph-indicator block is-emph" data-block="${bid}"
               data-emph-start="${b.start}" data-emph-dur="${b.duration}">
      <div class="emph-label">emphasis — at ${b.start}s for ${b.duration}s</div>
      ${inner}
    </div>`;
  }

  #buildPlugin(b, bid) {
    const dataAttr = b.dataFile ? ` data-plugin-data="${escAttr(b.dataFile)}"` : '';
    return `<div class="plugin-slot block" data-block="${bid}"
               data-plugin-file="${escAttr(b.file)}"${dataAttr}>
      <div class="plugin-label">plugin: ${escHtml(b.file)}</div>
      <div class="plugin-output"></div>
    </div>`;
  }

  // ── Timing update (called every animation frame during playback) ───────────

  #updateTiming() {
    const sr   = this.shadowRoot;
    const body = sr?.querySelector('#slide-body');
    if (!body) return;
    const t = this.#slideTime;

    body.classList.toggle('playing', t >= 0);

    // — Emph dimming —
    const emphEls  = body.querySelectorAll('[data-emph-start]');
    let emphActive = false;
    for (const el of emphEls) {
      const start = parseFloat(el.dataset.emphStart);
      const dur   = parseFloat(el.dataset.emphDur);
      if (t >= start && t < start + dur) { emphActive = true; break; }
    }
    body.classList.toggle('emph-active', emphActive && t >= 0);

    // — Plugin slots —
    // Each plugin is activated once when playback begins; it manages its own timing.
    // When playback stops (t < 0), the output is cleared so next play starts fresh.
    const slots = body.querySelectorAll('.plugin-slot');
    for (const slot of slots) {
      const output = slot.querySelector('.plugin-output');
      if (t < 0) {
        if (slot.dataset._pluginActive) {
          delete slot.dataset._pluginActive;
          output.innerHTML = '';
        }
        continue;
      }
      if (!slot.dataset._pluginActive) {
        slot.dataset._pluginActive = '1';
        this.#callPlugin(slot.dataset.pluginFile, slot.dataset.pluginData || null, slot, output);
      }
    }
  }

  // ── Invoke a plugin module (called once per playback activation) ──────────
  //
  // Plugin contract:
  //   export default function(inFn, outFn, dataFn?) { ... }
  //
  //   inFn() → { width, height, timeInSlide, remaining }
  //     width/height  — slot dimensions in canvas pixels (1920×1080 space)
  //     timeInSlide   — seconds elapsed in the current slide
  //     remaining     — seconds left in the slide
  //
  //   outFn(el) — call once to place your root element; use RAF + inFn() for animation.
  //     Check el.isConnected in your RAF loop to know when to stop.
  //
  //   dataFn(name?) — fetch Response for a file in _inject/ (only if data arg given)

  async #callPlugin(file, dataFile, slot, outputEl) {
    try {
      if (!this.#pluginCache.has(file)) {
        if (this.#pluginLoading.has(file)) return;
        this.#pluginLoading.add(file);
        try {
          const mod = await import(`/api/inject/${encodeURIComponent(file)}`);
          this.#pluginCache.set(file, mod.default);
        } finally {
          this.#pluginLoading.delete(file);
        }
        // After async load, verify playback is still active and slot is still in DOM
        if (this.#slideTime < 0 || !slot.isConnected) return;
      }

      const fn = this.#pluginCache.get(file);
      if (typeof fn !== 'function') return;

      const self  = this;
      const inFn  = () => ({
        width:       slot.offsetWidth,
        height:      slot.offsetHeight,
        timeInSlide: self.#slideTime,
        remaining:   Math.max(0, (self.#slides[self.#index]?.duration ?? 0) - self.#slideTime),
      });
      const outFn = el => { outputEl.innerHTML = ''; if (el) outputEl.appendChild(el); };
      const dataFn = dataFile
        ? (name) => fetch(`/api/inject/${encodeURIComponent(name ?? dataFile)}`)
        : null;
      fn(inFn, outFn, dataFn);
    } catch (e) {
      outputEl.textContent = `plugin error: ${e.message}`;
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
