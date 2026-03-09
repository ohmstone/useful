// player.js — standalone course player for useful exports
// Copied verbatim into each course export directory.

// ── Inline parser (ported from slide-parser.js) ──────────────────────────────

function parseInline(text) {
  const spans = [];
  let pos = 0, textStart = 0;
  const flushText = end => {
    if (end > textStart) spans.push({ type: 'text', text: text.slice(textStart, end) });
  };
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === '*' && text[pos + 1] === '*') {
      const close = text.indexOf('**', pos + 2);
      if (close !== -1) {
        flushText(pos);
        spans.push({ type: 'bold', children: parseInline(text.slice(pos + 2, close)) });
        pos = textStart = close + 2; continue;
      }
    }
    if (ch === '*' && text[pos + 1] !== '*') {
      const close = text.indexOf('*', pos + 1);
      if (close !== -1) {
        flushText(pos);
        spans.push({ type: 'italic', children: parseInline(text.slice(pos + 1, close)) });
        pos = textStart = close + 1; continue;
      }
    }
    if (ch === '_' && text[pos + 1] === '_') {
      const close = text.indexOf('__', pos + 2);
      if (close !== -1) {
        flushText(pos);
        spans.push({ type: 'underline', children: parseInline(text.slice(pos + 2, close)) });
        pos = textStart = close + 2; continue;
      }
    }
    pos++;
  }
  flushText(pos);
  return spans;
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

function spansToHTML(spans) {
  return spans.map(s => {
    if (s.type === 'text')      return escHtml(s.text);
    if (s.type === 'bold')      return `<strong>${spansToHTML(s.children)}</strong>`;
    if (s.type === 'italic')    return `<em>${spansToHTML(s.children)}</em>`;
    if (s.type === 'underline') return `<u>${spansToHTML(s.children)}</u>`;
    return '';
  }).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function autoTextColor(bg) {
  if (!bg) return '#e8e8e8';
  if (/gradient/i.test(bg)) return '#ffffff';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#12121a';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#111111' : '#f0f0f0';
  } catch { return '#e8e8e8'; }
}

