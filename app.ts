// useful — instructional course builder
// Run: deno run --allow-net --allow-read --allow-write --allow-env=HOME --allow-run app.ts [--config <path>]

// ─── Paths ───────────────────────────────────────────────────────────────────

const BASE = import.meta.dirname!;

const cfgFlagIdx = Deno.args.indexOf("--config");
const CONFDIR = (cfgFlagIdx >= 0 && Deno.args[cfgFlagIdx + 1])
  ? Deno.args[cfgFlagIdx + 1]
  : `${BASE}/.config`;

const CONFILE    = `${CONFDIR}/config.json`;
const STATIC     = `${BASE}/core`;
const EXTRA      = `${BASE}/extra`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface Config { projectDir: string | null; }
interface Course { name: string; contents: string[]; }

interface AudioMeta { text: string; duration: number; }
interface TrackClip { file: string; startTime: number; duration: number; }

// ─── Config ──────────────────────────────────────────────────────────────────

async function readConfig(): Promise<Config> {
  try { return JSON.parse(await Deno.readTextFile(CONFILE)); }
  catch { return { projectDir: null }; }
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

    // GET /api/inject — list .js files
    if (seg.length === 2 && method === "GET") {
      const files: string[] = [];
      try {
        for await (const e of Deno.readDir(injectDir)) {
          if (e.isFile && e.name.endsWith(".js")) files.push(e.name);
        }
        files.sort();
      } catch { /* dir may not exist yet */ }
      return Response.json(files);
    }

    // GET /api/inject/:file — serve a JS file as an ES module
    if (seg.length === 3 && method === "GET") {
      const file = decodeURIComponent(seg[2]);
      if (file.includes("..") || file.includes("/") || !file.endsWith(".js")) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const data = await Deno.readTextFile(`${injectDir}/${file}`);
        return new Response(data, { headers: { "Content-Type": "application/javascript; charset=utf-8" } });
      } catch { return new Response("Not Found", { status: 404 }); }
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
try { await Deno.stat(CONFILE); } catch { await writeConfig({ projectDir: null }); }

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

// Shut down TTS server when the main process exits
globalThis.addEventListener("unload", () => {
  try { ttsProc.kill("SIGTERM"); } catch { /* ignore */ }
});

const port = findPort(7700);
console.log(`\n  useful  →  http://localhost:${port}`);
console.log(`  config  →  ${CONFDIR}\n`);
Deno.serve({ port }, handle);
