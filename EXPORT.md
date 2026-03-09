# Export System — useful

This document specifies the course export system: generating a static, SEO-optimised,
self-contained directory that plays like a video course and can be dropped onto any web server.

---

## Overview

A course export is a **static directory** containing one HTML page per module plus a course
landing page. The player renders slides visually over an HLS audio track, presented in a
familiar 2-column course layout (sidebar list + main player). All content is also embedded
as valid, indexable HTML so it is readable by search engines and social scrapers without JS.

Additional goals:
- **PWA / installable** — a service worker caches all assets for full offline use; a web app
  manifest enables "Add to Home Screen" on mobile and desktop, presenting the course as a
  standalone app.
- **Responsive / mobile-first** — the layout adapts from the two-column desktop view to a
  stacked, touch-friendly mobile view.
- **Granular progress tracking** — per-module watch position (seconds) and completion state
  are stored in `localStorage` so learners can resume exactly where they left off.
- **Extensible module types** — the architecture treats `slides` as one possible module type.
  Future types (e.g. `quiz`, `article`) slot in without structural changes to the export format.

---

## Prerequisites / ffmpeg

The export system uses **ffmpeg** to assemble per-module audio tracks into HLS streams.

- At server startup, `app.ts` checks for ffmpeg via `which ffmpeg` (or `Deno.Command`).
- If ffmpeg is not found, a clear warning is printed to stderr:
  ```
  [WARN] ffmpeg not found — course audio export will be unavailable.
         Install ffmpeg and restart the server to enable this feature.
  ```
- The warning does not prevent the server from starting. All other functionality remains
  available. Export requests will return a 503 with an error message.

---

## Export configuration

A new config key `exportDir` is stored alongside `projectDir` in `.config/config.json`:

```json
{ "projectDir": "/absolute/path", "exportDir": "/absolute/export/path" }
```

The export directory is prompted on first export if not set (via a dir-browser dialog,
same pattern as the projectDir picker). It is set per-installation, not per-project.

New API routes for export config and trigger:

| Method | Path | Body | Response | Description |
|--------|------|------|----------|-------------|
| GET | `/api/export/config` | — | `{ exportDir: string\|null }` | Get export dir |
| POST | `/api/export/config` | `{ exportDir }` | `{ exportDir }` | Set export dir (must exist) |
| POST | `/api/export/:course` | — | `{ ok, path }` or error | Trigger full course export |
| GET | `/api/export/:course/status` | — | `{ state, progress, error }` | Poll export progress |
| GET | `/api/export/:course/download` | — | `application/zip` | Download course as ZIP archive |

Export is triggered from the course view in the main app (new "Export" button in `<course-view>`).

---

## Course metadata

A file `_meta.json` may exist in each course directory to provide rich metadata for the
export. If absent, defaults are derived from the course/module directory names.

```json
{
  "title": "Introduction to Parsing",
  "description": "A short course covering tokenisation, parsing, and evaluation.",
  "thumbnail": "thumbnail.jpg",
  "author": "Jane Smith",
  "tags": ["programming", "compilers"],
  "siteUrl": "https://example.com/courses/intro-to-parsing"
}
```

- `thumbnail` is a filename relative to `<projectDir>/_inject/`. If provided, it is copied
  to `assets/thumbnail.jpg` in the export and used for `og:image` and `twitter:image`.
- `siteUrl` is the canonical absolute URL where the course root (`index.html`) will be served
  (e.g. `https://example.com/courses/my-course`). When set, `og:image`, `og:url`, and
  `twitter:image` are all written as absolute URLs, which is required for social share
  previews to work on Twitter/X, LinkedIn, Slack, etc. Without it, image tags use relative
  paths (fine for local use; broken for social scrapers).
- All fields are optional. The course directory name (slugified) is always the URL slug.
- The main app gains an "Edit Metadata" panel in `<course-view>` for these fields.

Similarly, each module may have a `_meta.json` in its directory:

```json
{
  "title": "Lesson 1: What is a Parser?",
  "description": "We define parsing and introduce the three-phase model."
}
```

If absent, the module directory name is used as the title, and the text of the first slide
heading (if any) is used as the description.

---

## Export directory structure

