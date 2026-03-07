// useful — instructional course builder
// Run: deno run --allow-net --allow-read --allow-write --allow-env=HOME --allow-run app.ts [--config <path>]
// deno-lint-ignore-file no-explicit-any

import { parseSlides } from "./core/slide-parser.js";

// ─── Paths ───────────────────────────────────────────────────────────────────

const BASE = import.meta.dirname!;

const cfgFlagIdx = Deno.args.indexOf("--config");
const CONFDIR = (cfgFlagIdx >= 0 && Deno.args[cfgFlagIdx + 1])
  ? Deno.args[cfgFlagIdx + 1]
  : `${BASE}/.config`;

const CONFILE    = `${CONFDIR}/config.json`;
const STATIC     = `${BASE}/core`;
const EXTRA      = `${BASE}/extra`;

// ─── ffmpeg availability (checked at startup) ─────────────────────────────────

let FFMPEG_AVAILABLE = false;

// ─── Types ───────────────────────────────────────────────────────────────────

interface Config { projectDir: string | null; exportDir: string | null; }
interface CourseMeta { title?: string; description?: string; thumbnail?: string; author?: string; tags?: string[]; }
interface ModuleMeta { title?: string; description?: string; type?: string; }
interface Course { name: string; contents: string[]; }

interface AudioMeta { text: string; duration: number; }
interface TrackClip { file: string; startTime: number; duration: number; }

// ─── Config ──────────────────────────────────────────────────────────────────

async function readConfig(): Promise<Config> {
  try {
    const data = JSON.parse(await Deno.readTextFile(CONFILE));
    return { projectDir: data.projectDir ?? null, exportDir: data.exportDir ?? null };
  }
  catch { return { projectDir: null, exportDir: null }; }
}

async function writeConfig(config: Config): Promise<void> {
  await Deno.mkdir(CONFDIR, { recursive: true });
  await Deno.writeTextFile(CONFILE, JSON.stringify(config, null, 2));
}

// ─── Voice preference (per-project) ──────────────────────────────────────────

function voiceFile(pd: string) { return `${pd}/_voice.json`; }

async function readVoice(pd: string): Promise<string> {
  try { return (JSON.parse(await Deno.readTextFile(voiceFile(pd)))).voice ?? "cosette"; }
  catch { return "cosette"; }
}

async function writeVoice(pd: string, voice: string): Promise<void> {
  await Deno.writeTextFile(voiceFile(pd), JSON.stringify({ voice }, null, 2));
}

// ─── Course / module metadata ────────────────────────────────────────────────

function courseMetaFile(pd: string, course: string)           { return `${pd}/${course}/_meta.json`; }
function moduleMetaFile(pd: string, course: string, mod: string) { return `${pd}/${course}/${mod}/_meta.json`; }

async function readMeta<T>(path: string): Promise<T> {
  try { return JSON.parse(await Deno.readTextFile(path)); }
  catch { return {} as T; }
}

async function writeMeta(path: string, data: unknown): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2));
}

// ─── TTS server management ────────────────────────────────────────────────────

let TTS_PORT = 0;

async function waitForTtsServer(port: number): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const r = await fetch(`http://localhost:${port}/v1/voices`);
      await r.body?.cancel();
      if (r.ok) return;
    } catch { /* not ready yet */ }
  }
  throw new Error(`TTS server did not start on port ${port}`);
}

// Re-register all stored custom voices after a TTS server restart
async function registerStoredVoices(port: number, voicesDir: string): Promise<void> {
  try {
    for await (const entry of Deno.readDir(voicesDir)) {
      if (!entry.name.endsWith(".wav")) continue;
      const name = entry.name.replace(/\.wav$/, "");
      try {
        const wav = await Deno.readFile(`${voicesDir}/${entry.name}`);
        await fetch(
          `http://localhost:${port}/v1/voices?name=${encodeURIComponent(name)}`,
          { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav },
        );
      } catch { /* skip failed registrations */ }
    }
  } catch { /* voices dir may not exist yet */ }
}

// ─── Courses ─────────────────────────────────────────────────────────────────

async function listCourses(dir: string): Promise<Course[]> {
  const courses: Course[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isDirectory || entry.name.startsWith("_")) continue;
    const contents: string[] = [];
    try {
      for await (const sub of Deno.readDir(`${dir}/${entry.name}`)) {
        contents.push(sub.name);
      }
    } catch { /* skip unreadable */ }
    courses.push({ name: entry.name, contents });
  }
  return courses.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Modules ─────────────────────────────────────────────────────────────────

const INITIAL_SLIDES = `=== 5\nWelcome to this module.\n\n=== 5\nAdd your slide content here.\n`;

function mDir(pd: string, c: string, m: string)  { return `${pd}/${c}/${m}`; }
function modulesFile(pd: string, c: string)       { return `${pd}/${c}/modules.json`; }
function slidesFile(pd: string, c: string, m: string) { return `${mDir(pd,c,m)}/slides.txt`; }
function trackFile(pd: string, c: string, m: string)  { return `${mDir(pd,c,m)}/track.json`; }
function audioDir(pd: string, c: string, m: string)   { return `${mDir(pd,c,m)}/audio`; }

async function readModules(pd: string, course: string): Promise<string[]> {
  try { return JSON.parse(await Deno.readTextFile(modulesFile(pd, course))); }
  catch { return []; }
}

async function writeModules(pd: string, course: string, mods: string[]): Promise<void> {
  await Deno.writeTextFile(modulesFile(pd, course), JSON.stringify(mods, null, 2));
}

