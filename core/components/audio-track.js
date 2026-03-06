// <audio-track course="..." module="...">
// Horizontal timeline. Accepts drops from <audio-library>.
// - Clips draggable to reposition; no-overlap enforcement
// - Two-click delete: first click selects, click ✕ to delete
// - Hover tooltip shows time at cursor position
// - set totalDuration(secs) to size track to slide total
// - set playTime(secs) shows sweeping playback cursor line
// Persists to /api/track/:course/:module.

const PX_PER_SEC = 40;
const RULER_STEP = 5;

const STYLES = `
  :host { display: flex; flex-direction: column; gap: 8px; }

  ::-webkit-scrollbar        { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track  { background: transparent; }
  ::-webkit-scrollbar-thumb  { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .track-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    position: relative;
  }
  .track-wrap.drag-over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent-deep) 10%, var(--bg));
  }

  .track-inner {
    position: relative;
    height: 72px;
    min-width: 100%;
  }

  .ruler {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 20px;
    border-bottom: 1px solid var(--border);
  }
  .tick {
    position: absolute;
    top: 0; height: 100%;
    display: flex;
    align-items: flex-end;
    padding-bottom: 2px;
  }
  .tick-line {
    position: absolute;
    top: 0; left: 0;
    width: 1px; height: 6px;
    background: var(--border);
  }
  .tick-label {
    font-size: 10px;
    color: var(--text-dim);
    margin-left: 3px;
    user-select: none;
  }

  .lane {
    position: absolute;
    top: 20px; left: 0; right: 0; bottom: 0;
  }

  .clip {
    position: absolute;
    top: 6px;
    height: calc(100% - 12px);
    background: var(--accent-deep);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 6px;
    overflow: hidden;
    min-width: 40px;
    cursor: grab;
    transition: background 0.1s, border-color 0.1s;
    box-sizing: border-box;
    user-select: none;
  }
  .clip:active { cursor: grabbing; }
  .clip:hover  { background: var(--accent); }
  .clip.selected { border-color: var(--danger); }
  .clip.dragging { opacity: 0.4; }

  .clip-name {
    font-size: 11px;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .clip-del {
    font-size: 13px;
    color: rgba(255, 80, 80, 0.95);
    flex-shrink: 0;
    line-height: 1;
    display: none;
    cursor: pointer;
  }
  .clip.selected .clip-del { display: block; }

  .drop-hint {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--text-dim);
    pointer-events: none;
  }

  .time-tip {
    position: absolute;
    top: 2px;
    pointer-events: none;
    font-size: 10px;
    color: var(--text-dim);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
    display: none;
    z-index: 10;
  }

  .play-line {
    position: absolute;
    top: 0; bottom: 0;
    width: 2px;
    background: var(--danger);
    pointer-events: none;
    display: none;
    z-index: 5;
  }
`;

class AudioTrack extends HTMLElement {
  static observedAttributes = ['course', 'module'];

  #clips      = [];
  #selectedId = null;
  #trackSecs  = 60;

  get course() { return this.getAttribute('course') ?? ''; }
  get module() { return this.getAttribute('module') ?? ''; }