```
<exportDir>/
  <course-slug>/
    index.html              # Course landing — loads first (or last-viewed) module in player
    manifest.json           # Course metadata + ordered module list + per-module durations
    manifest.webmanifest    # Web App Manifest — enables PWA install / Add to Home Screen
    sw.js                   # Service worker — caches all assets for offline use
    sw-manifest.json        # Asset list with SHA-256 hashes (debugging / tooling; not loaded at runtime)
    player.css              # Standalone player stylesheet (no inline styles)
    player.js               # Standalone player app (no inline scripts; ES module)
    hls.js                  # Copied verbatim from extra/hls.js
    assets/
      thumbnail.jpg         # Course thumbnail (if set in _meta.json)
      icon.svg              # PWA icon (derived from thumbnail, or default useful icon)
      <any _inject/ files>  # Images and data files referenced in slides
    modules/
      index.html            # Meta-refresh redirect → ../index.html (prevents bare /modules/ 404)
      <module-slug>/
        index.html          # Module page — full standalone HTML + readable content
        slides.json         # Parsed slide AST (used by player.js at runtime; type=slides)
        audio.m3u8          # HLS playlist (type=slides with audio only)
        audio-000.ts        # HLS segment files (AAC, ~4 s each)
        audio-001.ts
        …
```

All filenames are predictable and static. No hashes or nonces required. No server-side logic.

---

## manifest.json

```json
{
  "title": "Introduction to Parsing",
  "description": "A short course covering tokenisation, parsing, and evaluation.",
  "author": "Jane Smith",
  "thumbnail": "assets/thumbnail.jpg",
  "tags": ["programming", "compilers"],
  "modules": [
    {
      "slug": "what-is-a-parser",
      "title": "Lesson 1: What is a Parser?",
      "description": "We define parsing and introduce the three-phase model.",
      "type": "slides",
      "duration": 142.5,
      "path": "modules/what-is-a-parser/index.html"
    }
  ]
}
```

`duration` is always the total slide duration in seconds (sum of all per-slide `duration`
fields from the slide language). Slides are authoritative for runtime; the HLS audio export
is capped to this value so it never runs past the last slide.

`type` identifies the module renderer. Currently only `"slides"` is implemented. Future types
(e.g. `"quiz"`, `"article"`) are added without changing the outer manifest structure — the player
reads `type` and delegates to the appropriate renderer. Unknown types render a fallback message.

---

## HLS audio assembly

For each module, ffmpeg assembles the clips from `track.json` into a single HLS stream.

### Process

1. Read `track.json` → list of `{ file, startTime, duration }`.
2. Determine total duration = max(startTime + duration) across all clips.
3. Build ffmpeg filter graph using `adelay` to position each clip at its `startTime`:
   ```
   ffmpeg \
     -i audio/clip1.wav -i audio/clip2.wav \
     -filter_complex "
       [0:a]adelay=0|0[a0];
       [1:a]adelay=5000|5000[a1];
       [a0][a1]amix=inputs=2:duration=longest[out]
     " \
     -map "[out]" \
     -t <total_duration> \
     -c:a aac -b:a 64k -ar 22050 \
     -hls_time 4 \
     -hls_playlist_type vod \
     -hls_segment_filename "modules/<slug>/audio-%03d.ts" \
     modules/<slug>/audio.m3u8
   ```
   `adelay` values are `startTime * 1000` in milliseconds, duplicated for stereo (`|`).
4. If `track.json` is empty or missing, no HLS files are generated; `slides.json` records
   `"audio": null` and the player advances slides on a timer only.

### Error handling

If ffmpeg fails for a module, the export continues with remaining modules. The manifest
records `"audio": null` for the failed module and includes an `"audioError"` string. The
export summary shown in the UI lists which modules had audio failures.

---

## slides.json

The server runs `parseSlides()` server-side (same logic as the client parser) and writes
the resulting AST plus per-slide timing data:

```json
{
  "audio": "audio.m3u8",
  "totalDuration": 142.5,
  "slides": [
    {
      "duration": 8,
      "audioStart": 0,
      "bg": "#1a1a2e",
      "header": { "left": "Intro to Parsing", "right": "Lesson 1" },
      "blocks": [ … ]
    }
  ]
}
```

