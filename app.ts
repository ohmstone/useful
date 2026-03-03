// useful — instructional course builder
// Run: deno run --allow-net --allow-read --allow-write --allow-env=HOME app.ts [--config <path>]

// ─── Paths ───────────────────────────────────────────────────────────────────

const BASE = import.meta.dirname!;

// --config <path> overrides the default config directory
const cfgFlagIdx = Deno.args.indexOf("--config");
const CONFDIR = (cfgFlagIdx >= 0 && Deno.args[cfgFlagIdx + 1])
  ? Deno.args[cfgFlagIdx + 1]
  : `${BASE}/.config`;

const CONFILE = `${CONFDIR}/config.json`;
const STATIC  = `${BASE}/core`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface Config {
  projectDir: string | null;
}

interface Course {
  name: string;
  contents: string[];
}

// ─── Config ──────────────────────────────────────────────────────────────────

async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(await Deno.readTextFile(CONFILE));
  } catch {
    return { projectDir: null };
  }
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
};

async function serveFile(pathname: string): Promise<Response> {
  if (pathname.includes("..")) {
    return new Response("Forbidden", { status: 403 });
  }
  const target = (pathname === "/" || pathname === "")
    ? `${STATIC}/index.html`
    : `${STATIC}${pathname}`;
  const ext = "." + target.split(".").pop()!.toLowerCase();
  try {
    const data = await Deno.readFile(target);
    return new Response(data, {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// ─── Request router ──────────────────────────────────────────────────────────

async function handle(req: Request): Promise<Response> {
  const { pathname, searchParams } = new URL(req.url);
  const method = req.method;

  // GET /api/config
  if (pathname === "/api/config" && method === "GET") {
    return Response.json(await readConfig());
  }

  // POST /api/config  { projectDir: string }
  if (pathname === "/api/config" && method === "POST") {
    const body = await req.json() as { projectDir?: unknown };
    if (typeof body.projectDir !== "string") {
      return Response.json({ error: "projectDir must be a string" }, { status: 400 });
    }
    try {
      if (!(await Deno.stat(body.projectDir)).isDirectory) throw 0;
    } catch {
      return Response.json(
        { error: "Path does not exist or is not a directory" },
        { status: 400 },
      );
    }
    const config = await readConfig();
    config.projectDir = body.projectDir;
    await writeConfig(config);
    return Response.json(config);
  }

  // GET /api/courses
  if (pathname === "/api/courses" && method === "GET") {
    const { projectDir } = await readConfig();
    if (!projectDir) return Response.json([]);
    try {
      return Response.json(await listCourses(projectDir));
    } catch {
      return Response.json({ error: "Cannot read project directory" }, { status: 500 });
    }
  }

  // POST /api/courses  { name: string }
  if (pathname === "/api/courses" && method === "POST") {
    const { projectDir } = await readConfig();
    if (!projectDir) {
      return Response.json({ error: "No project directory configured" }, { status: 400 });
    }
    const body = await req.json() as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || !/^[\w\s\-]+$/.test(name)) {
      return Response.json({ error: "Invalid course name" }, { status: 400 });
    }
    try {
      await Deno.mkdir(`${projectDir}/${name}`);
    } catch {
      return Response.json(
        { error: "Could not create course (may already exist)" },
        { status: 400 },
      );
    }
    return Response.json({ name, contents: [] }, { status: 201 });
  }

  // GET /api/browse?path=  →  { path, entries: { name }[] }
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
    } catch {
      return Response.json({ error: "Cannot read directory" }, { status: 404 });
    }
  }

  // POST /api/mkdir  { parent: string, name: string }  →  { path: string }
  if (pathname === "/api/mkdir" && method === "POST") {
    const body = await req.json() as { parent?: unknown; name?: unknown };
    const parent = typeof body.parent === "string" ? body.parent : "";
    const name   = typeof body.name   === "string" ? body.name.trim() : "";
    if (!parent || !name) {
      return Response.json({ error: "parent and name are required" }, { status: 400 });
    }
    if (/[/\\]/.test(name)) {
      return Response.json({ error: "Name cannot contain path separators" }, { status: 400 });
    }
    const newPath = `${parent}/${name}`;
    try {
      await Deno.mkdir(newPath);
      return Response.json({ path: newPath });
    } catch {
      return Response.json({ error: "Could not create directory (may already exist)" }, { status: 400 });
    }
  }

  return serveFile(pathname);
}

// ─── Startup ─────────────────────────────────────────────────────────────────

function findPort(from: number): number {
  for (let port = from; port < from + 50; port++) {
    try {
      const l = Deno.listen({ port });
      l.close();
      return port;
    } catch { /* port in use */ }
  }
  throw new Error(`No free port found near ${from}`);
}

await Deno.mkdir(CONFDIR, { recursive: true });
try { await Deno.stat(CONFILE); } catch { await writeConfig({ projectDir: null }); }

const port = findPort(7700);
console.log(`\n  useful  →  http://localhost:${port}`);
console.log(`  config  →  ${CONFDIR}\n`);
Deno.serve({ port }, handle);
