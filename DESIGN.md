# Design — useful

## Overview

`useful` is a self-hosted instructional course builder. The goal is a minimal
tool that lets users draft course content, structure it with LLM assistance,
add TTS voiceover, align audio with slides, and export a low-bandwidth static
website that plays like a video.

---

## Running

```
deno run --allow-net --allow-read --allow-write --allow-env=HOME --allow-run app.ts [--config <path>]
```

Or use the dev task (includes `--watch`):
```
deno task dev
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `.config/` next to `app.ts` | Override the config directory |

Port defaults to **7700**, auto-increments if busy (scans up to +50).

---

## File structure

```
app.ts                          # Deno HTTP server, all routes, no dependencies
deno.json                       # Activates Deno LS in IDE; defines dev task
SLIDES.md                       # Slide language reference (human + LLM readable)
core/
  index.html                    # SPA shell — mounts <app-root>, loads fonts + CSS
  style.css                     # CSS custom properties (theme tokens) + global reset
  main.js                       # ES module entry; imports all components (leaves first)
  slide-parser.js               # Slide language parser — parseSlides(text) → AST; parseInline(text) → spans
  components/
    course-card.js              # <course-card>    — displays one course; dispatches course-open
    course-list.js              # <course-list>    — course grid + search + new-course form
    course-view.js              # <course-view>    — ordered module list; drag-to-reorder
    dir-browser.js              # <dir-browser>    — filesystem navigator
    dir-picker.js               # <dir-picker>     — first-run setup shell
    slide-preview.js            # <slide-preview>  — 16:9 rich slide renderer; timing-aware (emph/inject)
    audio-track.js              # <audio-track>    — horizontal timeline; clips draggable to reposition
    audio-editor.js             # <audio-editor>   — waveform editor; cut/silence regions; saves WAV
    audio-library.js            # <audio-library>  — TTS + voice selector + clip list; Edit opens audio-editor
    module-editor.js            # <module-editor>  — full editing view; imports parseSlides; playback; syntax modal
    app-root.js                 # <app-root>       — top-level shell, state + nav machine
extra/
  pocket-tts-deno/              # git submodule — OpenAI-compatible TTS server (pocket-tts)
.config/                        # Auto-created next to app.ts (or --config path)
  config.json                   # { "projectDir": string | null }
```

---

## On-disk data layout

```
<projectDir>/
  _voice.json                   # { "voice": "<name>" }  — active TTS voice preference
  _voices/                      # Persistent custom voice WAV files (<name>.wav)
  _inject/                      # Custom JS inject modules (<name>.js) — served via /api/inject/:file
  # underscore-prefixed entries = project-level metadata; course names may NOT start with _
  <course>/
    modules.json                # ["module-name", ...]  (ordered)
    <module>/
      slides.txt                # Slide definitions (see format below and SLIDES.md)
      track.json                # [{ file, startTime, duration }]
      audio/
        <timestamp>.wav         # Generated audio clip
        <timestamp>.meta.json   # { text, duration }
```

### Slides format (`slides.txt`)

See [SLIDES.md](SLIDES.md) for the full language reference.

```
=== <seconds>
@header Left title | Right text
@bg #1a1a2e

# Heading

Normal paragraph with **bold** and *italic* text.

- Unordered list
- Another item

@emph 2 3
Emphasized content (spotlit at 2s for 3s).
@end