`audioStart` is the time offset into the HLS audio stream where this slide begins (= sum of
previous slide durations). The player seeks HLS audio to `audioStart` when navigating directly
to a slide or resuming playback.

The `blocks` array is the full slide AST as returned by `parseSlides()`, serialised verbatim.

---

## HTML structure

### Course landing (`index.html`)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Introduction to Parsing</title>
  <meta name="description" content="A short course covering…">
  <meta property="og:title" content="Introduction to Parsing">
  <meta property="og:description" content="A short course covering…">
  <meta property="og:image" content="https://example.com/courses/intro-to-parsing/assets/thumbnail.jpg">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://example.com/courses/intro-to-parsing/">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Introduction to Parsing">
  <meta name="twitter:description" content="A short course covering…">
  <meta name="twitter:image" content="https://example.com/courses/intro-to-parsing/assets/thumbnail.jpg">
  <link rel="stylesheet" href="player.css">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Course",
    "name": "Introduction to Parsing",
    "description": "A short course covering…",
    "hasPart": [ … course modules as CourseSection … ]
  }
  </script>
</head>
<body>
  <!-- Rendered by player.js; falls back gracefully without JS -->
  <main id="app">
    <nav id="module-list"><!-- populated by player.js --></nav>
    <section id="player"><!-- populated by player.js --></section>
  </main>
  <script type="module" src="player.js"></script>
</body>
</html>
```

Note: The JSON-LD `<script type="application/ld+json">` block is **not** subject to
`script-src` CSP restrictions — it is treated as data, not executable script.

### Module page (`modules/<slug>/index.html`)

Each module page is a complete, standalone HTML document. The slide content is rendered as
semantic HTML inside a `<article>` so it is fully indexable without JS:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lesson 1: What is a Parser? — Introduction to Parsing</title>
  <meta name="description" content="We define parsing and introduce the three-phase model.">
  <meta property="og:title" content="Lesson 1: What is a Parser?">
  <meta property="og:image" content="../../assets/thumbnail.jpg">
  <link rel="canonical" href="../../index.html#module=what-is-a-parser">
  <link rel="stylesheet" href="../../player.css">
  <script type="application/ld+json">{ … CourseSection structured data … }</script>
</head>
<body>
  <main id="app" data-module="what-is-a-parser" data-course-root="../..">
    <!-- Semantic fallback content — visible without JS, hidden by player.js -->
    <article class="module-content" aria-label="Module slide content">
      <h1>Lesson 1: What is a Parser?</h1>
      <!-- Each slide rendered as a <section> -->
      <section class="slide" data-duration="8" data-index="0">
        <h2>What is a parser?</h2>
        <p>A parser reads <strong>structured text</strong> and converts it into
        a form that a computer can work with — typically a tree.</p>
      </section>
      …
    </article>
  </main>
  <script type="module" src="../../player.js"></script>
</body>
</html>
```

The `<article class="module-content">` is hidden by `player.css` when the player is active
(`.player-active .module-content { display: none }`), but remains in the DOM for crawlers.
Without JS, only the article is shown — fully readable course content.

---

## Player layout (`player.js`)

The player is a two-column layout resembling a modern video course platform (e.g. similar to
Udemy / Coursera structure):

```
┌──────────────────────────────────────────┬──────────────────────┐
│                                          │  Course Title        │
│   SLIDE RENDERER (left, main)            │  ─────────────────── │
│   1920×1080 canvas, scaled to fit        │  ✓  1. Introduction  │
│   Same renderer as the authoring tool    │  ▶  2. What is…      │
│                                          │     3. Three phases  │
│  ────────────────────────────────────    │     4. Summary       │
│  [◀◀] [▶/⏸] [▶▶]  0:00 ───●──── 2:24    │                      │
│  [⛶ Fullscreen]  [⟨⟩ Slides 1/5]        │  Progress: 25%       │
└──────────────────────────────────────────┴──────────────────────┘
```

Mobile layout (< 768 px):

