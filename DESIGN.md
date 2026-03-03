# Design — useful

## Overview

`useful` is a self-hosted instructional course builder. The goal is a minimal
tool that lets users draft course content, structure it with LLM assistance,
add TTS voiceover, align audio with slides, and export a low-bandwidth static
website that plays like a video.

---

## Running

```
deno run --allow-net --allow-read --allow-write --allow-env=HOME app.ts [--config <path>]
```

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | `.config/` next to `app.ts` | Override the config directory |

Port defaults to **7700**, auto-increments if busy (scans up to +50).

---

## File structure

```
app.ts                          # Deno HTTP server, all routes, no dependencies
core/
  index.html                    # SPA shell — mounts <app-root>, loads fonts + CSS
  style.css                     # CSS custom properties (theme tokens) + global reset
  main.js                       # ES module entry; imports all components (leaves first)
  components/
    course-card.js              # <course-card>   — displays one course directory
    course-list.js              # <course-list>   — course grid + new-course form
    dir-browser.js              # <dir-browser>   — filesystem navigator
    dir-picker.js               # <dir-picker>    — first-run setup shell
    app-root.js                 # <app-root>      — top-level shell, state machine
.config/                        # Auto-created next to app.ts (or --config path)
  config.json                   # { "projectDir": string | null }
```

---

## Server (`app.ts`)

Single-file Deno HTTP server. Zero external dependencies.

### Config directory

Resolved at startup in priority order:
1. `--config <path>` CLI flag
2. `.config/` next to `app.ts`

Created automatically if it doesn't exist.

### Port selection

`findPort(7700)` — tries `Deno.listen({ port })` from 7700 upward; first
success wins.

### API routes

| Method | Path | Body | Response | Description |
|--------|------|------|----------|-------------|
| GET | `/api/config` | — | `Config` | Read current config |
| POST | `/api/config` | `{ projectDir }` | `Config` | Set project dir (must exist) |
| GET | `/api/courses` | — | `Course[]` | List course dirs in projectDir |
| POST | `/api/courses` | `{ name }` | `Course` | Create new course directory |
| GET | `/api/browse?path=` | — | `BrowseResult` | List subdirs at path (default: `$HOME`) |
| POST | `/api/mkdir` | `{ parent, name }` | `{ path }` | Create a subdirectory |

All other requests are served as static files from `core/`.

### Static file serving

`serveFile(pathname)` maps requests to `core/<pathname>`. Requests containing
`..` return 403. Unknown extensions get `application/octet-stream`.

---

## Frontend

Single-page application. No build step, no bundler, no framework.

### CSS theming

All theme tokens are CSS custom properties on `:root` in `style.css`.
Because custom properties pierce Shadow DOM boundaries, all components
automatically inherit the dark theme.

Key tokens: `--bg`, `--surface`, `--surface-raised`, `--border`,
`--text`, `--text-muted`, `--text-dim`, `--accent`, `--accent-deep`,
`--danger`, `--radius`, `--radius-lg`, `--font`.

### Component tree

```
<app-root>              state machine: loading → setup | ready
  <dir-picker>          rendered in 'setup' state
    <dir-browser>       filesystem navigator; user selects or creates a dir
  <course-list>         rendered in 'ready' state
    <course-card> ×N    one per course directory
```

All components use Shadow DOM (`attachShadow({ mode: 'open' })`).

### App state machine (`<app-root>`)

```
         fetch /api/config
loading ──────────────────► setup   (projectDir is null)
   │                         │
   │                         │ config-updated event
   │                         ▼
   └────────────────────► ready    (projectDir is set)
```

### Custom events (all: `bubbles: true, composed: true`)

| Event | Dispatched by | Caught by | Detail |
|-------|--------------|-----------|--------|
| `dir-selected` | `<dir-browser>` | `<dir-picker>` | `{ path: string }` |
| `config-updated` | `<dir-picker>` | `<app-root>` | `Config` object |

`composed: true` allows events to cross Shadow DOM boundaries as they bubble.

---

## Component reference

### `<app-root>`
Top-level shell. Owns the state machine (`loading` / `setup` / `ready`).
Renders the header (logo + project path) and swaps the main view based on state.
Listens for `config-updated` in its constructor (host element, not shadow root).

### `<dir-picker>`
Shown in `setup` state. Wraps `<dir-browser>` in a card with a title and
description. Listens for `dir-selected` (constructor), calls `POST /api/config`
with the chosen path, then dispatches `config-updated`. Errors are written
directly to `#error` element without re-rendering (preserves dir-browser state).

### `<dir-browser>`
Filesystem navigator. Fetches `GET /api/browse?path=` to populate a directory
listing. Provides:
- Breadcrumb navigation (clicking a segment navigates up)
- Directory list (clicking an entry navigates into it)
- **"Use this folder"** → dispatches `dir-selected` with current path
- **"Create folder here"** form → calls `POST /api/mkdir`, then dispatches
  `dir-selected` with the newly created path

### `<course-list>`
Fetches `GET /api/courses` and renders a CSS grid of `<course-card>` elements.
Includes an inline "+ New Course" form that calls `POST /api/courses`.
All state and DOM wiring are handled internally; re-renders shadow DOM on state
change and re-attaches listeners after each render.

### `<course-card>`
Purely presentational. Attributes: `name`. Property: `contents` (string[]).
Shows course name, item count, and first 8 contents. Uses private class fields.

---

## Data formats

### Config (`config.json`)
```json
{ "projectDir": "/absolute/path/to/courses" }
```

### Course (API)
```json
{ "name": "my-course", "contents": ["module-01", "course.json"] }
```

### BrowseResult (API)
```json
{ "path": "/home/user/projects", "entries": [{ "name": "courses" }, ...] }
```
Only directories are returned (hidden dirs starting with `.` are excluded).
