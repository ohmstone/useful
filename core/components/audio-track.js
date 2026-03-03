// <audio-track course="..." module="...">
// Horizontal timeline. Accepts drops from <audio-library>.
// Clips can be clicked to remove. Persists to /api/track/:course/:module.
//
// Scale: PX_PER_SEC pixels per second. Track is scrollable horizontally.

const PX_PER_SEC  = 40;
const TRACK_SECS  = 90;   // visible total timeline length
const RULER_STEP  = 5;    // ruler tick every N seconds

const STYLES = `
  :host { display: flex; flex-direction: column; gap: 8px; }

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
    width: ${TRACK_SECS * PX_PER_SEC}px;
    height: 72px;
    min-width: 100%;
  }

  /* Ruler */
  .ruler {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 20px;
    border-bottom: 1px solid var(--border);
  }
  .tick {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: flex-end;
    padding-bottom: 2px;
  }
  .tick-line {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    height: 6px;
    background: var(--border);
  }
  .tick-label {
    font-size: 10px;
    color: var(--text-dim);
    margin-left: 3px;
    user-select: none;
  }

  /* Clips lane */
  .lane {
    position: absolute;
    top: 20px;
    left: 0;
    right: 0;
    bottom: 0;
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
    cursor: pointer;
    transition: background 0.1s;
    box-sizing: border-box;
  }
  .clip:hover { background: var(--accent); }

  .clip-name {
    font-size: 11px;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .clip-del {
    font-size: 11px;
    color: rgba(255,255,255,0.6);
    flex-shrink: 0;
    line-height: 1;
  }

  .drop-hint {
    position: absolute;
    inset: 20px 0 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--text-dim);
    pointer-events: none;
  }
`;

class AudioTrack extends HTMLElement {
  static observedAttributes = ['course', 'module'];

  #clips = []; // [{ id, file, startTime, duration }]

  get course() { return this.getAttribute('course') ?? ''; }
  get module() { return this.getAttribute('module') ?? ''; }

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
    // Strip internal id before saving
    const payload = this.#clips.map(({ file, startTime, duration }) => ({ file, startTime, duration }));
    await fetch(`/api/track/${enc(this.course)}/${enc(this.module)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  }

  #removeClip(id) {
    this.#clips = this.#clips.filter(c => c.id !== id);
    this.#render();
    this.#save();
  }

  #addClip(file, startTime, duration) {
    startTime = Math.max(0, Math.round(startTime * 10) / 10);
    this.#clips = [...this.#clips, { id: crypto.randomUUID(), file, startTime, duration }];
    this.#render();
    this.#save();
  }

  #renderRuler() {
    const ticks = [];
    for (let s = 0; s <= TRACK_SECS; s += RULER_STEP) {
      ticks.push(`
        <div class="tick" style="left:${s * PX_PER_SEC}px">
          <div class="tick-line"></div>
          <span class="tick-label">${s}s</span>
        </div>
      `);
    }
    return `<div class="ruler">${ticks.join('')}</div>`;
  }

  #render() {
    const sr = this.shadowRoot;
    const clips = this.#clips;

    sr.innerHTML = `
      <style>${STYLES}</style>
      <div class="section-label">Audio Track</div>
      <div class="track-wrap" id="track-wrap">
        <div class="track-inner">
          ${this.#renderRuler()}
          <div class="lane" id="lane">
            ${clips.map(c => {
              const left  = Math.round(c.startTime * PX_PER_SEC);
              const width = Math.max(Math.round((c.duration || 3) * PX_PER_SEC), 40);
              const label = c.file.replace(/\.wav$/, '');
              return `
                <div class="clip" data-id="${esc(c.id)}"
                     style="left:${left}px; width:${width}px"
                     title="${esc(c.file)} @ ${c.startTime.toFixed(1)}s — click to remove">
                  <span class="clip-name">${esc(label)}</span>
                  <span class="clip-del">✕</span>
                </div>
              `;
            }).join('')}
            ${clips.length === 0
              ? `<div class="drop-hint">Drop audio clips here</div>` : ''}
          </div>
        </div>
      </div>
    `;

    // Remove clip on click
    sr.querySelectorAll('.clip').forEach(el => {
      el.addEventListener('click', () => this.#removeClip(el.dataset.id));
    });

    // Drag-and-drop target
    const wrap = sr.querySelector('#track-wrap');

    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      wrap.classList.add('drag-over');
    });

    wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));

    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('drag-over');
      try {
        const data      = JSON.parse(e.dataTransfer.getData('application/json'));
        const rect      = wrap.getBoundingClientRect();
        const scrollX   = wrap.scrollLeft;
        const x         = e.clientX - rect.left + scrollX;
        const startTime = x / PX_PER_SEC;
        this.#addClip(data.file, startTime, data.duration ?? 3);
      } catch { /* ignore bad drops */ }
    });
  }
}

const enc = encodeURIComponent;
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

customElements.define('audio-track', AudioTrack);