```
┌────────────────────────────┐
│  SLIDE RENDERER (16:9)     │
│                            │
│  [◀◀] [▶/⏸] [▶▶] [⛶]      │
│  0:00 ────●──────── 2:24   │
├────────────────────────────┤
│  [☰ Modules]  2. What is…  │  ← tab bar / drawer toggle
├────────────────────────────┤
│  (module list or current   │
│   module description)      │
└────────────────────────────┘
```

### Left column (player area)

- Slide renderer: the same 1920×1080 fixed-size canvas approach, scaled via ResizeObserver,
  reusing the same CSS/rendering logic as `slide-preview.js` (ported to the export context).
- Progress bar: scrubs through the entire module's audio track (seek by clicking/tapping).
  Touch target height is at least 44px for mobile accessibility.
- Controls: play/pause, skip back/forward 10s, fullscreen, slide counter.
- HLS audio via `hls.js`; the audio element drives the time source.
- Slide index is derived from audio `currentTime` vs the cumulative slide durations in
  `slides.json`. No separate RAF loop needed — the `timeupdate` event drives slide updates.
- Module type dispatch: player reads the `type` field from the manifest entry and renders the
  appropriate UI. For `"slides"`, it renders the slide canvas + HLS audio. Unknown types show
  a "module type not supported in this player version" message.

### Right column (module list)

