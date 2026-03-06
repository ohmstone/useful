// slide-parser.js — parses the useful slide language into an AST.
// See SLIDES.md for the full language reference.
//
// Entry point: parseSlides(text) → Slide[]
//
// Slide:
//   { duration, header, bg, body: Block[] }
//
// Block types: paragraph | heading | list | image | code | columns | emph | plugin
// Span types:  text | bold | italic | underline

// ── Public API ──────────────────────────────────────────────────────────────

export function parseSlides(text) {
  // Line-by-line scan so === inside code blocks isn't treated as a separator.
  const slides = [];
  const lines  = text.split('\n');
  let inCode    = false;
  let durStr    = null;
  let bodyLines = [];

  function flush() {
    if (durStr === null) return;
    slides.push(_parseSlide(parseFloat(durStr) || 5, bodyLines.join('\n')));
  }

  for (const line of lines) {
    const t = line.trim();

    // Track code fences so their contents are never inspected for ===
    if (inCode) {
      if (t === '```' || t === '~~~') inCode = false;
      if (durStr !== null) bodyLines.push(line);
      continue;
    }
    if (t.startsWith('```') || t.startsWith('~~~')) {
      inCode = true;
      if (durStr !== null) bodyLines.push(line);
      continue;
    }

    // Slide separator: === followed by at least one space/tab then a number
    if (/^===[ \t]+\S/.test(line)) {
      flush();
      durStr    = line.replace(/^===[ \t]+/, '').trim();
      bodyLines = [];
      continue;
    }

    if (durStr !== null) bodyLines.push(line);
  }
  flush();
  return slides;
}

// ── Slide body parser ────────────────────────────────────────────────────────

function _parseSlide(duration, text) {
  const slide = { duration, header: null, bg: null, body: [] };

  // — code block state —
  let inCode    = false;
  let codeLang  = '';
  let codeLines = [];

  // — columns state (@columns ... @col ... @end) —
  let inCols   = false;
  let col1W    = null;   // explicit width of first column (%)
  let colBods  = [[]];   // array of block arrays, one per column
  let colBgs   = [null];
  let colIdx   = 0;

  // — emphasis block state (@emph start dur ... @end) —
  let inEmph     = false;
  let emphStart  = 0;
  let emphDur    = 1;
  let emphBlocks = [];

  // — accumulator for the current open block —
  let pendingStyle = null;   // style hint from a {big center} line
  let cur          = null;   // paragraph or list being accumulated

  // Where to push finished blocks
  function target() {
    if (inEmph)  return emphBlocks;
    if (inCols)  return colBods[colIdx];
    return slide.body;
  }

  function flush() {
    if (!cur) return;
    // Paragraph: join accumulated lines into spans
    if (cur.type === 'paragraph') {
      cur.spans = parseInline(cur._lines.join(' '));
      delete cur._lines;
    }
    target().push(cur);
    cur = null;
  }

  function takeStyle() {
    const s = pendingStyle ?? { size: 'normal', align: 'left', color: null };
    pendingStyle = null;
    return s;
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const t    = line.trim();

    // ── Inside a code block (verbatim) ──────────────────────────────────
    if (inCode) {
      if (t === '```' || t === '~~~') {
        flush();
        target().push({ type: 'code', lang: codeLang, text: codeLines.join('\n') });
        inCode = false; codeLines = [];
      } else {
        codeLines.push(rawLine);
      }
      continue;
    }

    // ── Blank line ───────────────────────────────────────────────────────
    if (t === '') { flush(); continue; }

    // ── Directives (@cmd ...) ────────────────────────────────────────────
    if (t.startsWith('@')) {
      flush();
      const rest  = t.slice(1).trim();
      const sp    = rest.search(/\s/);
      const cmd   = sp >= 0 ? rest.slice(0, sp) : rest;
      const args  = sp >= 0 ? rest.slice(sp + 1).trim() : '';
      const ap    = _parseArgs(args);

      if (cmd === 'header') {
        const pipe = args.indexOf('|');
        slide.header = pipe >= 0
          ? { left: args.slice(0, pipe).trim(), right: args.slice(pipe + 1).trim() }
          : { left: args, right: '' };

      } else if (cmd === 'bg') {
        if (inCols) colBgs[colIdx] = args;
        else        slide.bg = args;

      } else if (cmd === 'columns') {
        inCols  = true;
        col1W   = ap[0] ? parseFloat(ap[0]) : null;
        colBods = [[]];
        colBgs  = [null];
        colIdx  = 0;

      } else if (cmd === 'col') {
        if (inCols) {
          colBods.push([]);
          colBgs.push(null);
          colIdx++;
        }

      } else if (cmd === 'end' || cmd.startsWith('end:')) {
        if (inEmph) {
          const eb = { type: 'emph', start: emphStart, duration: emphDur, blocks: emphBlocks };
          inEmph = false; emphBlocks = [];
          target().push(eb);
        } else if (inCols) {
          slide.body.push({ type: 'columns', cols: _buildCols(colBods, colBgs, col1W) });
          inCols = false; colBods = [[]]; colBgs = [null]; colIdx = 0;
        }

      } else if (cmd === 'emph') {
        inEmph     = true;
        emphStart  = parseFloat(ap[0]) || 0;
        emphDur    = parseFloat(ap[1]) || 1;
        emphBlocks = [];

      } else if (cmd === 'image') {
        const file = ap[0] || '';
        const fit  = ap[1] || 'contain';
        target().push({ type: 'image', src: `/api/inject/${encodeURIComponent(file)}`, alt: '', fit, ...takeStyle() });

      } else if (cmd === 'plugin') {
        target().push({ type: 'plugin', file: ap[0] || '', dataFile: ap[1] || null });
      }
      continue;
    }

    // ── Code fence ───────────────────────────────────────────────────────
    if (t.startsWith('```') || t.startsWith('~~~')) {
      flush();
      inCode = true; codeLang = t.slice(3).trim(); codeLines = [];
      continue;
    }

    // ── Style hint: {big center} on its own line ─────────────────────────
    if (/^\{[^}]+\}$/.test(t)) {
      const parsed = _parseStyleHint(t);
      if (parsed) { flush(); pendingStyle = parsed; continue; }
    }

    // ── Headings ─────────────────────────────────────────────────────────
    if (t.startsWith('## ')) {
      flush();
      target().push({ type: 'heading', level: 2, spans: parseInline(t.slice(3)), ...takeStyle() });
      continue;
    }
    if (t.startsWith('# ')) {
      flush();
      target().push({ type: 'heading', level: 1, spans: parseInline(t.slice(2)), ...takeStyle() });
      continue;
    }

    // ── Unordered list ───────────────────────────────────────────────────
    if (/^[-*] /.test(t)) {
      if (!cur || cur.type !== 'list' || cur.ordered) {
        flush();
        cur = { type: 'list', ordered: false, items: [], ...takeStyle() };
      }
      cur.items.push(parseInline(t.slice(2)));
      continue;
    }

    // ── Ordered list ─────────────────────────────────────────────────────
    if (/^\d+\. /.test(t)) {
      if (!cur || cur.type !== 'list' || !cur.ordered) {
        flush();
        cur = { type: 'list', ordered: true, items: [], ...takeStyle() };
      }
      cur.items.push(parseInline(t.replace(/^\d+\. /, '')));
      continue;
    }

    // ── Paragraph (default) ──────────────────────────────────────────────
    if (!cur || cur.type !== 'paragraph') {
      flush();
      cur = { type: 'paragraph', _lines: [], ...takeStyle() };
    }
    cur._lines.push(t);
  }

  flush();

  // Close any unclosed blocks gracefully
  if (inEmph && emphBlocks.length > 0) {
    slide.body.push({ type: 'emph', start: emphStart, duration: emphDur, blocks: emphBlocks });
  }
  if (inCols) {
    slide.body.push({ type: 'columns', cols: _buildCols(colBods, colBgs, col1W) });
  }

  return slide;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Split a directive argument string respecting single/double quoted tokens.