// Fix WAV header sizes (streaming WAVs use 0xFFFFFFFF sentinel) and return duration in seconds.
async function fixAndMeasureWav(path: string): Promise<number> {
  try {
    const fileSize = (await Deno.stat(path)).size;
    const fh = await Deno.open(path, { read: true, write: true });
    const buf = new Uint8Array(512);
    const n = (await fh.read(buf)) ?? 0;
    if (n < 12) { fh.close(); return 0; }

    const view = new DataView(buf.buffer, 0, n);
    let pos = 12; // skip RIFF(4) + fileSize(4) + WAVE(4)
    let byteRate = 0;
    let dataPos = -1;

    while (pos + 8 <= n) {
      const id = String.fromCharCode(buf[pos], buf[pos+1], buf[pos+2], buf[pos+3]);
      const chunkSize = view.getUint32(pos + 4, true);
      if (id === 'fmt ' && pos + 20 <= n) {
        byteRate = view.getUint32(pos + 16, true);
        pos += 8 + chunkSize + (chunkSize & 1);
      } else if (id === 'data') {
        dataPos = pos;
        break;
      } else {
        pos += 8 + chunkSize + (chunkSize & 1);
      }
    }

    if (dataPos < 0 || byteRate === 0) { fh.close(); return 0; }

    const dataSize = fileSize - (dataPos + 8);
    view.setUint32(4, fileSize - 8, true);        // fix RIFF chunk size
    view.setUint32(dataPos + 4, dataSize, true);  // fix data chunk size
    await fh.seek(0, Deno.SeekMode.Start);
    await fh.write(buf.subarray(0, n));
    fh.close();

    return byteRate > 0 ? dataSize / byteRate : 0;
  } catch { return 0; }
}

// ─── Static file serving ─────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".wav":  "audio/wav",
};