- Lists all modules from `manifest.json`, each showing:
  - Module title
  - Module type badge (hidden for `"slides"` since it's the default; shown for others)
  - Total duration (formatted as m:ss; omitted for types without a fixed duration)
  - Progress indicator:
    - Unwatched: no indicator
    - In progress: thin progress bar (width = `% of duration watched`)
    - Completed: checkmark
- Clicking a module navigates to it (in-page, no full reload).
- On mobile, the module list is accessible via a drawer toggled by a "Modules" button.

### Progress tracking (localStorage)

Progress is stored in `localStorage` under the key `useful-progress/<course-slug>`:

```json
{
  "what-is-a-parser": { "position": 87.4, "completed": false },
  "three-phases":     { "position": 142.5, "completed": true }
}
```

- `position`: last `audio.currentTime` in seconds, written on `timeupdate` (throttled to once
  per second) and on pause/unload.
- `completed`: set to `true` when `position >= duration * 0.9` (90% threshold).
- On loading a module, if `position > 5` the player shows a "Resume from X:XX" prompt. The
  user can accept (seek to position) or dismiss (play from start).
- On mobile, on returning to a previously started module, the prompt appears automatically.

### Fullscreen and seamless module transitions

The player wraps both columns in a single `<div id="player-shell">`. Fullscreen is requested
on `player-shell` (not the entire `<document>`), so the module list remains accessible during
fullscreen (hidden until hovered/tapped, then slides in as an overlay).

When a module ends (audio reaches duration) or the user clicks a module in the sidebar:
1. Save current module's position to localStorage.
2. `player.js` fetches `<course-root>/modules/<slug>/slides.json` (or equivalent for other
   module types) via `fetch()` — served from cache when offline.
3. The renderer and audio source are updated in-place (no page navigation).
4. The browser URL is updated with `history.pushState()` to the new module's page path.
5. Fullscreen state is preserved throughout.
6. The "Resume from…" prompt is shown if the new module has a saved position > 5s.

When a module page is loaded directly (e.g. from a link or on refresh), `player.js` reads
`data-module` and `data-course-root` from `<main id="app">` and bootstraps the full player
with the correct module loaded (and resume prompt if applicable).

---

## CSP recommendation

The export directory is fully static and contains no inline scripts or styles. The
recommended `Content-Security-Policy` header (set at the web server level, e.g. nginx/Apache):

```
Content-Security-Policy:
  default-src 'none';
  script-src 'self';
  style-src 'self';
  img-src 'self';
  media-src 'self' blob:;
  font-src 'self';
  connect-src 'self';
  worker-src 'self';
  manifest-src 'self';
  form-action 'none';
  base-uri 'self';
  frame-ancestors 'none';
```

Notes:
- `media-src blob:` is required because hls.js feeds segments to the `<audio>` element via
  `MediaSource` → `URL.createObjectURL(mediaSource)`, which produces a `blob:` URL.
- `worker-src 'self'` allows the service worker (`sw.js`) to be registered. Service workers
  must be same-origin scripts, which `'self'` already permits.
- `connect-src 'self'` allows hls.js to fetch `.ts` segment files (and the service worker to
  fetch files for caching) from the same origin.
- `manifest-src 'self'` allows the browser to load `manifest.webmanifest`.
- `type="application/ld+json"` blocks are **not** covered by `script-src` — they are inert
  data nodes and do not require any CSP allowance.
- No `unsafe-inline`, no `unsafe-eval`, no CDN or external origins required.

A sample nginx snippet for serving the export directory:

```nginx
server {
  listen 80;
  root /var/www/courses;

  add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; form-action 'none'; base-uri 'self'; frame-ancestors 'none';" always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;

  # Required for HLS segments
  location ~* \.ts$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location / {
    try_files $uri $uri/ =404;
  }
}
```

---

## PWA / Offline support

### Web App Manifest (`manifest.webmanifest`)

Generated at export time alongside `manifest.json`:

```json
{
  "name": "Introduction to Parsing",
  "short_name": "Intro to Parsing",
  "description": "A short course covering tokenisation, parsing, and evaluation.",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#0d0d0f",
  "theme_color": "#0d0d0f",
  "icons": [
    { "src": "assets/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

- `start_url` is relative so the manifest works regardless of where the directory is served.
- `display: standalone` removes browser chrome when launched from home screen, presenting
  the course as a native-feeling app.
- The icon is an SVG (scales to any resolution). If the course has a `thumbnail.jpg`,
  the export uses it as the icon source. Otherwise a default `useful` icon SVG is used
  (stored in `core/export/icon.svg` and copied to `assets/icon.svg` during export).
- The `<link rel="manifest" href="../../manifest.webmanifest">` is added to every HTML page,
  with the correct relative path depth.

### Service worker (`sw.js`)

`sw.js` is generated at export time (not a static template) because it embeds the cache
version (the export timestamp) and a SHA-256 hash map of all assets as constants. The
generated file is registered with `navigator.serviceWorker.register` in `player.js`.

Strategy: **precache everything on install, with hash-based reuse and sequential segments**.

```javascript
// Generated sw.js (simplified)
const CACHE    = 'useful-course-<timestamp>';
const HASHES   = { './index.html': 'abc…', './modules/slug/audio-000.ts': 'def…', … };
const STATIC   = [/* non-.ts assets — fetched in parallel */];
const SEGMENTS = [/* .ts HLS segments — fetched sequentially */];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const newCache = await caches.open(CACHE);

    // Find any previous cache to reuse files whose hash hasn't changed
    const oldKey = (await caches.keys()).find(k => k !== CACHE && k.startsWith('useful-course-'));
    const oldHashes = oldKey ? await … : {};
    const oldCache  = oldKey ? await caches.open(oldKey) : null;

    async function cacheOne(url) {
      const hash = HASHES[url];
      if (hash && oldCache && oldHashes[url] === hash) {
        const hit = await oldCache.match(url);
        if (hit) { await newCache.put(url, hit); return; }  // reuse, no network request
      }
      const r = await fetch(new Request(url));  // plain GET → Caddy returns 200, not 206
      if (r.status === 200) await newCache.put(url, r);
    }

    await Promise.all(STATIC.map(cacheOne));          // static assets in parallel
    for (const url of SEGMENTS) await cacheOne(url);  // HLS segments sequentially

    // Persist hash snapshot for the next install comparison
    await newCache.put('__hashes', new Response(JSON.stringify(HASHES), …));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => { /* delete old caches */ });
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r ?? fetch(e.request)));
});
```

Key properties:
- **Cache key = export timestamp**: any re-export triggers a new SW install, which in turn
  triggers a full cache comparison and selective refresh.
- **Hash-based reuse**: files whose SHA-256 hash hasn't changed are copied from the old cache
  rather than re-fetched. Only changed, added, or removed files hit the network.
- **Sequential `.ts` download**: HLS audio segments are fetched one at a time during install
  to avoid flooding the server. Static assets (JS, CSS, HTML, JSON, images) are fetched
  in parallel since they are few and small.
- **Plain GET for segments**: `fetch(new Request(url))` strips any Range header, ensuring
  the server returns a full 200 response that `cache.put()` can accept (206 Partial Content
  is rejected by the Cache API).

The asset list and hash map are baked into `sw.js` directly (not fetched from
`sw-manifest.json` at runtime) to avoid a network round-trip on install.

### Install prompt

`player.js` listens for the `beforeinstallprompt` event and shows an unobtrusive
"Install Course" button in the player controls bar. Clicking it triggers the browser's
native install prompt. The button is hidden if the app is already running in standalone mode
(`window.matchMedia('(display-mode: standalone)').matches`).

---

## Responsive design

The player uses a single CSS file (`player.css`) with no inline styles. Layout breakpoints:

| Breakpoint | Layout |
|------------|--------|
| ≥ 1024 px | Two-column: player (flex 1) + sidebar (320 px fixed) |
| 768–1023 px | Two-column: player (flex 1) + sidebar (260 px fixed) |
| < 768 px | Single-column stacked: player full width, modules drawer below |

### Mobile-specific behaviour

- The slide canvas scales to 100% of the player column width via ResizeObserver (same
  mechanism as the authoring tool).
- All tap targets (play/pause, skip, progress bar, module list items) are at least 44×44 px.
- The progress bar has an enlarged touch hit area via `padding` + negative `margin`.
- The modules drawer is toggled by a "Modules ☰" button in the control bar. It slides up
  from the bottom as an overlay panel. Tapping outside the drawer closes it.
- Fullscreen on mobile uses the standard `requestFullscreen()` API; on iOS Safari (which
  does not support `requestFullscreen` on arbitrary elements), the player uses
  `<video playsinline>` as a fallback approach is noted but the primary target is
  Chromium-based mobile browsers. A graceful degradation note is shown to Safari users.
- The "Resume from…" prompt appears as a bottom sheet on mobile rather than a dialog.

---

## Module type extensibility

### The `type` field

Every module entry in `manifest.json` carries a `"type"` string. This is the single point
of dispatch for the player. The type determines:

1. Which content file to load from the module directory.
2. Which renderer `player.js` instantiates.
3. What semantic HTML is generated in the module's `index.html` fallback.
4. Whether a duration/progress bar is shown (timed types) or not (e.g. interactive).

### Defined types

| Type | Content file | Renderer | Duration |
|------|-------------|----------|----------|
| `slides` | `slides.json` | Slide canvas + HLS audio | Yes (fixed) |
| *(future)* `quiz` | `quiz.json` | Interactive question UI | No |
| *(future)* `article` | `article.json` | Formatted long-form text | No |

### Adding a new type (future)

1. Define the content schema (e.g. `quiz.json` with questions + answers).
2. Add a renderer function to `player.js` (or a separate `renderer-quiz.js` loaded lazily).
3. Add HTML generation logic to the export engine in `app.ts`.
4. Add the type to the module's `_meta.json` in the project.
5. The manifest, directory structure, service worker, and CSP require no changes.

### `_meta.json` module type field

```json
{
  "title": "Knowledge Check",
  "description": "Test your understanding of the three phases.",
  "type": "quiz"
}
```

Default type is `"slides"` if `type` is absent from `_meta.json`.

### Progress tracking for non-timed types

- For `slides`: progress is `position / duration` (time-based), completion at 90%.
- For future timed types: same model.
- For non-timed types (e.g. `quiz`): progress is either `0` (not started) or `1` (submitted).
  Stored in the same localStorage structure: `{ "position": 1, "completed": true }`.
- The module list shows an appropriate indicator per type (progress bar for timed,
  checkmark-only for non-timed).

---

## Archive format

A course export directory can be compressed as a standard ZIP archive. The archive is a
direct ZIP of the `<course-slug>/` directory (so extracting it produces `<course-slug>/`).

File extension convention: `.useful-course` (a ZIP with a renamed extension), or plain `.zip`.
The internal structure is identical to the export directory — no special wrapper directory.

The app provides a "Download Archive" button in the export UI that calls
`GET /api/export/:course/download`. The server ZIPs the export directory on-the-fly using
Deno's `Deno.Command` to invoke `zip`, and streams the result:

```
zip -r - <course-slug>/
```

Run from `<exportDir>` so paths inside the archive are relative and extract cleanly.

A compatible app can import a `.useful-course` archive by:
1. Unzipping to the `<exportDir>` directory.
2. Detecting the `manifest.json` at the archive root to identify it as a course export.

Alternatively, a future `POST /api/import` route could accept a ZIP upload.

---

## App changes summary

### New UI elements

- **`<course-view>`**: Add "Export" button in the course header. If `exportDir` is not set,
  clicking it opens the export-dir picker first. After setting, triggers export.
- **`<course-view>`**: Add "Edit Metadata" button/panel for `_meta.json` fields.
- **Export status overlay**: Shown during export — progress per module (HLS encoding is the
  slow step), with a completion screen showing the output path and "Download Archive" link.

### New server routes

See the API table in the [Export configuration](#export-configuration) section above.

### Config

`Config` interface gains `exportDir: string | null`. Existing config files without this key
default to `null` gracefully (no migration needed).

### ffmpeg check

At startup, immediately after TTS server launch, `app.ts` runs:
```typescript
const ffmpegCheck = await new Deno.Command("which", { args: ["ffmpeg"] }).output();
const FFMPEG_AVAILABLE = ffmpegCheck.success;
if (!FFMPEG_AVAILABLE) {
  console.error("[WARN] ffmpeg not found — audio export will be unavailable.");
}
```

---

## Export process (server-side, step by step)

1. Validate: course exists, exportDir is set, ffmpeg available (if any module has audio).
2. Resolve output path: `<exportDir>/<course-slug>/`. Overwrite if exists.
3. Create directory structure: `assets/`, `modules/<slug>/` for each module.
4. Copy static assets:
   - `extra/hls.js` → `<course>/hls.js`
   - Generate `player.css` and `player.js` from templates (no build step; templated strings
     in `app.ts` or served from `core/export/`).
5. Copy inject assets: all files in `<projectDir>/_inject/` → `assets/`.
6. Read `_meta.json` (course-level). Copy thumbnail if set.
7. For each module (in order from `modules.json`):
   a. Read module `_meta.json` (optional).
   b. Read `slides.txt`, parse with `parseSlides()`.
   c. Derive slide timing and compute `audioStart` offsets.
   d. Write `slides.json`.
   e. If `track.json` exists and has clips: run ffmpeg to generate HLS.
   f. Write `modules/<slug>/index.html` (full HTML with semantic fallback).
8. Write `manifest.json`.
9. Write `index.html` (course landing page).
10. Report completion: `{ ok: true, path: "<exportDir>/<course-slug>" }`.

Progress is reported per-module via the status endpoint (polled by the frontend).

---

## SEO and social sharing

- Each module page has: `<title>`, `<meta name="description">`, `og:title`, `og:description`,
  `og:image`, `og:type = "article"`, `og:url`, `twitter:card`, `twitter:title`,
  `twitter:description`, `twitter:image`.
- Course landing page has: `og:type = "website"`, `og:url`, `twitter:card`, `twitter:title`,
  `twitter:description`, `twitter:image`, full JSON-LD `Course` schema.
- Module pages have: JSON-LD `CourseSection` schema with `position`, `name`, `description`.
- `<link rel="canonical">` on module pages points back to the course landing with a hash
  (`../../index.html#module=<slug>`) so link equity consolidates.
- All slide text content is present in the DOM as readable HTML (the `<article>` fallback),
  not generated by JS, so crawlers index the full course content without executing JS.

### Social share image requirements

For previews to appear on Twitter/X, LinkedIn, Slack, and similar platforms:

- **`siteUrl` must be set** in `_meta.json` — social scrapers require absolute URLs for
  `og:image` and `twitter:image`. Relative paths will not resolve.
- **File format**: JPEG or PNG (SVG and WebP have limited scraper support). The thumbnail
  filename in `_meta.json` should be a `.jpg` or `.png` file stored in `<projectDir>/_inject/`.
- **Minimum size**: 600 × 314 px. Recommended: **1200 × 628 px** (2:1 ratio) for
  `summary_large_image` cards. Maximum file size: 5 MB.
- **`twitter:card`** is set to `summary_large_image` on all pages. If no thumbnail is
  provided, the card still renders but without an image preview.
- No conversion step is required — the file is copied as-is from `_inject/` to `assets/`.
