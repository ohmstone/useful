// useful — instructional course builder
// Run: deno run --allow-net --allow-read --allow-write --allow-env=HOME --allow-run app.ts [--config <path>]

// ─── Paths ───────────────────────────────────────────────────────────────────

const BASE = import.meta.dirname!;

const cfgFlagIdx = Deno.args.indexOf("--config");
const CONFDIR = (cfgFlagIdx >= 0 && Deno.args[cfgFlagIdx + 1])
  ? Deno.args[cfgFlagIdx + 1]
  : `${BASE}/.config`;

const CONFILE = `${CONFDIR}/config.json`;
const STATIC  = `${BASE}/core`;
const TTS     = `${BASE}/core/tts`;

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

// ─── Courses ─────────────────────────────────────────────────────────────────

async function listCourses(dir: string): Promise<Course[]> {
  const courses: Course[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isDirectory) continue;
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

// Parse WAV header to get duration in seconds
async function wavDuration(path: string): Promise<number> {
  try {
    const f = await Deno.open(path, { read: true });
    const buf = new Uint8Array(44);
    await f.read(buf);
    f.close();
    const view = new DataView(buf.buffer);
    const byteRate = view.getUint32(28, true);
    const dataSize = view.getUint32(40, true);
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
  // Split path into segments for parametric routes
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
    if (!name || !/^[\w\s\-]+$/.test(name)) {
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

  // ── Modules  GET|POST /api/modules/:course ───────────────────────────────

  if (seg[0] === "api" && seg[1] === "modules" && seg.length === 3) {
    const course = decodeURIComponent(seg[2]);
    const { projectDir: pd } = await readConfig();
    if (!pd) return Response.json({ error: "No project directory" }, { status: 400 });

    if (method === "GET") {
      return Response.json(await readModules(pd, course));
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
    const [,,, rawC, rawM] = seg;
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

    // POST /api/audio/:course/:module — generate audio via TTS
    if (seg.length === 4 && method === "POST") {
      const { text } = await req.json() as { text?: string };
      if (!text?.trim()) return Response.json({ error: "text required" }, { status: 400 });
      const file = `${Date.now()}.wav`;
      const wavPath = `${aDir}/${file}`;
      await Deno.mkdir(aDir, { recursive: true });
      try {
        const proc = new Deno.Command(TTS, {
          args: ["-wav", wavPath, text.trim()],
          cwd: `${BASE}/core`,
        });
        const { success } = await proc.output();
        if (!success) throw new Error("TTS exited with error");
        const duration = await wavDuration(wavPath);
        const meta: AudioMeta = { text: text.trim(), duration };
        await Deno.writeTextFile(`${aDir}/${file.replace(/\.wav$/, ".meta.json")}`, JSON.stringify(meta, null, 2));
        return Response.json({ file, text: text.trim(), duration }, { status: 201 });
      } catch (e) {
        await Deno.remove(wavPath).catch(() => {});
        return Response.json({ error: String(e) }, { status: 500 });
      }
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

await Deno.mkdir(CONFDIR, { recursive: true });
try { await Deno.stat(CONFILE); } catch { await writeConfig({ projectDir: null }); }

const port = findPort(7700);
console.log(`\n  useful  →  http://localhost:${port}`);
console.log(`  config  →  ${CONFDIR}\n`);
Deno.serve({ port }, handle);
