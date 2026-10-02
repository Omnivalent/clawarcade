import { Sandbox as E2B } from "e2b";
import { IGNORED_DIRS, normalizeRel, type Sandbox } from "./types";

const ROOT = "/home/user/workspace";

/** Remote microVM sandbox (E2B). One per run, hard timeout, no host access. */
export class E2BSandbox implements Sandbox {
  readonly kind = "e2b" as const;
  readonly shellEnabled = true;
  private constructor(private sbx: E2B) {}

  static async create(timeoutMs: number) {
    const sbx = await E2B.create({ apiKey: process.env.E2B_API_KEY, timeoutMs: timeoutMs + 60_000 });
    await sbx.files.makeDir(ROOT);
    return new E2BSandbox(sbx);
  }

  private abs(rel: string) {
    return `${ROOT}/${normalizeRel(rel)}`;
  }

  async writeFile(rel: string, content: string) {
    await this.sbx.files.write(this.abs(rel), content);
  }

  async readFile(rel: string) {
    return this.sbx.files.read(this.abs(rel));
  }

  async listFiles() {
    const out: { path: string; size: number }[] = [];
    const walk = async (dir: string, prefix: string) => {
      for (const ent of await this.sbx.files.list(dir)) {
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        if (ent.type === "dir") {
          if (!IGNORED_DIRS.has(ent.name)) await walk(`${dir}/${ent.name}`, rel);
        } else {
          out.push({ path: rel, size: (ent as { size?: number }).size ?? 0 });
        }
      }
    };
    await walk(ROOT, "");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async run(argv: string[], timeoutMs: number) {
    const quoted = argv.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
    try {
      const r = await this.sbx.commands.run(quoted, { cwd: ROOT, timeoutMs });
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    } catch (e) {
      const err = e as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      return { exitCode: err.exitCode ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? String(e) };
    }
  }

  async snapshot() {
    const map = new Map<string, Buffer>();
    for (const f of await this.listFiles()) {
      const bytes = await this.sbx.files.read(`${ROOT}/${f.path}`, { format: "bytes" });
      map.set(f.path, Buffer.from(bytes));
    }
    return map;
  }

  async dispose() {
    await this.sbx.kill().catch(() => {});
  }
}