  set totalDuration(t) {
    const secs = Math.max(10, parseFloat(t) || 60);
    if (secs === this.#trackSecs) return;
    this.#trackSecs = secs;
    const inner = this.shadowRoot?.querySelector('.track-inner');
    const ruler = this.shadowRoot?.querySelector('.ruler');
    if (inner) inner.style.width = `${secs * PX_PER_SEC}px`;
    if (ruler) ruler.innerHTML = this.#rulerHTML();
  }

  set playTime(t) {
    const line = this.shadowRoot?.querySelector('.play-line');
    if (!line) return;
    if (t < 0) {
      line.style.display = 'none';
    } else {
      line.style.display = 'block';
      line.style.left = `${t * PX_PER_SEC}px`;
    }
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback()        { this.#load(); }
  attributeChangedCallback() { if (this.isConnected) this.#load(); }

  async #load() {
    try {
      const res  = await fetch(`/api/track/${enc(this.course)}/${enc(this.module)}`);
      const data = await res.json();
      this.#clips = data.map(c => ({ ...c, id: c.id ?? crypto.randomUUID() }));
    } catch { this.#clips = []; }
    this.#render();
  }

  async #save() {
    const payload = this.#clips.map(({ file, startTime, duration }) => ({ file, startTime, duration }));
    await fetch(`/api/track/${enc(this.course)}/${enc(this.module)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  }

  // Returns the first clip that overlaps [startTime, startTime+duration], ignoring excludeId.
  #overlaps(excludeId, startTime, duration) {
    for (const c of this.#clips) {
      if (c.id === excludeId) continue;
      if (startTime < c.startTime + c.duration && c.startTime < startTime + duration) return c;
    }
    return null;
  }

  // Resolves a target start to a non-overlapping position, or null to cancel.
  // cursorFrac: fraction within the conflicting clip where the cursor landed.
  #resolvePosition(excludeId, rawStart, duration, cursorFrac) {
    rawStart = Math.max(0, Math.round(rawStart * 10) / 10);
    const conflict = this.#overlaps(excludeId, rawStart, duration);
    if (!conflict) return rawStart;

    // Cursor left half → try before; right half → try after
    let tryStart;
    if (cursorFrac < 0.5) {
      tryStart = Math.round((conflict.startTime - duration) * 10) / 10;
    } else {
      tryStart = Math.round((conflict.startTime + conflict.duration) * 10) / 10;
    }

    if (tryStart < 0 || tryStart + duration > this.#trackSecs) return null;
    if (this.#overlaps(excludeId, tryStart, duration)) return null;
    return tryStart;
  }

  #removeClip(id) {
    this.#clips = this.#clips.filter(c => c.id !== id);
    this.#selectedId = null;
    this.#refreshLane();
    this.#save();
  }

  #moveClip(id, rawStart, cursorFrac) {
    const clip = this.#clips.find(c => c.id === id);
    if (!clip) return;
    const resolved = this.#resolvePosition(id, rawStart, clip.duration, cursorFrac);
    if (resolved === null) return; // cancel — no valid position
    this.#clips = this.#clips.map(c => c.id === id ? { ...c, startTime: resolved } : c);
    this.#refreshLane();
    this.#save();
  }

  #addClip(file, rawStart, duration) {
    const resolved = this.#resolvePosition(null, rawStart, duration, 0.5);
    if (resolved === null) return; // cancel
    this.#clips = [...this.#clips, { id: crypto.randomUUID(), file, startTime: resolved, duration }];
    this.#refreshLane();
    this.#save();
  }

  #rulerHTML() {
    const ticks = [];
    for (let s = 0; s <= this.#trackSecs; s += RULER_STEP) {
      ticks.push(`
        <div class="tick" style="left:${s * PX_PER_SEC}px">
          <div class="tick-line"></div>
          <span class="tick-label">${s}s</span>
        </div>
      `);
    }
    return ticks.join('');
  }

  // Refresh just the clips lane — preserves scroll position.
  #refreshLane() {
    const sr   = this.shadowRoot;
    const wrap = sr.querySelector('#track-wrap');
    const lane = sr.querySelector('#lane');
    if (!lane) { this.#render(); return; }

    const savedScroll = wrap?.scrollLeft ?? 0;

    if (this.#clips.length === 0) {
      lane.innerHTML = `<div class="drop-hint">Drop audio clips here</div>`;
    } else {
      lane.innerHTML = this.#clips.map(c => {
        const left  = Math.round(c.startTime * PX_PER_SEC);
        const width = Math.max(Math.round((c.duration || 3) * PX_PER_SEC), 40);
        const label = c.file.replace(/\.wav$/, '');
        const sel   = this.#selectedId === c.id;
        return `
          <div class="clip${sel ? ' selected' : ''}" data-id="${esc(c.id)}"
               style="left:${left}px; width:${width}px"
               draggable="true"
               title="${esc(c.file)} @ ${c.startTime.toFixed(1)}s">
            <span class="clip-name">${esc(label)}</span>
            <span class="clip-del" data-action="delete">✕</span>
          </div>
        `;
      }).join('');
    }

    this.#bindClipEvents();
    if (wrap) wrap.scrollLeft = savedScroll;
  }

  #bindClipEvents() {
    this.shadowRoot.querySelectorAll('.clip').forEach(el => {
      let didDrag = false;

      el.addEventListener('dragstart', (e) => {
        didDrag = true;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        const rect    = el.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        e.dataTransfer.setData('x-clip-move', JSON.stringify({
          id:        el.dataset.id,
          offsetX,
          clipWidth: rect.width,
        }));
      });

      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        setTimeout(() => { didDrag = false; }, 50);
      });

      el.addEventListener('click', (e) => {
        if (didDrag) return;
        const id = el.dataset.id;
        if (e.target.dataset.action === 'delete') {
          this.#removeClip(id);
        } else if (this.#selectedId === id) {
          this.#selectedId = null;
          this.#refreshLane();
        } else {
          this.#selectedId = id;
          this.#refreshLane();
        }
      });
    });
  }

  #render() {
    const sr = this.shadowRoot;
    sr.innerHTML = `
      <style>${STYLES}</style>
      <div class="section-label">Audio Track</div>
      <div class="track-wrap" id="track-wrap">
        <div class="track-inner" style="width:${this.#trackSecs * PX_PER_SEC}px">
          <div class="ruler">${this.#rulerHTML()}</div>
          <div class="lane" id="lane"></div>
          <div class="time-tip" id="time-tip"></div>
          <div class="play-line"></div>
        </div>
      </div>
    `;

    const wrap    = sr.querySelector('#track-wrap');
    const timeTip = sr.querySelector('#time-tip');

    this.#refreshLane();

    // Hover time tooltip
    wrap.addEventListener('mousemove', (e) => {
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left + wrap.scrollLeft;
      const t = x / PX_PER_SEC;
      if (t < 0 || t > this.#trackSecs) { timeTip.style.display = 'none'; return; }
      timeTip.style.display = 'block';
      timeTip.style.left = `${x + 6}px`;
      timeTip.textContent = `${t.toFixed(1)}s`;
    });
    wrap.addEventListener('mouseleave', () => { timeTip.style.display = 'none'; });

    // Deselect on background click
    wrap.addEventListener('click', (e) => {
      if (!e.target.closest('.clip') && this.#selectedId) {
        this.#selectedId = null;
        this.#refreshLane();
      }
    });

    // Drop target
    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      const isMove = e.dataTransfer.types.includes('x-clip-move');
      e.dataTransfer.dropEffect = isMove ? 'move' : 'copy';
      if (!isMove) wrap.classList.add('drag-over');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));

    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('drag-over');

      const moveStr = e.dataTransfer.getData('x-clip-move');
      if (moveStr) {
        try {
          const { id, offsetX, clipWidth } = JSON.parse(moveStr);
          const rect = wrap.getBoundingClientRect();
          const x    = e.clientX - rect.left + wrap.scrollLeft - offsetX;
          const frac = clipWidth > 0 ? offsetX / clipWidth : 0.5;
          this.#moveClip(id, x / PX_PER_SEC, frac);
        } catch { /* ignore */ }
        return;
      }

      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        const rect = wrap.getBoundingClientRect();
        const x    = e.clientX - rect.left + wrap.scrollLeft;
        this.#addClip(data.file, x / PX_PER_SEC, data.duration ?? 3);
      } catch { /* ignore bad drops */ }
    });
  }
}

const enc = encodeURIComponent;
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

customElements.define('audio-track', AudioTrack);