// e.g. '"my file.js" 2 5 "sales data.json"' → ['my file.js', '2', '5', 'sales data.json']
function _parseArgs(str) {
  const args = [];
  let i = 0;
  while (i < str.length) {
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) break;
    const q = str[i];
    if (q === '"' || q === "'") {
      i++;
      const start = i;
      while (i < str.length && str[i] !== q) i++;
      args.push(str.slice(start, i));
      if (i < str.length) i++;
    } else {
      const start = i;
      while (i < str.length && !/\s/.test(str[i])) i++;
      args.push(str.slice(start, i));
    }
  }
  return args;
}

function _buildCols(bodies, bgs, width1) {
  const n = bodies.length;
  return bodies.map((blocks, i) => ({
    blocks,
    bg: bgs[i],
    width: n === 1 ? 100
         : n === 2 ? (width1 == null ? 50 : i === 0 ? width1 : 100 - width1)
         : 100 / n,
  }));
}

const SIZES  = new Set(['big', 'normal', 'small']);
const ALIGNS = new Set(['left', 'center', 'right']);

function _parseStyleHint(raw) {
  const tokens = raw.slice(1, -1).trim().split(/\s+/);
  const s = { size: 'normal', align: 'left', color: null };
  let found = false;
  for (const t of tokens) {
    if (SIZES.has(t))              { s.size  = t;        found = true; }
    else if (ALIGNS.has(t))        { s.align = t;        found = true; }
    else if (t.startsWith('color:')) { s.color = t.slice(6); found = true; }
  }
  return found ? s : null;
}

// ── Inline parser ─────────────────────────────────────────────────────────────
// Handles: **bold**, *italic*, __underline__

export function parseInline(text) {
  const spans = [];
  let pos = 0, textStart = 0;

  const flushText = end => {
    if (end > textStart) spans.push({ type: 'text', text: text.slice(textStart, end) });
  };

  while (pos < text.length) {
    const ch = text[pos];

    // Bold: **...**
    if (ch === '*' && text[pos + 1] === '*') {
      const close = text.indexOf('**', pos + 2);
      if (close !== -1) {
        flushText(pos);
        spans.push({ type: 'bold', children: parseInline(text.slice(pos + 2, close)) });
        pos = textStart = close + 2; continue;
      }
    }

    // Italic: *...*  (only single *)
    if (ch === '*' && text[pos + 1] !== '*') {
      const close = text.indexOf('*', pos + 1);
      if (close !== -1) {
        flushText(pos);
        spans.push({ type: 'italic', children: parseInline(text.slice(pos + 1, close)) });
        pos = textStart = close + 1; continue;
      }
    }

    // Underline: __...__
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