=== <seconds>
@columns 40
Left column content.
@col
Right column content.
@end
```

Each `=== N` line starts a new slide with duration N seconds (decimals ok).
Parsed client-side by `parseSlides()` in [slide-parser.js](core/slide-parser.js),
which returns a typed AST. The renderer in [slide-preview.js](core/components/slide-preview.js)
consumes the AST and supports timing-aware features (emph dimming, inject invocation).

**Block types:** `paragraph`, `heading` (level 1/2), `list` (ordered/unordered),
`image` (cover/contain/%), `code`, `columns`, `emph` (timed), `inject` (timed, external JS).

**Inline spans:** `text`, `bold`, `italic`, `underline`, `image` (inline).

**Style hints:** `{big}`, `{small}`, `{center}`, `{right}`, `{color:value}` — placed
on their own line, apply to the next block.

---

## Server (`app.ts`)

Single-file Deno HTTP server. Zero external dependencies.

### Config directory

Resolved at startup: `--config <path>` flag › `.config/` next to `app.ts`.
Created automatically if it doesn't exist.

### TTS server

At startup, `app.ts` spawns `extra/pocket-tts-deno/server.ts` as a Deno subprocess
on the first available port starting at 7800. The main server waits up to 30 s for
the TTS server to become ready, then re-registers all stored custom voices from
`<projectDir>/_voices/` (since pocket-tts stores voices in-memory only).

The subprocess is killed via `SIGTERM` when the main server process unloads.

TTS generation sends `POST /v1/audio/speech` to the pocket-tts server.
Built-in voices: `cosette` (default), `jean`, `fantine`.

Custom voices are uploaded as WAV files, persisted to `<projectDir>/_voices/<name>.wav`,
and re-registered automatically on each startup.

### API routes

| Method | Path | Body | Response | Description |
|--------|------|------|----------|-------------|
| GET | `/api/config` | — | `Config` | Read config |
| POST | `/api/config` | `{ projectDir }` | `Config` | Set project dir (must exist) |
| GET | `/api/courses` | — | `Course[]` | List course dirs |
| POST | `/api/courses` | `{ name }` | `Course` | Create course dir |
| GET | `/api/browse?path=` | — | `BrowseResult` | List subdirs (default `$HOME`) |
| POST | `/api/mkdir` | `{ parent, name }` | `{ path }` | Create subdir |
| GET | `/api/modules/:course` | — | `string[]` | Ordered module list |
| PUT | `/api/modules/:course` | `string[]` | 204 | Reorder modules |
| POST | `/api/modules/:course` | `{ name }` | `{ name }` | Create module (dir + scaffolding) |
| GET | `/api/slides/:course/:module` | — | `text/plain` | Get slides.txt content |
| PUT | `/api/slides/:course/:module` | `text/plain` | 204 | Save slides.txt |
| GET | `/api/track/:course/:module` | — | `TrackClip[]` | Get track composition |
| PUT | `/api/track/:course/:module` | `TrackClip[]` | 204 | Save track |
| GET | `/api/audio/:course/:module` | — | `AudioMeta[]` | List generated audio |
| POST | `/api/audio/:course/:module` | `{ text }` | `AudioMeta` | Generate audio via TTS (uses stored voice pref) |
| GET | `/api/audio/:course/:module/:file` | — | `audio/wav` | Serve WAV file |
| PUT | `/api/audio/:course/:module/:file` | `audio/wav` | `{ duration }` | Replace WAV (from editor) |
| DELETE | `/api/audio/:course/:module/:file` | — | 204 | Delete WAV + meta |
| GET | `/api/voices` | — | `{ builtin: string[], custom: string[] }` | List available TTS voices |
| POST | `/api/voices?name=<name>` | `audio/wav` | 200 | Upload + register custom voice |
| DELETE | `/api/voices/:name` | — | 204 | Remove custom voice (server + disk) |
| GET | `/api/voice` | — | `{ voice: string }` | Get active voice preference for project |
| PUT | `/api/voice` | `{ voice }` | 204 | Set active voice preference for project |
| GET | `/api/inject` | — | `string[]` | List `.js` files in `<projectDir>/_inject/` |
| GET | `/api/inject/:file` | — | `application/javascript` | Serve inject JS module |

### Static file serving

Non-API requests serve from `core/`. Path traversal (`..`) → 403.

---

## Frontend

SPA. No build step, no bundler, no framework. All web components use Shadow DOM.

### CSS theming

Theme tokens on `:root` in `style.css`. CSS custom properties pierce Shadow DOM
boundaries — all components inherit the dark theme automatically.

Key tokens: `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`,
`--text-muted`, `--text-dim`, `--accent`, `--accent-deep`, `--danger`,
`--radius`, `--radius-lg`, `--font`.

### Component tree

```
<app-root>              state machine + navigation
  <dir-picker>          setup state
    <dir-browser>       filesystem navigator
  <course-list>         courses view (nav = null)
    <course-card> ×N
  <course-view>         course view (nav.type = 'course')
  <module-editor>       editor view (nav.type = 'module')
    <slide-preview>
    <audio-track>
    <audio-library>
```

### App state machine (`<app-root>`)

```
         fetch /api/config
loading ──────────────────► setup  (no projectDir)
   │                          │ config-updated
   │                          ▼
   └────────────────────► ready
                            │
                    #nav = null → <course-list>
                    #nav.type = 'course' → <course-view>
                    #nav.type = 'module' → <module-editor>