function fmtTime(secs) {
  const s = Math.floor(Math.max(0, secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Slide renderer ────────────────────────────────────────────────────────────
// Ported from slide-preview.js; adapted for non-shadow-DOM export context.
// Image srcs in slides.json are already rewritten to "assets/<file>" by the
// export engine; we prefix them with courseRoot so they resolve correctly
// whether the player is at course root or in modules/<slug>/.

function buildSlideHTML(slide, courseRoot) {
  const textColor = autoTextColor(slide.bg);
  const bgAttr    = slide.bg ? ` data-bg="${escAttr(slide.bg)}"` : '';
  let headerHtml  = '';
  if (slide.header) {
    headerHtml = `<div class="sp-header">
      <span class="sp-hdr-left">${spansToHTML(parseInline(slide.header.left ?? ''))}</span>
      <span class="sp-hdr-right">${spansToHTML(parseInline(slide.header.right ?? ''))}</span>
    </div>`;
  }
  const blocks   = slide.blocks ?? slide.body ?? [];
  const bodyHtml = buildBodyHTML(blocks, textColor, courseRoot, '');
  return `<div class="sp-slide"${bgAttr} data-color="${escAttr(textColor)}">
    ${headerHtml}
    <div class="sp-body" id="sp-body">${bodyHtml}</div>
  </div>`;
}

function buildBodyHTML(blocks, textColor, courseRoot, prefix) {
  return blocks.map((b, i) =>
    buildBlockHTML(b, textColor, courseRoot, prefix ? `${prefix}-${i}` : String(i))
  ).join('');
}

function buildBlockHTML(b, textColor, courseRoot, bid) {
  switch (b.type) {
    case 'paragraph':
      return `<p class="sp-para sp-block ${b.size !== 'normal' ? b.size : ''} ${b.align !== 'left' ? b.align : ''}"
                 ${b.color ? `data-color="${escAttr(b.color)}"` : ''}
                 data-block="${bid}">${spansToHTML(b.spans)}</p>`;

    case 'heading': {
      const cls = b.level === 1 ? 'sp-h1' : 'sp-h2';
      return `<div class="${cls} sp-block ${b.align !== 'left' ? b.align : ''}" data-block="${bid}">${spansToHTML(b.spans)}</div>`;
    }

    case 'list': {
      const tag   = b.ordered ? 'ol' : 'ul';
      const items = b.items.map(spans => `<li>${spansToHTML(spans)}</li>`).join('');
      return `<${tag} class="sp-block ${b.size !== 'normal' ? b.size : ''} ${b.align !== 'left' ? b.align : ''}"
                       data-block="${bid}">${items}</${tag}>`;
    }

    case 'image': {
      const fit = ['contain', 'cover', 'fill', 'none'].includes(b.fit) ? b.fit : 'contain';
      // b.src is "assets/<file>" (rewritten by export engine); resolve relative to courseRoot
      const src = b.src.startsWith('assets/') ? `${courseRoot}/${b.src}` : b.src;
      return `<div class="sp-img-wrap sp-block" data-block="${bid}">
        <img src="${escAttr(src)}" alt="${escAttr(b.alt ?? '')}" data-fit="${escAttr(fit)}">
      </div>`;
    }

    case 'code':
      return `<pre class="sp-code sp-block" data-block="${bid}"><code>${escHtml(b.text)}</code></pre>`;

    case 'columns': {
      const cols = b.cols.map((col, ci) => {
        const bgAttr    = col.bg ? ` data-bg="${escAttr(col.bg)}"` : '';
        const colorAttr = col.bg ? ` data-color="${escAttr(autoTextColor(col.bg))}"` : '';
        const content   = buildBodyHTML(col.blocks, col.bg ? autoTextColor(col.bg) : textColor, courseRoot, `${bid}-${ci}`);
        return `<div class="sp-col-inner" data-width="${col.width}"${bgAttr}${colorAttr}>${content}</div>`;
      });
      return `<div class="sp-columns sp-block" data-block="${bid}">${cols.join('')}</div>`;
    }

    case 'emph': {
      const inner = buildBodyHTML(b.blocks, textColor, courseRoot, `${bid}-emph`);
      return `<div class="sp-emph sp-block sp-is-emph" data-block="${bid}"
                   data-emph-start="${b.start}" data-emph-dur="${b.duration}">${inner}</div>`;
    }

    case 'plugin': {
      const dataAttr = b.dataFile ? ` data-plugin-data="${escAttr(b.dataFile)}"` : '';
      // b.file is the raw filename; plugin JS is at courseRoot/assets/<file>
      return `<div class="sp-plugin sp-block" data-block="${bid}"
                   data-plugin-file="${escAttr(b.file)}"${dataAttr}>
        <div class="sp-plugin-out"></div>
      </div>`;
    }

    default: return '';
  }
}

// ── Post-render style application (CSP: no inline style= attrs) ──────────────
// data-bg / data-color / data-width / data-fit are set by the HTML builders
// and applied here via CSSOM, which is not restricted by style-src.

function applyDataStyles(root) {
  for (const el of root.querySelectorAll('[data-bg],[data-color],[data-width],[data-fit]')) {
    if (el.dataset.bg)    el.style.background = el.dataset.bg;
    if (el.dataset.color) el.style.color       = el.dataset.color;
    if (el.dataset.width) el.style.width       = el.dataset.width + '%';
    if (el.dataset.fit)   el.style.objectFit   = el.dataset.fit;
  }
}

// ── Canvas scaling ─────────────────────────────────────────────────────────────

function updateScale(stage, canvas) {
  if (!stage || !canvas) return;
  const scaleX = stage.clientWidth  / 1920;
  const scaleY = stage.clientHeight / 1080;
  const scale  = Math.min(scaleX, scaleY);
  const tx     = (stage.clientWidth  - 1920 * scale) / 2;
  const ty     = (stage.clientHeight - 1080 * scale) / 2;
  canvas.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
}

// ── Timing update (emph dimming + plugin activation) ─────────────────────────

const _pluginCache   = new Map();  // file → default-export function
const _pluginLoading = new Set();

function updateTiming(body, slideTime, slides, slideIdx, courseRoot) {
  if (!body) return;

  // Emph dimming — toggle sp-is-emph-current on each emph element individually
  // (mirrors slide-preview.js: only the currently active emph block stays bright)
  const emphEls = body.querySelectorAll('[data-emph-start]');
  let emphActive = false;
  for (const el of emphEls) {
    const start  = parseFloat(el.dataset.emphStart);
    const dur    = parseFloat(el.dataset.emphDur);
    const active = slideTime >= 0 && slideTime >= start && slideTime < start + dur;
    el.classList.toggle('sp-is-emph-current', active);
    if (active) emphActive = true;
  }
  body.classList.toggle('sp-emph-active', emphActive);

  // Plugin slots — activated once per playback start
  for (const slot of body.querySelectorAll('.sp-plugin')) {
    const output = slot.querySelector('.sp-plugin-out');
    if (slideTime < 0) {
      if (slot.dataset._active) { delete slot.dataset._active; output.innerHTML = ''; }
      continue;
    }
    if (!slot.dataset._active) {
      slot.dataset._active = '1';
      _callPlugin(slot.dataset.pluginFile, slot.dataset.pluginData || null, slot, output, slides, slideIdx, courseRoot);
    }
  }
}

async function _callPlugin(file, dataFile, slot, outputEl, slides, slideIdx, courseRoot) {
  try {
    if (!_pluginCache.has(file)) {
      if (_pluginLoading.has(file)) return;
      _pluginLoading.add(file);
      try {
        const url = `${courseRoot}/assets/${encodeURIComponent(file)}`;
        const mod = await import(url);
        _pluginCache.set(file, mod.default);
      } finally {
        _pluginLoading.delete(file);
      }
      if (!slot.isConnected) return;
    }
    const fn = _pluginCache.get(file);
    if (typeof fn !== 'function') return;

    const inFn  = () => ({
      width:       slot.offsetWidth,
      height:      slot.offsetHeight,
      timeInSlide: state.slideTime,
      remaining:   Math.max(0, (slides[slideIdx]?.duration ?? 0) - state.slideTime),
    });
    const outFn  = el => { outputEl.innerHTML = ''; if (el) outputEl.appendChild(el); };
    const dataFn = dataFile
      ? name => fetch(`${courseRoot}/assets/${encodeURIComponent(name ?? dataFile)}`)
      : null;
    fn(inFn, outFn, dataFn);
  } catch (e) {
    outputEl.textContent = `plugin error: ${e.message}`;
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  courseRoot:    '.',    // resolved to absolute URL at init
  courseSlug:    '',
  manifest:      null,
  moduleSlug:    null,
  slidesData:    null,
  slideIndex:    0,
  slideTime:     0,
  playbackRate:  1,
  hls:           null,
  audio:         null,
  playing:       false,
  installPrompt: null,
  resizeObs:     null,
  timerRaf:      null,  // RAF id for no-audio timer mode
  timerBase:     0,     // performance.now() reference when timer-mode play started
  timerOffset:   0,     // accumulated seconds before current play session
  audioRaf:      null,  // RAF id for smooth progress updates in audio mode
  _lastSavedSec: -1,
  _audioEnded:   false, // true when HLS ended early and we switched to timer mode
};

// ── Controls auto-hide ─────────────────────────────────────────────────────

let _hideTimer = null;

function _showControls() {
  const area = document.getElementById('player-area');
  if (!area) return;
  area.classList.remove('controls-hidden');
  clearTimeout(_hideTimer);
  if (state.playing) {
    _hideTimer = setTimeout(() => {
      if (state.playing) area.classList.add('controls-hidden');
    }, 3000);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  // Resolve to an absolute URL so relative fetches/imports aren't affected
  // by history.pushState() changes to the page URL.
  const courseRootRaw = appEl.dataset.courseRoot || '.';
  state.courseRoot = new URL(courseRootRaw + '/', location.href).href.replace(/\/$/, '');
  state.moduleSlug = appEl.dataset.module     || null;

  // Pin favicon to an absolute URL so it doesn't break when history.pushState
  // changes the page URL (browsers re-resolve <link rel="icon"> on URL changes).
  const favLink = document.querySelector('link[rel="icon"]');
  if (favLink) favLink.href = `${state.courseRoot}/favicon.svg`;

  // Service worker
  if ('serviceWorker' in navigator) {
    const swUrl   = `${state.courseRoot}/sw.js`;
    const swScope = state.courseRoot + '/';
    navigator.serviceWorker.register(swUrl, { scope: swScope }).catch(() => {});

    // Listen for background caching progress from the SW activate event
    navigator.serviceWorker.addEventListener('message', e => {
      const el   = document.getElementById('sw-status');
      const txt  = document.getElementById('sw-status-text');
      const fill = document.getElementById('sw-status-bar-fill');
      if (!el) return;
      if (e.data?.type === 'sw-caching') {
        el.hidden = false;
        const pct = e.data.total > 0 ? Math.round((e.data.done / e.data.total) * 100) : 0;
        if (txt)  txt.textContent = `Fetching for offline\u2026 ${pct}%`;
        if (fill) fill.style.width = `${pct}%`;
      } else if (e.data?.type === 'sw-ready') {
        el.hidden = false;
        if (txt)  txt.textContent = 'Ready for offline';
        if (fill) fill.style.width = '100%';
        setTimeout(() => { el.hidden = true; }, 3000);
      }
    });
  }

  // PWA install prompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.installPrompt = e;
    document.getElementById('btn-install')?.removeAttribute('hidden');
  });

  // Fetch manifest
  try {
    const resp   = await fetch(`${state.courseRoot}/manifest.json`);
    state.manifest = await resp.json();
  } catch {
    appEl.innerHTML = '<p class="error-msg">Failed to load course manifest.</p>';
    return;
  }

  state.courseSlug = _deriveCourseSlug();

  renderShell(appEl);

  // Determine initial module slug
  const hashSlug  = new URLSearchParams(location.hash.slice(1)).get('module');
  const initSlug  = hashSlug || state.moduleSlug || state.manifest.modules[0]?.slug;
  if (initSlug) await loadModule(initSlug, false);

  // Browser back/forward
  window.addEventListener('popstate', e => {
    const slug = e.state?.module || state.manifest.modules[0]?.slug;
    if (slug) loadModule(slug, false);
  });
}

function _deriveCourseSlug() {
  const parts  = location.pathname.split('/').filter(Boolean);
  const modIdx = parts.indexOf('modules');
  if (modIdx > 0) return parts[modIdx - 1];
  const last = parts[parts.length - 1];
  return last === 'index.html' ? (parts[parts.length - 2] || '') : (last || '');
}

// ── Player shell ──────────────────────────────────────────────────────────────

function renderShell(appEl) {
  appEl.innerHTML = `
    <div id="player-shell">
      <div id="player-area">
        <div id="slide-stage">
          <div id="slide-canvas"></div>
        </div>
        <div id="controls">
          <div id="controls-left">
            <button class="ctrl-btn" id="btn-skip-back"  title="Back 10s"><i class="icon-rewind"></i><span class="btn-label"> 10s</span></button>
            <button class="ctrl-btn" id="btn-play-pause" title="Play/Pause"><i class="icon-play"></i></button>
            <button class="ctrl-btn" id="btn-skip-fwd"   title="Forward 10s"><span class="btn-label">10s </span><i class="icon-fast-fw"></i></button>
          </div>
          <div id="controls-progress">
            <span id="time-current">0:00</span>
            <span id="time-remaining">0:00</span>
            <div id="progress-bar-wrap">
              <div id="progress-bar-bg">
                <div id="progress-bar-fill"></div>
                <input type="range" id="progress-scrubber" min="0" max="0" step="any" value="0">
              </div>
            </div>
            <span id="time-total">0:00</span>
          </div>
          <div id="controls-right">
            <select class="ctrl-btn" id="speed-select" title="Playback speed">
              <option value="0.5">0.5×</option>
              <option value="0.75">0.75×</option>
              <option value="1" selected>1×</option>
              <option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option>
              <option value="1.75">1.75×</option>
              <option value="2">2×</option>
            </select>
            <button class="ctrl-btn" id="btn-fullscreen" title="Fullscreen"><i class="icon-fullscreen"></i></button>
            <button class="ctrl-btn" id="btn-modules"    title="Modules"><i class="icon-menu"></i>&nbsp;Modules</button>
          </div>
        </div>
        <div id="resume-prompt" hidden>
          <span id="resume-text"></span>
          <button id="btn-resume-yes">Resume</button>
          <button id="btn-resume-no">Start over</button>
        </div>
      </div>
      <nav id="module-sidebar">
        <div id="sidebar-title">
          <span id="sidebar-title-text">${escHtml(state.manifest.title || '')}</span>
          <button class="ctrl-btn" id="btn-install" title="Install for offline" hidden><i class="icon-download"></i></button>
        </div>
        <ul id="module-list"></ul>
        <div id="course-progress-wrap">
          <div id="course-progress-label"></div>
        </div>
        <div id="sw-status" hidden>
          <span id="sw-status-text"></span>
          <div id="sw-status-bar-wrap"><div id="sw-status-bar-fill"></div></div>
        </div>
      </nav>
    </div>`;

  appEl.classList.add('player-active');

  // Audio element
  state.audio = document.createElement('audio');
  state.audio.preload = 'auto';
  document.body.appendChild(state.audio);

  // Controls
  document.getElementById('btn-play-pause').addEventListener('click', togglePlay);
  document.getElementById('btn-skip-back').addEventListener('click', () => seek(currentTime() - 10));
  document.getElementById('btn-skip-fwd').addEventListener('click',  () => seek(currentTime() + 10));
  document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
  document.getElementById('btn-modules').addEventListener('click',    toggleSidebar);
  document.getElementById('btn-install').addEventListener('click',    doInstall);
  document.getElementById('speed-select').addEventListener('change', e => {
    const rate = parseFloat(e.target.value) || 1;
    // In timer mode, accumulate elapsed before changing rate so time doesn't jump
    if (state.playing && (!state.slidesData?.audio || state._audioEnded)) {
      const elapsed = (performance.now() - state.timerBase) / 1000 * state.playbackRate;
      state.timerOffset += elapsed;
      state.timerBase = performance.now();
    }
    state.playbackRate = rate;
    if (state.slidesData?.audio) state.audio.playbackRate = rate;
  });

  const scrubber = document.getElementById('progress-scrubber');
  scrubber.addEventListener('input', () => {
    // scrubber.max is set to totalDuration (seconds), so value is already in seconds
    seek(parseFloat(scrubber.value));
  });

  document.getElementById('btn-resume-yes').addEventListener('click', () => {
    const saved = _getSavedProgress(state.moduleSlug);
    if (saved) seek(saved.position);
    document.getElementById('resume-prompt').hidden = true;
    if (!state.playing) togglePlay();
  });
  document.getElementById('btn-resume-no').addEventListener('click', () => {
    seek(0);
    document.getElementById('resume-prompt').hidden = true;
  });

  // Audio events
  state.audio.addEventListener('timeupdate', onTimeUpdate);
  state.audio.addEventListener('play',  () => {
    state.playing = true;
    _updatePlayBtn();
    // Start smooth RAF-driven progress updates for audio mode
    if (state.audioRaf) cancelAnimationFrame(state.audioRaf);
    state.audioRaf = requestAnimationFrame(_audioRafTick);
  });
  state.audio.addEventListener('pause', () => {
    state.playing = false;
    if (state.audioRaf) { cancelAnimationFrame(state.audioRaf); state.audioRaf = null; }
    // If audio ended naturally and slides still have content, the 'ended' event (which fires
    // after 'pause') will transition to timer mode. Suppress controls restore to avoid a flash.
    const audioTime = state.audio.currentTime || 0;
    const audioDur  = isFinite(state.audio.duration) ? state.audio.duration : -1;
    const slidesDur = state.slidesData?.totalDuration || 0;
    const pendingTimerMode = audioDur > 0 && (audioDur - audioTime) < 0.5 && audioTime < slidesDur - 0.1;
    if (!pendingTimerMode) _updatePlayBtn();
    saveCurrentProgress();
  });
  state.audio.addEventListener('ended', () => {
    // If slides still have time remaining, continue in timer mode rather than ending the module.
    // Note: the browser dispatches 'pause' before 'ended' on natural end, so state.playing is
    // already false here — do NOT gate on state.playing.
    if (state.audioRaf) { cancelAnimationFrame(state.audioRaf); state.audioRaf = null; }
    const slidesTotalDur = state.slidesData?.totalDuration || 0;
    const audioTime      = state.audio.currentTime || 0;
    if (audioTime < slidesTotalDur - 0.1) {
      state._audioEnded  = true;
      state.playing      = true;   // restore: pause event set this to false before ended fired
      state.timerOffset  = audioTime;
      state.timerBase    = performance.now();
      // Update button icon only — do NOT call _updatePlayBtn() as it would show controls
      const btn  = document.getElementById('btn-play-pause');
      const icon = btn?.querySelector('i');
      if (icon) icon.className = 'icon-pause';
      _timerTick();
    } else {
      onModuleEnded();
    }
  });

  // Module list clicks
  document.getElementById('module-list').addEventListener('click', e => {
    const item = e.target.closest('.module-item');
    if (item) { closeSidebar(); loadModule(item.dataset.slug, true); }
  });

  // Sidebar backdrop (mobile) — close when clicking outside drawer
  document.getElementById('player-shell').addEventListener('click', e => {
    const sidebar = document.getElementById('module-sidebar');
    if (sidebar?.classList.contains('is-open') && !sidebar.contains(e.target) &&
        e.target.id !== 'btn-modules') {
      closeSidebar();
    }
  });

  // Fullscreen → re-scale + swap icon
  document.addEventListener('fullscreenchange', () => {
    requestAnimationFrame(scaleCanvas);
    const icon = document.querySelector('#btn-fullscreen i');
    if (icon) icon.className = document.fullscreenElement ? 'icon-exit-fullscreen' : 'icon-fullscreen';
  });

  // ResizeObserver for slide stage
  state.resizeObs = new ResizeObserver(() => scaleCanvas());
  state.resizeObs.observe(document.getElementById('slide-stage'));

  // Controls auto-hide
  const playerArea = document.getElementById('player-area');
  playerArea.addEventListener('mousemove', _showControls);
  playerArea.addEventListener('touchstart', _showControls, { passive: true });

  _updateModuleList();
}

// ── Module list rendering ──────────────────────────────────────────────────────

function _renderModuleListHTML() {
  const progress = _getAllProgress();
  return state.manifest.modules.map(m => {
    const p         = progress[m.slug];
    const completed = !!p?.completed;
    const pct       = (!completed && p && m.duration)
      ? Math.min(100, (p.position / m.duration) * 100) : 0;
    const dur = m.duration ? fmtTime(m.duration) : '';
    return `<li class="module-item${completed ? ' is-complete' : ''}" data-slug="${escAttr(m.slug)}">
      <div class="module-item-inner">
        <span class="module-check">${completed ? '<i class="icon-ok"></i>' : ''}</span>
        <span class="module-title">${escHtml(m.title || m.slug)}</span>
        ${dur ? `<span class="module-dur">${escHtml(dur)}</span>` : ''}
      </div>
      ${pct > 0 ? `<div class="module-progress"><div class="module-progress-fill" data-width="${pct.toFixed(1)}"></div></div>` : ''}
    </li>`;
  }).join('');
}

function _updateModuleList() {
  const list = document.getElementById('module-list');
  if (list) { list.innerHTML = _renderModuleListHTML(); applyDataStyles(list); }
  // Highlight active module
  document.querySelectorAll('.module-item').forEach(el =>
    el.classList.toggle('is-active', el.dataset.slug === state.moduleSlug)
  );
  // Course progress summary
  const completed = Object.values(_getAllProgress()).filter(p => p?.completed).length;
  const label = document.getElementById('course-progress-label');
  if (label) label.textContent = `Progress: ${completed} / ${state.manifest.modules.length} modules`;
}

// ── Slide asset preloading ─────────────────────────────────────────────────────

function _preloadBlocks(blocks) {
  for (const b of blocks) {
    if (b.type === 'image' && b.src) {
      const src = b.src.startsWith('assets/') ? `${state.courseRoot}/${b.src}` : b.src;
      new Image().src = src;
    } else if (b.type === 'columns') {
      for (const col of b.cols) _preloadBlocks(col.blocks ?? []);
    } else if (b.type === 'emph') {
      _preloadBlocks(b.blocks ?? []);
    }
  }
}

function _preloadSlideImages(slides) {
  for (const slide of slides) _preloadBlocks(slide.blocks ?? slide.body ?? []);
}

// ── HLS lazy loader ────────────────────────────────────────────────────────────
// For browsers with native HLS (Safari) we skip hls.js entirely.
// For others we inject it as a classic script on first need.

let _hlsLoad = null;

function loadHlsIfNeeded() {
  if (document.createElement('audio').canPlayType('application/vnd.apple.mpegurl')) {
    return Promise.resolve(); // native HLS — no library needed
  }
  if (typeof Hls !== 'undefined') return Promise.resolve(); // already loaded
  if (!_hlsLoad) {
    _hlsLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${state.courseRoot}/hls.js`;
      s.onload  = resolve;
      s.onerror = () => { _hlsLoad = null; reject(new Error('hls.js failed to load')); };
      document.head.appendChild(s);
    });
  }
  return _hlsLoad;
}

// ── Module loading ─────────────────────────────────────────────────────────────

async function loadModule(slug, pushState, autoPlay = false) {
  // Save and stop current playback. Null out slidesData before pausing so the
  // async 'pause' event (queued by audio.pause()) doesn't overwrite the new
  // module's saved progress with position 0 via saveCurrentProgress().
  saveCurrentProgress();
  state.slidesData = null;
  _stopPlayback();

  state.moduleSlug  = slug;
  state.slideIndex  = 0;
  state.slideTime   = 0;
  state._lastSavedSec = -1;

  // Fetch slides.json
  let slidesData;
  try {
    const resp = await fetch(`${state.courseRoot}/modules/${slug}/slides.json`);
    slidesData = await resp.json();
  } catch {
    const canvas = document.getElementById('slide-canvas');
    if (canvas) canvas.innerHTML = '<div class="sp-error">Failed to load module.</div>';
    return;
  }
  state.slidesData = slidesData;

  // Preload images for all slides so they're ready before playback reaches them
  _preloadSlideImages(slidesData.slides ?? []);

  // Update browser URL
  const modEntry = state.manifest.modules.find(m => m.slug === slug);
  const modPath  = modEntry?.path ? `${state.courseRoot}/${modEntry.path}` : null;
  if (pushState && modPath) {
    history.pushState({ module: slug }, modEntry?.title || slug, modPath);
  } else {
    history.replaceState({ module: slug }, document.title);
  }
  document.title = modEntry
    ? `${modEntry.title} — ${state.manifest.title}`
    : (state.manifest.title || '');

  // Setup audio
  if (slidesData.audio) {
    const hlsUrl = `${state.courseRoot}/modules/${slug}/${slidesData.audio}`;
    await loadHlsIfNeeded().catch(() => {});
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      state.hls = new Hls();
      state.hls.loadSource(hlsUrl);
      state.hls.attachMedia(state.audio);
    } else if (state.audio.canPlayType('application/vnd.apple.mpegurl')) {
      state.audio.src = hlsUrl;
    }
    state.audio.playbackRate = state.playbackRate;
  }

  // Duration display
  const dur = slidesData.totalDuration || 0;
  document.getElementById('time-total').textContent = fmtTime(dur);
  const scrubber = document.getElementById('progress-scrubber');
  if (scrubber) scrubber.max = String(dur);

  // Render first slide
  renderSlide();
  _updateModuleList();

  if (autoPlay) {
    // Auto-advance: skip resume prompt and start playing immediately
    document.getElementById('resume-prompt').hidden = true;
    togglePlay();
  } else {
    _showResumePromptIfNeeded();
  }
}

// ── Slide rendering ────────────────────────────────────────────────────────────

function renderSlide() {
  const canvas = document.getElementById('slide-canvas');
  if (!canvas) return;
  const slides = state.slidesData?.slides ?? [];
  const slide  = slides[state.slideIndex];
  if (!slide) { canvas.innerHTML = ''; return; }

  canvas.innerHTML = buildSlideHTML(slide, state.courseRoot);
  applyDataStyles(canvas);
  requestAnimationFrame(scaleCanvas);

  // Apply initial timing state to new slide
  // slideTime of -1 means not playing; updateTiming guards on this for emph activation
  const body = document.getElementById('sp-body');
  updateTiming(body, state.playing ? state.slideTime : -1, slides, state.slideIndex, state.courseRoot);
}

function scaleCanvas() {
  updateScale(
    document.getElementById('slide-stage'),
    document.getElementById('slide-canvas')
  );
}

// ── Playback ──────────────────────────────────────────────────────────────────

function togglePlay() {
  if (state.slidesData?.audio && !state._audioEnded) {
    // HLS / native audio mode
    if (state.playing) {
      state.audio.pause();
    } else {
      state.audio.play().catch(() => {});
    }
  } else {
    // Timer mode (no audio, or audio ended before slides finished)
    if (state.playing) {
      _timerPause();
    } else {
      _timerPlay();
    }
  }
}

function currentTime() {
  if (state.slidesData?.audio && !state._audioEnded) return state.audio.currentTime || 0;
  return state.timerOffset;
}

function seek(t) {
  const dur     = state.slidesData?.totalDuration || 0;
  const clamped = Math.max(0, Math.min(t, dur));

  // If audio ended early and we're seeking back into the audio's range, restore audio mode.
  if (state.slidesData?.audio && state._audioEnded) {
    const audioDur = isFinite(state.audio.duration) ? state.audio.duration : 0;
    if (clamped < audioDur - 0.1) {
      state._audioEnded = false;
      if (state.timerRaf) { cancelAnimationFrame(state.timerRaf); state.timerRaf = null; }
      state.audio.currentTime = clamped;
      if (state.playing) state.audio.play().catch(() => {});
      onTimeUpdate();
      return;
    }
  }

  if (state.slidesData?.audio && !state._audioEnded) {
    state.audio.currentTime = clamped;
    onTimeUpdate();
  } else {
    state.timerOffset = clamped;
    if (state.playing) state.timerBase = performance.now();
    _applyTime(clamped);
  }
}

// Timer mode (no audio) —  RAF loop
function _timerPlay() {
  state.timerBase = performance.now();
  state.playing   = true;
  _updatePlayBtn();
  _timerTick();
}
function _timerPause() {
  const elapsed = (performance.now() - state.timerBase) / 1000 * state.playbackRate;
  state.timerOffset += elapsed;
  state.playing = false;
  _updatePlayBtn();
  if (state.timerRaf) { cancelAnimationFrame(state.timerRaf); state.timerRaf = null; }
  saveCurrentProgress();
}
function _timerTick() {
  // Run in timer mode when there's no audio, or when audio ended early and slides continue
  if (!state.playing || (state.slidesData?.audio && !state._audioEnded)) return;
  const elapsed = (performance.now() - state.timerBase) / 1000 * state.playbackRate;
  const t       = state.timerOffset + elapsed;
  const dur     = state.slidesData?.totalDuration || 0;
  if (t >= dur) {
    state.timerOffset = dur;
    state.playing     = false;
    _updatePlayBtn();
    _applyTime(dur);
    onModuleEnded();
    return;
  }
  _applyTime(t);
  state.timerRaf = requestAnimationFrame(_timerTick);
}

// RAF loop for smooth progress bar updates in audio mode
function _audioRafTick() {
  if (!state.playing || !state.slidesData?.audio || state._audioEnded) return;
  _applyTime(state.audio.currentTime || 0);
  state.audioRaf = requestAnimationFrame(_audioRafTick);
}

// ── Time update (shared between audio mode and timer mode) ────────────────────

function onTimeUpdate() {
  // Only used for non-RAF-driven updates (e.g. seeking while paused)
  if (!state.playing) _applyTime(state.audio.currentTime || 0);
}

function _applyTime(t) {
  const dur    = state.slidesData?.totalDuration || 0;
  const pct    = dur > 0 ? (t / dur) * 100 : 0;
  const slides = state.slidesData?.slides ?? [];

  document.getElementById('time-current').textContent   = fmtTime(t);
  const remaining = Math.max(0, dur - t);
  document.getElementById('time-remaining').textContent = `-${fmtTime(remaining)}`;
  document.getElementById('progress-bar-fill').style.width = `${pct.toFixed(2)}%`;
  const scrubber = document.getElementById('progress-scrubber');
  if (scrubber && !scrubber.matches(':active')) scrubber.value = String(t);

  // Compute current slide index from audioStart offsets
  let idx = 0;
  for (let i = 0; i < slides.length; i++) {
    if (t >= (slides[i].audioStart ?? 0)) idx = i;
    else break;
  }
  const slideTime = t - (slides[idx]?.audioStart ?? 0);
  const changed   = idx !== state.slideIndex;
  state.slideIndex = idx;
  state.slideTime  = slideTime;

  if (changed) {
    renderSlide();
  } else {
    updateTiming(document.getElementById('sp-body'), slideTime, slides, idx, state.courseRoot);
  }

  // Throttle progress saves to once per second
  const sec = Math.floor(t);
  if (sec !== state._lastSavedSec) {
    state._lastSavedSec = sec;
    saveCurrentProgress();
  }
}

function _updatePlayBtn() {
  const btn = document.getElementById('btn-play-pause');
  if (btn) {
    const icon = btn.querySelector('i');
    if (icon) icon.className = state.playing ? 'icon-pause' : 'icon-play';
  }
  if (state.playing) {
    _showControls();  // restart hide timer
  } else {
    clearTimeout(_hideTimer);
    document.getElementById('player-area')?.classList.remove('controls-hidden');
  }
}

function onModuleEnded() {
  // Force-mark as complete — audio.currentTime at 'ended' can be slightly before totalDuration
  const dur = state.slidesData?.totalDuration || 0;
  if (dur > 0 && state.moduleSlug) {
    const all = _getAllProgress();
    all[state.moduleSlug] = { position: dur, completed: true };
    localStorage.setItem(_progressKey(), JSON.stringify(all));
    _updateModuleList();
  }
  // Auto-advance to next module and resume playback
  const modules = state.manifest.modules;
  const idx     = modules.findIndex(m => m.slug === state.moduleSlug);
  if (idx >= 0 && idx < modules.length - 1) {
    loadModule(modules[idx + 1].slug, true, true);
  }
}

function _stopPlayback() {
  if (state.timerRaf) { cancelAnimationFrame(state.timerRaf); state.timerRaf = null; }
  if (state.audioRaf) { cancelAnimationFrame(state.audioRaf); state.audioRaf = null; }
  state.timerOffset  = 0;
  state._audioEnded  = false;
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  state.audio.pause();
  state.audio.src = '';
  state.playing   = false;
  _updatePlayBtn();
}

// ── Fullscreen ────────────────────────────────────────────────────────────────

function toggleFullscreen() {
  const shell = document.getElementById('player-shell');
  if (!document.fullscreenElement) {
    shell.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
}

// ── Sidebar / modules drawer ──────────────────────────────────────────────────

function toggleSidebar() {
  document.getElementById('module-sidebar')?.classList.toggle('is-open');
}
function closeSidebar() {
  document.getElementById('module-sidebar')?.classList.remove('is-open');
}

// ── Progress tracking (localStorage) ─────────────────────────────────────────

function _progressKey() { return `useful-progress/${state.courseSlug}`; }

function _getAllProgress() {
  try { return JSON.parse(localStorage.getItem(_progressKey()) || '{}'); } catch { return {}; }
}

function _getSavedProgress(slug) {
  return slug ? (_getAllProgress()[slug] ?? null) : null;
}

function saveCurrentProgress() {
  if (!state.moduleSlug || !state.slidesData) return;
  const t         = currentTime();
  const dur       = state.slidesData.totalDuration || 0;
  const completed = dur > 0 && t >= dur * 0.9;
  try {
    const all      = _getAllProgress();
    const existing = all[state.moduleSlug];
    // Never downgrade a module that's already been marked complete
    if (existing?.completed && !completed) return;
    all[state.moduleSlug] = { position: t, completed };
    localStorage.setItem(_progressKey(), JSON.stringify(all));
  } catch {}
  _updateModuleList();
}

function _showResumePromptIfNeeded() {
  const saved  = _getSavedProgress(state.moduleSlug);
  const prompt = document.getElementById('resume-prompt');
  if (!prompt) return;
  if (saved && saved.position > 5 && !saved.completed) {
    document.getElementById('resume-text').textContent =
      `Resume from ${fmtTime(saved.position)}?`;
    prompt.hidden = false;
  } else {
    prompt.hidden = true;
  }
}

// ── PWA install ───────────────────────────────────────────────────────────────

async function doInstall() {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  const { outcome } = await state.installPrompt.userChoice;
  if (outcome === 'accepted') {
    state.installPrompt = null;
    const btn = document.getElementById('btn-install');
    if (btn) btn.hidden = true;
    // Ask the SW to download all HLS segments for offline use
    const sw = navigator.serviceWorker.controller
      ?? (await navigator.serviceWorker.ready).active;
    sw?.postMessage({ type: 'precache-segments' });
  }
}

// ── Launch ────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