async function serveFile(pathname: string): Promise<Response> {
  if (pathname.includes("..")) return new Response("Forbidden", { status: 403 });
  const target = (pathname === "/" || pathname === "")
    ? `${STATIC}/index.html`
    : `${STATIC}${pathname}`;
  const ext = "." + target.split(".").pop()!.toLowerCase();
  try {
    const data = await Deno.readFile(target);
    return new Response(data, { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" } });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// ─── Export engine ───────────────────────────────────────────────────────────

interface ExportModState { state: "pending" | "done" | "error"; error?: string; }
interface ExportJob {
  state: "running" | "done" | "error";
  progress: { done: number; total: number };
  modules: Record<string, ExportModState>;
  path?: string;
  error?: string;
}
interface ModuleEntry {
  slug: string; title: string; description: string; type: string;
  duration: number; path: string; audioError?: string;
}

const exportJobs = new Map<string, ExportJob>();

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function spansToHtml(spans: any[]): string {
  return (spans ?? []).map((s: any): string => {
    switch (s.type) {
      case "text":      return escapeHtml(s.text ?? "");
      case "bold":      return `<strong>${spansToHtml(s.children)}</strong>`;
      case "italic":    return `<em>${spansToHtml(s.children)}</em>`;
      case "underline": return `<u>${spansToHtml(s.children)}</u>`;
      default:          return "";
    }
  }).join("");
}

function blockToHtml(b: any, assetBase: string): string {
  switch (b.type) {
    case "paragraph": return `<p>${spansToHtml(b.spans)}</p>`;
    case "heading": {
      const lv = (b.level ?? 1) + 1; // slide h1 → <h2> (h1 is module title)
      return `<h${lv}>${spansToHtml(b.spans)}</h${lv}>`;
    }
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const items = (b.items ?? []).map((i: any[]) => `<li>${spansToHtml(i)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "code": {
      const cls = b.lang ? ` class="language-${escapeHtml(b.lang)}"` : "";
      return `<pre><code${cls}>${escapeHtml(b.text ?? "")}</code></pre>`;
    }
    case "image": {
      const file = decodeURIComponent((b.src ?? "").replace("/api/inject/", ""));
      return `<figure><img src="${assetBase}/${escapeHtml(file)}" alt="" loading="lazy"></figure>`;
    }
    case "emph":
      return `<div class="emph">${(b.blocks ?? []).map((x: any) => blockToHtml(x, assetBase)).join("")}</div>`;
    case "columns":
      return `<div class="columns">${(b.cols ?? []).map((c: any) =>
        `<div class="col">${(c.blocks ?? []).map((x: any) => blockToHtml(x, assetBase)).join("")}</div>`
      ).join("")}</div>`;
    case "plugin":
      return `<!-- plugin: ${escapeHtml(b.file ?? "")} -->`;
    default: return "";
  }
}

// Rewrite /api/inject/<file> → assets/<file> in parsed slide AST (for slides.json)
function rewriteInjectPaths(obj: any): any {
  return JSON.parse(JSON.stringify(obj), (_: string, v: any) => {
    if (typeof v === "string" && v.startsWith("/api/inject/")) {
      return `assets/${decodeURIComponent(v.slice(12))}`;
    }
    return v;
  });
}

// Extract plain text of the first heading across all slides (description fallback)
function firstHeadingText(slides: any[]): string {
  for (const slide of slides) {
    for (const b of (slide.body ?? [])) {
      if (b.type === "heading") return spansToHtml(b.spans).replace(/<[^>]+>/g, "");
    }
  }
  return "";
}

// Run ffmpeg to assemble audio clips → HLS stream in outDir
async function runHlsExport(clips: TrackClip[], aDir: string, outDir: string): Promise<void> {
  const inputArgs: string[] = [];
  for (const c of clips) inputArgs.push("-i", `${aDir}/${c.file}`);

  let filterComplex: string;
  if (clips.length === 1) {
    const ms = Math.round(clips[0].startTime * 1000);
    filterComplex = `[0:a]adelay=${ms}|${ms}[out]`;
  } else {
    const parts: string[] = [];
    const labels: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const ms = Math.round(clips[i].startTime * 1000);
      parts.push(`[${i}:a]adelay=${ms}|${ms}[a${i}]`);
      labels.push(`[a${i}]`);
    }
    parts.push(`${labels.join("")}amix=inputs=${clips.length}:duration=longest[out]`);
    filterComplex = parts.join(";");
  }

  const totalDuration = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
  const r = await new Deno.Command("ffmpeg", {
    args: [
      "-y", ...inputArgs,
      "-filter_complex", filterComplex,
      "-map", "[out]",
      "-t", String(totalDuration),
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-hls_time", "4",
      "-hls_playlist_type", "vod",
      "-hls_segment_filename", `${outDir}/audio-%03d.ts`,
      `${outDir}/audio.m3u8`,
    ],
    stdout: "null",
    stderr: "piped",
  }).output();

  if (!r.success) {
    throw new Error(`ffmpeg: ${new TextDecoder().decode(r.stderr).slice(-500)}`);
  }
}

// ── HTML templates ────────────────────────────────────────────────────────────

const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#1a1a2e"/>
  <text x="50" y="68" font-size="60" text-anchor="middle" font-family="sans-serif" fill="#7c6af7">U</text>
</svg>`;

function buildModuleHtml(opts: {
  courseTitle: string; modTitle: string; modSlug: string;
  description: string; slides: any[]; thumbnail: string | null;
}): string {
  const { courseTitle, modTitle, modSlug, description, slides, thumbnail } = opts;
  const assetBase = "../../assets";
  const ogImg = thumbnail ? `../../${thumbnail}` : "";

  const body = slides.map((s: any, i: number) => {
    const blocks = (s.body ?? []).map((b: any) => `    ${blockToHtml(b, assetBase)}`).join("\n");
    return `  <section class="slide" data-duration="${s.duration}" data-index="${i}">\n${blocks}\n  </section>`;
  }).join("\n");

  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CourseSection",
    "name": modTitle,
    "description": description,
    "isPartOf": { "@type": "Course", "name": courseTitle },
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(modTitle)} — ${escapeHtml(courseTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(modTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${ogImg ? `<meta property="og:image" content="${escapeHtml(ogImg)}">` : ""}
  <meta property="og:type" content="article">
  <link rel="canonical" href="../../index.html#module=${encodeURIComponent(modSlug)}">
  <link rel="stylesheet" href="../../player.css">
  <link rel="manifest" href="../../manifest.webmanifest">
  <script type="application/ld+json">${ld}</script>
</head>
<body>
  <main id="app" data-module="${escapeHtml(modSlug)}" data-course-root="../..">
    <article class="module-content" aria-label="Module slide content">
      <h1>${escapeHtml(modTitle)}</h1>
${body}
    </article>
  </main>
  <script src="../../hls.js"></script>
  <script type="module" src="../../player.js"></script>
</body>
</html>`;
}

function buildCourseIndexHtml(meta: CourseMeta, courseName: string, modules: ModuleEntry[]): string {
  const title = meta.title ?? courseName;
  const description = meta.description ?? "";
  const thumbnail = meta.thumbnail ? "assets/thumbnail.jpg" : "";

  const modList = modules.map(m =>
    `      <li><a href="${escapeHtml(m.path)}">${escapeHtml(m.title)}</a></li>`
  ).join("\n");

  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Course",
    "name": title,
    "description": description,
    ...(meta.author ? { "author": { "@type": "Person", "name": meta.author } } : {}),
    "hasPart": modules.map((m, i) => ({
      "@type": "CourseSection", "position": i + 1, "name": m.title, "description": m.description,
    })),
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${thumbnail ? `<meta property="og:image" content="${escapeHtml(thumbnail)}">` : ""}
  <meta property="og:type" content="website">
  <link rel="stylesheet" href="player.css">
  <link rel="manifest" href="manifest.webmanifest">
  <script type="application/ld+json">${ld}</script>
</head>
<body>
  <main id="app">
    <nav id="module-list" aria-label="Course modules">
      <h1>${escapeHtml(title)}</h1>
      <ul>
${modList}
      </ul>
    </nav>
    <section id="player"></section>
  </main>
  <script src="hls.js"></script>
  <script type="module" src="player.js"></script>
</body>
</html>`;
}

function buildWebManifest(meta: CourseMeta, courseName: string): Record<string, unknown> {
  const name = meta.title ?? courseName;
  const words = name.split(/\s+/);
  const shortName = words.length > 3 ? words.slice(0, 3).join(" ") : name;
  return {
    name, short_name: shortName,
    description: meta.description ?? "",
    start_url: "./index.html",
    display: "standalone",
    background_color: "#0d0d0f",
    theme_color: "#0d0d0f",
    icons: [{ src: "assets/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  };
}

function buildSwJs(timestamp: number, assets: string[]): string {
  const list = JSON.stringify(assets.map(a => `./${a}`), null, 2);
  return `// Generated service worker — useful course export
const CACHE = 'useful-course-${timestamp}';
const ASSETS = ${list};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r ?? fetch(e.request)));
});
`;
}

// ── Main export pipeline ──────────────────────────────────────────────────────

async function runExport(course: string, pd: string, expDir: string): Promise<void> {
  const job = exportJobs.get(course)!;
  try {
    const modules = await readModules(pd, course);
    if (modules.length === 0) throw new Error("Course has no modules");

    const courseSlug = slugify(course);
    const outDir = `${expDir}/${courseSlug}`;
    await Deno.mkdir(`${outDir}/assets`, { recursive: true });
    const allFiles: string[] = [];

    // hls.js
    await Deno.copyFile(`${BASE}/extra/hls.js`, `${outDir}/hls.js`);
    allFiles.push("hls.js");

    // player.css + player.js — copy from core/export/ if present, else write stubs
    for (const f of ["player.css", "player.js"]) {
      const dst = `${outDir}/${f}`;
      try { await Deno.copyFile(`${BASE}/core/export/${f}`, dst); }
      catch {
        await Deno.writeTextFile(dst, f.endsWith(".css")
          ? "/* player.css — phase 3 */"
          : "// player.js — phase 3\nif ('serviceWorker' in navigator) {\n  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});\n}\n");
      }
      allFiles.push(f);
    }

    // Course metadata
    const courseMeta = await readMeta<CourseMeta>(courseMetaFile(pd, course));
    const courseTitle = courseMeta.title ?? course;

    // Thumbnail (source: _inject/<filename>)
    if (courseMeta.thumbnail) {
      try {
        await Deno.copyFile(`${pd}/_inject/${courseMeta.thumbnail}`, `${outDir}/assets/thumbnail.jpg`);
        allFiles.push("assets/thumbnail.jpg");
      } catch { /* thumbnail missing from _inject */ }
    }

    // Icon
    try { await Deno.copyFile(`${BASE}/core/export/icon.svg`, `${outDir}/assets/icon.svg`); }
    catch { await Deno.writeTextFile(`${outDir}/assets/icon.svg`, DEFAULT_ICON_SVG); }
    allFiles.push("assets/icon.svg");

    // Copy all _inject/ files to assets/
    try {
      for await (const e of Deno.readDir(`${pd}/_inject`)) {
        if (!e.isFile) continue;
        await Deno.copyFile(`${pd}/_inject/${e.name}`, `${outDir}/assets/${e.name}`).catch(() => {});
        const key = `assets/${e.name}`;
        if (!allFiles.includes(key)) allFiles.push(key);
      }
    } catch { /* _inject may not exist */ }

    // Process each module
    job.progress.total = modules.length;
    const moduleEntries: ModuleEntry[] = [];

    for (const modName of modules) {
      const modSlug = slugify(modName);
      const modOutDir = `${outDir}/modules/${modSlug}`;
      await Deno.mkdir(modOutDir, { recursive: true });
      job.modules[modSlug] = { state: "pending" };

      try {
        const modMeta = await readMeta<ModuleMeta>(moduleMetaFile(pd, course, modName));
        const modTitle = modMeta.title ?? modName;
        const modType  = modMeta.type ?? "slides";

        const rawSlides = parseSlides(
          await Deno.readTextFile(slidesFile(pd, course, modName)).catch(() => "")
        );

        // Add audioStart offsets
        let t = 0;
        const timedSlides = rawSlides.map((s: any) => {
          const audioStart = t;
          t += (s.duration ?? 0);
          return { ...s, audioStart };
        });
        const totalDuration = t;

        const clips: TrackClip[] = JSON.parse(
          await Deno.readTextFile(trackFile(pd, course, modName)).catch(() => "[]")
        );

        // HLS audio assembly
        let hlsFile: string | null = null;
        let audioError: string | undefined;
        if (clips.length > 0) {
          try {
            await runHlsExport(clips, audioDir(pd, course, modName), modOutDir);
            hlsFile = "audio.m3u8";
            allFiles.push(`modules/${modSlug}/audio.m3u8`);
            for await (const e of Deno.readDir(modOutDir)) {
              if (e.name.endsWith(".ts")) allFiles.push(`modules/${modSlug}/${e.name}`);
            }
          } catch (e) {
            audioError = String(e);
          }
        }

        // slides.json
        const slidesJson: Record<string, unknown> = {
          audio: hlsFile,
          totalDuration,
          slides: timedSlides.map(rewriteInjectPaths),
        };
        if (audioError) slidesJson.audioError = audioError;
        await Deno.writeTextFile(`${modOutDir}/slides.json`, JSON.stringify(slidesJson, null, 2));
        allFiles.push(`modules/${modSlug}/slides.json`);

        const description = modMeta.description ?? firstHeadingText(rawSlides);

        // module index.html
        await Deno.writeTextFile(`${modOutDir}/index.html`, buildModuleHtml({
          courseTitle, modTitle, modSlug, description,
          slides: rawSlides, thumbnail: courseMeta.thumbnail ? "assets/thumbnail.jpg" : null,
        }));
        allFiles.push(`modules/${modSlug}/index.html`);

        moduleEntries.push({
          slug: modSlug, title: modTitle, description, type: modType,
          duration: totalDuration, path: `modules/${modSlug}/index.html`,
          ...(audioError ? { audioError } : {}),
        });
        job.modules[modSlug] = { state: "done" };
      } catch (e) {
        job.modules[modSlug] = { state: "error", error: String(e) };
        moduleEntries.push({
          slug: modSlug, title: modName, description: "", type: "slides",
          duration: 0, path: `modules/${modSlug}/index.html`,
        });
      }
      job.progress.done++;
    }

    // manifest.json
    const manifest: Record<string, unknown> = {
      title: courseTitle,
      description: courseMeta.description ?? "",
      tags: courseMeta.tags ?? [],
      modules: moduleEntries,
    };
    if (courseMeta.author) manifest.author = courseMeta.author;
    if (courseMeta.thumbnail) manifest.thumbnail = "assets/thumbnail.jpg";
    await Deno.writeTextFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
    allFiles.push("manifest.json");

    // course index.html
    await Deno.writeTextFile(`${outDir}/index.html`,
      buildCourseIndexHtml(courseMeta, course, moduleEntries));
    allFiles.push("index.html");

    // manifest.webmanifest
    await Deno.writeTextFile(`${outDir}/manifest.webmanifest`,
      JSON.stringify(buildWebManifest(courseMeta, course), null, 2));
    allFiles.push("manifest.webmanifest");

    // sw-manifest.json (debug / tooling)
    await Deno.writeTextFile(`${outDir}/sw-manifest.json`, JSON.stringify(allFiles, null, 2));

    // sw.js (precache list baked in)
    await Deno.writeTextFile(`${outDir}/sw.js`, buildSwJs(Date.now(), allFiles));
    allFiles.push("sw.js");

    job.state = "done";
    job.path  = outDir;
  } catch (e) {
    job.state = "error";
    job.error = String(e);
  }
}

// ─── Request router ──────────────────────────────────────────────────────────

async function handle(req: Request): Promise<Response> {
  const { pathname, searchParams } = new URL(req.url);
  const method = req.method;
  const seg = pathname.split("/").filter(Boolean); // ['api', 'resource', ...]

  // ── Config ───────────────────────────────────────────────────────────────

  if (pathname === "/api/config" && method === "GET") {
    return Response.json(await readConfig());
  }

  if (pathname === "/api/config" && method === "POST") {
    const body = await req.json() as { projectDir?: unknown };
    if (typeof body.projectDir !== "string") {
      return Response.json({ error: "projectDir must be a string" }, { status: 400 });
    }
    try {
      if (!(await Deno.stat(body.projectDir)).isDirectory) throw 0;
    } catch {
      return Response.json({ error: "Path does not exist or is not a directory" }, { status: 400 });
    }
    const config = await readConfig();
    config.projectDir = body.projectDir;
    await writeConfig(config);
    return Response.json(config);
  }

  // ── Courses ──────────────────────────────────────────────────────────────

  if (pathname === "/api/courses" && method === "GET") {
    const { projectDir } = await readConfig();
    if (!projectDir) return Response.json([]);
    try { return Response.json(await listCourses(projectDir)); }
    catch { return Response.json({ error: "Cannot read project directory" }, { status: 500 }); }
  }

  if (pathname === "/api/courses" && method === "POST") {
    const { projectDir } = await readConfig();
    if (!projectDir) return Response.json({ error: "No project directory" }, { status: 400 });
    const body = await req.json() as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || !/^[\w\s\-]+$/.test(name) || name.startsWith("_")) {
      return Response.json({ error: "Invalid course name" }, { status: 400 });
    }
    try { await Deno.mkdir(`${projectDir}/${name}`); }
    catch { return Response.json({ error: "Could not create course (may already exist)" }, { status: 400 }); }
    return Response.json({ name, contents: [] }, { status: 201 });
  }

  // ── Browse / mkdir ───────────────────────────────────────────────────────

  if (pathname === "/api/browse" && method === "GET") {
    const target = searchParams.get("path") ?? Deno.env.get("HOME") ?? Deno.cwd();
    try {
      if (!(await Deno.stat(target)).isDirectory) throw 0;
      const entries: { name: string }[] = [];
      for await (const e of Deno.readDir(target)) {
        if (e.isDirectory && !e.name.startsWith(".")) entries.push({ name: e.name });
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return Response.json({ path: target, entries });
    } catch { return Response.json({ error: "Cannot read directory" }, { status: 404 }); }
  }

  if (pathname === "/api/mkdir" && method === "POST") {
    const body = await req.json() as { parent?: unknown; name?: unknown };
    const parent = typeof body.parent === "string" ? body.parent : "";
    const name   = typeof body.name   === "string" ? body.name.trim() : "";
    if (!parent || !name) return Response.json({ error: "parent and name required" }, { status: 400 });
    if (/[/\\]/.test(name)) return Response.json({ error: "Name cannot contain path separators" }, { status: 400 });
    try {
      await Deno.mkdir(`${parent}/${name}`);
      return Response.json({ path: `${parent}/${name}` });
    } catch { return Response.json({ error: "Could not create directory (may already exist)" }, { status: 400 }); }
  }

  // ── Voices ───────────────────────────────────────────────────────────────

  // GET /api/voices — list all voices from TTS server
  if (pathname === "/api/voices" && method === "GET") {
    try {
      const res = await fetch(`http://localhost:${TTS_PORT}/v1/voices`);
      return Response.json(await res.json());
    } catch {
      return Response.json({ error: "TTS server unavailable" }, { status: 503 });
    }
  }

  // POST /api/voices?name=<name> — upload a custom voice WAV; stored persistently
  if (pathname === "/api/voices" && method === "POST") {
    const name = searchParams.get("name")?.trim() ?? "";
    if (!name || !/^[\w\-]+$/.test(name)) {
      return Response.json({ error: "Invalid voice name (alphanumeric + hyphens only)" }, { status: 400 });
    }
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });
    const voicesDir = `${pd}/_voices`;
    try {
      const wav = new Uint8Array(await req.arrayBuffer());
      await Deno.mkdir(voicesDir, { recursive: true });
      await Deno.writeFile(`${voicesDir}/${name}.wav`, wav);
      const ttsRes = await fetch(
        `http://localhost:${TTS_PORT}/v1/voices?name=${encodeURIComponent(name)}`,
        { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav },
      );
      if (!ttsRes.ok) {
        await Deno.remove(`${voicesDir}/${name}.wav`).catch(() => {});
        const err = await ttsRes.text();
        return Response.json({ error: `TTS server rejected voice: ${err}` }, { status: 500 });
      }
      await ttsRes.body?.cancel();
      return Response.json({ name }, { status: 201 });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }

  // DELETE /api/voices/:name — remove a custom voice
  if (seg[0] === "api" && seg[1] === "voices" && seg.length === 3 && method === "DELETE") {
    const name = decodeURIComponent(seg[2]);
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });
    try {
      await fetch(`http://localhost:${TTS_PORT}/v1/voices/${encodeURIComponent(name)}`, { method: "DELETE" });
      await Deno.remove(`${pd}/_voices/${name}.wav`).catch(() => {});
      return new Response(null, { status: 204 });
    } catch {
      return Response.json({ error: "TTS server unavailable" }, { status: 503 });
    }
  }

  // ── Voice preference ─────────────────────────────────────────────────────

  // GET /api/voice — read active voice for the current project
  if (pathname === "/api/voice" && method === "GET") {
    const { projectDir: pd } = await readConfig();
    const voice = pd ? await readVoice(pd) : "cosette";
    return Response.json({ voice });
  }

  // PUT /api/voice — save active voice for the current project
  if (pathname === "/api/voice" && method === "PUT") {
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });
    const { voice } = await req.json() as { voice?: string };
    if (!voice?.trim()) return Response.json({ error: "voice required" }, { status: 400 });
    await writeVoice(pd, voice.trim());
    return Response.json({ voice: voice.trim() });
  }

  // ── Modules  GET|POST /api/modules/:course ───────────────────────────────

  if (seg[0] === "api" && seg[1] === "modules" && seg.length === 3) {
    const course = decodeURIComponent(seg[2]);
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });

    if (method === "GET") {
      return Response.json(await readModules(pd, course));
    }

    if (method === "PUT") {
      const names = await req.json() as string[];
      if (!Array.isArray(names)) return Response.json({ error: "Expected array" }, { status: 400 });
      await writeModules(pd, course, names);
      return new Response(null, { status: 204 });
    }

    if (method === "POST") {
      const { name } = await req.json() as { name?: string };
      const moduleName = name?.trim() ?? "";
      if (!moduleName || !/^[\w\s\-]+$/.test(moduleName)) {
        return Response.json({ error: "Invalid module name" }, { status: 400 });
      }
      const dir = mDir(pd, course, moduleName);
      try {
        await Deno.mkdir(dir, { recursive: true });
        await Deno.mkdir(audioDir(pd, course, moduleName), { recursive: true });
        await Deno.writeTextFile(slidesFile(pd, course, moduleName), INITIAL_SLIDES);
        await Deno.writeTextFile(trackFile(pd, course, moduleName), "[]");
        const mods = await readModules(pd, course);
        if (!mods.includes(moduleName)) {
          mods.push(moduleName);
          await writeModules(pd, course, mods);
        }
      } catch {
        return Response.json({ error: "Could not create module" }, { status: 400 });
      }
      return Response.json({ name: moduleName }, { status: 201 });
    }
  }

  // ── Slides  GET|PUT /api/slides/:course/:module ──────────────────────────

  if (seg[0] === "api" && seg[1] === "slides" && seg.length === 4) {
    const [course, module] = [decodeURIComponent(seg[2]), decodeURIComponent(seg[3])];
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });

    if (method === "GET") {
      try { return new Response(await Deno.readTextFile(slidesFile(pd, course, module)), { headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
      catch { return new Response("", { headers: { "Content-Type": "text/plain" } }); }
    }

    if (method === "PUT") {
      const text = await req.text();
      await Deno.writeTextFile(slidesFile(pd, course, module), text);
      return new Response(null, { status: 204 });
    }
  }

  // ── Track  GET|PUT /api/track/:course/:module ────────────────────────────

  if (seg[0] === "api" && seg[1] === "track" && seg.length === 4) {
    const [course, module] = [decodeURIComponent(seg[2]), decodeURIComponent(seg[3])];
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });

    if (method === "GET") {
      try { return Response.json(JSON.parse(await Deno.readTextFile(trackFile(pd, course, module)))); }
      catch { return Response.json([]); }
    }

    if (method === "PUT") {
      const clips = await req.json() as TrackClip[];
      await Deno.writeTextFile(trackFile(pd, course, module), JSON.stringify(clips, null, 2));
      return new Response(null, { status: 204 });
    }
  }

  // ── Audio  /api/audio/:course/:module[/:file] ────────────────────────────

  if (seg[0] === "api" && seg[1] === "audio" && (seg.length === 4 || seg.length === 5)) {
    const [course, module] = [decodeURIComponent(seg[2]), decodeURIComponent(seg[3])];
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });
    const aDir = audioDir(pd, course, module);

    // GET /api/audio/:course/:module/:file — serve a wav file
    if (seg.length === 5 && method === "GET") {
      const file = seg[4];
      if (file.includes("..") || file.includes("/")) return new Response("Forbidden", { status: 403 });
      try {
        const data = await Deno.readFile(`${aDir}/${file}`);
        return new Response(data, { headers: { "Content-Type": "audio/wav" } });
      } catch { return new Response("Not Found", { status: 404 }); }
    }

    // PUT /api/audio/:course/:module/:file — replace WAV (from audio editor)
    if (seg.length === 5 && method === "PUT") {
      const file = decodeURIComponent(seg[4]);
      if (file.includes("..") || file.includes("/")) return new Response("Forbidden", { status: 403 });
      const wavPath = `${aDir}/${file}`;
      const data = new Uint8Array(await req.arrayBuffer());
      await Deno.writeFile(wavPath, data);
      const duration = await fixAndMeasureWav(wavPath);
      const metaPath = `${aDir}/${file.replace(/\.wav$/, ".meta.json")}`;
      try {
        const meta: AudioMeta = JSON.parse(await Deno.readTextFile(metaPath));
        meta.duration = duration;
        await Deno.writeTextFile(metaPath, JSON.stringify(meta, null, 2));
      } catch { /* no meta to update */ }
      return Response.json({ duration });
    }

    // DELETE /api/audio/:course/:module/:file
    if (seg.length === 5 && method === "DELETE") {
      const file = seg[4];
      if (file.includes("..") || file.includes("/")) return new Response("Forbidden", { status: 403 });
      try {
        await Deno.remove(`${aDir}/${file}`);
        const meta = `${aDir}/${file.replace(/\.wav$/, ".meta.json")}`;
        await Deno.remove(meta).catch(() => {});
        return new Response(null, { status: 204 });
      } catch { return Response.json({ error: "File not found" }, { status: 404 }); }
    }

    // GET /api/audio/:course/:module — list generated audio
    if (seg.length === 4 && method === "GET") {
      const clips: (AudioMeta & { file: string })[] = [];
      try {
        for await (const e of Deno.readDir(aDir)) {
          if (!e.name.endsWith(".wav")) continue;
          let meta: AudioMeta = { text: "", duration: 0 };
          try {
            meta = JSON.parse(await Deno.readTextFile(`${aDir}/${e.name.replace(/\.wav$/, ".meta.json")}`));
          } catch { /* no meta */ }
          clips.push({ file: e.name, ...meta });
        }
        clips.sort((a, b) => a.file.localeCompare(b.file));
      } catch { /* empty dir */ }
      return Response.json(clips);
    }

    // POST /api/audio/:course/:module — generate audio via TTS server
    if (seg.length === 4 && method === "POST") {
      const { text } = await req.json() as { text?: string };
      if (!text?.trim()) return Response.json({ error: "text required" }, { status: 400 });
      const voice = await readVoice(pd);
      const file = `${Date.now()}.wav`;
      const wavPath = `${aDir}/${file}`;
      await Deno.mkdir(aDir, { recursive: true });
      try {
        const ttsRes = await fetch(`http://localhost:${TTS_PORT}/v1/audio/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: text.trim(), voice }),
        });
        if (!ttsRes.ok) throw new Error(`TTS error ${ttsRes.status}: ${await ttsRes.text()}`);
        await Deno.writeFile(wavPath, new Uint8Array(await ttsRes.arrayBuffer()));
        const duration = await fixAndMeasureWav(wavPath);
        const meta: AudioMeta = { text: text.trim(), duration };
        await Deno.writeTextFile(`${aDir}/${file.replace(/\.wav$/, ".meta.json")}`, JSON.stringify(meta, null, 2));
        return Response.json({ file, text: text.trim(), duration }, { status: 201 });
      } catch (e) {
        await Deno.remove(wavPath).catch(() => {});
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }
  }

  // ── Inject files  /api/inject[/:file] ───────────────────────────────────

  if (seg[0] === "api" && seg[1] === "inject") {
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });
    const injectDir = `${pd}/_inject`;

    // GET /api/inject — list all files with sizes
    if (seg.length === 2 && method === "GET") {
      const files: { name: string; size: number }[] = [];
      try {
        for await (const e of Deno.readDir(injectDir)) {
          if (!e.isFile) continue;
          const stat = await Deno.stat(`${injectDir}/${e.name}`).catch(() => null);
          files.push({ name: e.name, size: stat?.size ?? 0 });
        }
        files.sort((a, b) => a.name.localeCompare(b.name));
      } catch { /* dir may not exist yet */ }
      return Response.json(files);
    }

    // Validate filename for all single-file operations
    const injectFile = seg.length === 3 ? decodeURIComponent(seg[2]) : null;
    if (injectFile !== null && (injectFile.includes("..") || injectFile.includes("/") || !injectFile.trim())) {
      return new Response("Forbidden", { status: 403 });
    }

    // GET /api/inject/:file — serve any file (JS as module, others by MIME type)
    if (injectFile && method === "GET") {
      try {
        const data = await Deno.readFile(`${injectDir}/${injectFile}`);
        const ext  = "." + injectFile.split(".").pop()!.toLowerCase();
        const ct   = MIME[ext] ?? "application/octet-stream";
        return new Response(data, { headers: { "Content-Type": ct } });
      } catch { return new Response("Not Found", { status: 404 }); }
    }

    // POST /api/inject/:file — upload / overwrite a file
    if (injectFile && method === "POST") {
      try {
        await Deno.mkdir(injectDir, { recursive: true });
        const data = new Uint8Array(await req.arrayBuffer());
        await Deno.writeFile(`${injectDir}/${injectFile}`, data);
        return Response.json({ name: injectFile, size: data.length }, { status: 201 });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    }

    // DELETE /api/inject/:file — remove a file
    if (injectFile && method === "DELETE") {
      try {
        await Deno.remove(`${injectDir}/${injectFile}`);
        return new Response(null, { status: 204 });
      } catch { return Response.json({ error: "Not found" }, { status: 404 }); }
    }
  }

  // ── Course / module metadata  /api/meta/:course[/:module] ────────────────

  if (seg[0] === "api" && seg[1] === "meta" && (seg.length === 3 || seg.length === 4)) {
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });
    const course = decodeURIComponent(seg[2]);

    if (seg.length === 3) {
      // Course-level meta
      if (method === "GET") {
        return Response.json(await readMeta<CourseMeta>(courseMetaFile(pd, course)));
      }
      if (method === "PUT") {
        const body = await req.json() as CourseMeta;
        await writeMeta(courseMetaFile(pd, course), body);
        return new Response(null, { status: 204 });
      }
    }

    if (seg.length === 4) {
      // Module-level meta
      const mod = decodeURIComponent(seg[3]);
      if (method === "GET") {
        return Response.json(await readMeta<ModuleMeta>(moduleMetaFile(pd, course, mod)));
      }
      if (method === "PUT") {
        const body = await req.json() as ModuleMeta;
        await writeMeta(moduleMetaFile(pd, course, mod), body);
        return new Response(null, { status: 204 });
      }
    }
  }

  // ── Export config  /api/export/config ────────────────────────────────────

  if (pathname === "/api/export/config" && method === "GET") {
    const { exportDir } = await readConfig();
    return Response.json({ exportDir });
  }

  if (pathname === "/api/export/config" && method === "POST") {
    const body = await req.json() as { exportDir?: unknown };
    if (typeof body.exportDir !== "string") {
      return Response.json({ error: "exportDir must be a string" }, { status: 400 });
    }
    try {
      if (!(await Deno.stat(body.exportDir)).isDirectory) throw 0;
    } catch {
      return Response.json({ error: "Path does not exist or is not a directory" }, { status: 400 });
    }
    const config = await readConfig();
    config.exportDir = body.exportDir;
    await writeConfig(config);
    return Response.json({ exportDir: config.exportDir });
  }

  // ── Export  POST /api/export/:course | GET /api/export/:course/status ────

  if (seg[0] === "api" && seg[1] === "export" && seg.length >= 3 && seg[2] !== "config") {
    const { projectDir: pd, exportDir: expDir } = await readConfig();
    if (!expDir) return Response.json({ error: "Export directory not configured" }, { status: 503 });

    const course = decodeURIComponent(seg[2]);

    // GET /api/export/:course/status
    if (method === "GET" && seg[3] === "status") {
      const job = exportJobs.get(course);
      if (!job) return Response.json({ state: "idle", progress: { done: 0, total: 0 }, modules: {} });
      return Response.json({
        state: job.state, progress: job.progress, modules: job.modules,
        path: job.path, error: job.error,
      });
    }

    // POST /api/export/:course — trigger export
    if (method === "POST" && seg.length === 3) {
      if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });
      if (!FFMPEG_AVAILABLE) {
        return Response.json({ error: "ffmpeg not found — audio export unavailable" }, { status: 503 });
      }
      const existing = exportJobs.get(course);
      if (existing?.state === "running") {
        return Response.json({ error: "Export already in progress" }, { status: 409 });
      }
      const courseSlug = slugify(course);
      const outPath = `${expDir}/${courseSlug}`;
      exportJobs.set(course, {
        state: "running", progress: { done: 0, total: 0 }, modules: {}, path: outPath,
      });
      runExport(course, pd, expDir); // fire-and-forget; poll /status for progress
      return Response.json({ ok: true, path: outPath });
    }
  }

  return serveFile(pathname);
}

// ─── Startup ─────────────────────────────────────────────────────────────────

function findPort(from: number): number {
  for (let port = from; port < from + 50; port++) {
    try { const l = Deno.listen({ port }); l.close(); return port; }
    catch { /* in use */ }
  }
  throw new Error(`No free port found near ${from}`);
}

// Ensure config dir exists
await Deno.mkdir(CONFDIR, { recursive: true });
try { await Deno.stat(CONFILE); } catch { await writeConfig({ projectDir: null, exportDir: null }); }

// Start TTS server subprocess
const ttsPort = findPort(7800);
TTS_PORT = ttsPort;

const ttsProc = new Deno.Command(Deno.execPath(), {
  args: [
    "run",
    "--allow-read", "--allow-net", "--allow-sys",
    "--allow-ffi", "--allow-env", "--allow-write",
    "--node-modules-dir=none",
    `${EXTRA}/pocket-tts-deno/server.ts`,
    "--port", String(ttsPort),
  ],
  cwd: `${EXTRA}/pocket-tts-deno`,
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

// Wait for TTS server, then re-register any stored custom voices
console.log("  Starting TTS server…");
try {
  await waitForTtsServer(ttsPort);
  const { projectDir: startupPd } = await readConfig();
  if (startupPd) await registerStoredVoices(ttsPort, `${startupPd}/_voices`);
  console.log(`  tts server  →  http://localhost:${ttsPort}`);
} catch (e) {
  console.error(`  Warning: TTS server failed to start: ${(e as Error).message}`);
}

// Check ffmpeg availability
try {
  const check = await new Deno.Command("ffmpeg", { args: ["-version"], stdout: "null", stderr: "null" }).output();
  FFMPEG_AVAILABLE = check.success;
} catch { /* ffmpeg not found */ }
if (!FFMPEG_AVAILABLE) {
  console.error("  [WARN] ffmpeg not found — course audio export will be unavailable.");
  console.error("         Install ffmpeg and restart to enable this feature.\n");
} else {
  console.log("  ffmpeg  →  available");
}

// Shut down TTS server when the main process exits
globalThis.addEventListener("unload", () => {
  try { ttsProc.kill("SIGTERM"); } catch { /* ignore */ }
});

const port = findPort(7700);
console.log(`\n  useful  →  http://localhost:${port}`);
console.log(`  config  →  ${CONFDIR}\n`);
Deno.serve({ port }, handle);