```

Navigation events (all `bubbles: true, composed: true`):

| Event | Dispatched by | Detail |
|-------|--------------|--------|
| `config-updated` | `<dir-picker>` | `Config` |
| `course-open` | `<course-card>` | `{ name }` |
| `module-open` | `<course-view>` | `{ course, name }` |
| `nav-back` | `<course-view>`, `<module-editor>` | — |

### Module editor layout

```
┌─ nav bar: [← Back] [status] [? Syntax] [▶ Play] ────┐
│                                                      │
│  ┌─── Slides (textarea) ──┬─── Preview (16:9) ────┐ │
│  │ === 5                  │  [slide content]       │ │
│  │ Slide content…         │  ← 1 / 3 →             │ │
│  └────────────────────────┴────────────────────────┘ │
│                                                      │
│  ─── Audio Track ──────────────────────────────────  │
│  |0s   |5s   |10s  |15s   ...  (scrollable)         │
│  [clip────] [clip──────]      ← time tooltip on hover│
│                  │ ← sweeping red line during play   │
│                                                      │
│  ─── Generated Audio ──────────────────────────────  │
│  [Text to speak…              ] [Generate]           │
│  ▶ clip.wav  "hello world"  2.1s  [✎] [✕]          │
└──────────────────────────────────────────────────────┘
```

Slides auto-save 800ms after the last keystroke. Track width is derived from
total slide duration.

The **? Syntax** button opens a modal inside the shadow root with the full
slide language reference. The modal is dismissed by clicking the backdrop or ×.

During playback, `module-editor` passes both `currentIndex` and `slideTime`
(elapsed seconds within the current slide) to `<slide-preview>`. The preview
uses `slideTime` for emph dimming and inject invocation without re-rendering.

Drag clips from the Generated Audio list onto the Audio Track.
Click a track clip once to select it (shows red ✕), click ✕ to delete.
Clips on the track cannot overlap: drops/moves resolve to before/after the
conflicting clip; if no valid position exists the action is cancelled.

### Audio drag-and-drop

- `<audio-library>` sets `draggable="true"` on clip rows
- `dragstart`: `dataTransfer.setData('application/json', { file, text, duration })`
- `<audio-track>` listens for `dragover`/`drop` on its wrapper element
- On drop from library: calculates `startTime = dropX / PX_PER_SEC` (40 px/s), adds clip, auto-saves
- Clips already on the track are also draggable (internal move): uses `x-clip-move` dataTransfer key
  with `{ id, offsetX }` to reposition by drag

### Module playback

- Play button in `<module-editor>` nav bar
- On play: fetches track clips from API, parses slides, uses `requestAnimationFrame` loop to
  advance slide index and `setTimeout` to schedule audio clips at their `startTime`
- `<slide-preview>` exposes `set currentIndex(val)` and `set slideTime(val)` for programmatic control during playback
- `set slideTime(t)` triggers an incremental update (no full re-render): updates emph dimming CSS class and invokes active inject functions
- Stop button cancels RAF, clears timeouts, pauses all audio

### Audio editing (`<audio-editor>`)

- Inline editor shown below a clip when the Edit (✎) button is clicked in `<audio-library>`
- Fetches WAV, decodes via Web Audio API (`AudioContext.decodeAudioData`)
- Draws waveform on canvas; click to set a marker, click+drag to select a region
- **▶ Play**: re-encodes current buffer as a blob URL, plays it with a red sweeping cursor on the waveform
- **Cut**: removes selected region (requires a range selection)
- **Insert Silence**: inserts 1 second of silence at the marker / selection start — expands the audio
- Save: encodes modified buffer to 16-bit PCM WAV, PUTs to `/api/audio/:course/:module/:file`
  Server recalculates duration from the new WAV and updates the `.meta.json`
- Dispatches `audio-edited { file, duration }` on save; `audio-editor-close` on ×

### Audio track (`<audio-track>`)

- `set totalDuration(secs)`: updates ruler and track width without full re-render
- `set playTime(secs)`: moves a red vertical line across the track; pass `-1` to hide
- Clip drops and repositions use `#resolvePosition` to avoid overlap:
  cursor left-of-center on conflict → try placing before; right-of-center → after;
  if secondary conflict or out-of-bounds → cancel (drop is ignored)
- Scroll position is preserved when clips change (`#refreshLane` vs full `#render`)
- Two-click delete: first click selects a clip (shows red ✕), clicking ✕ deletes it; clicking background deselects
- Hover tooltip shows time (in seconds) at the cursor position over the track

---

## Data formats

### Config
```json
{ "projectDir": "/absolute/path" }
```

### modules.json
```json
["intro", "chapter-01", "chapter-02"]
```

### track.json
```json
[{ "file": "1704067200000.wav", "startTime": 0, "duration": 2.5 }]
```

### Audio meta (`.meta.json`)
```json
{ "text": "Hello world", "duration": 2.5 }
```

### BrowseResult
```json
{ "path": "/home/user", "entries": [{ "name": "projects" }] }
```
Hidden dirs (starting with `.`) are excluded.

### _voice.json (`<projectDir>/_voice.json`)
```json
{ "voice": "cosette" }
```
Defaults to `"cosette"` if file is absent.

### Voices list (`GET /api/voices`)
```json
{ "builtin": ["cosette", "jean", "fantine"], "custom": ["my-voice"] }
```
