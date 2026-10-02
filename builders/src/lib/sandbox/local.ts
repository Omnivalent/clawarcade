import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IGNORED_DIRS, normalizeRel, type Sandbox } from "./types";

/**
 * File-only workspace in a private temp dir. Used when neither E2B nor Docker is
 * available. It never executes commands on the host: run_shell is disabled.
 */
export class LocalFsSandbox implements Sandbox {
  readonly kind: Sandbox["kind"] = "local";
  readonly shellEnabled: boolean = false;
  protected constructor(public readonly root: string) {}

  static async create() {
    const root = await mkdtemp(path.join(os.tmpdir(), "builders-run-"));
    return new LocalFsSandbox(root);
  }

  protected abs(rel: string) {
    const p = path.join(this.root, normalizeRel(rel));
    if (!p.startsWith(this.root + path.sep)) throw new Error("Path escapes workspace");
    return p;
  }

  async writeFile(rel: string, content: string) {
    const p = this.abs(rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content, "utf8");
  }

  async readFile(rel: string) {
    return readFile(this.abs(rel), "utf8");
  }

  async listFiles() {
    const out: { path: string; size: number }[] = [];
    const walk = async (dir: string, prefix: string) => {
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        if (ent.isSymbolicLink()) continue;
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          if (!IGNORED_DIRS.has(ent.name)) await walk(path.join(dir, ent.name), rel);
        } else if (ent.isFile()) {
          out.push({ path: rel, size: (await stat(path.join(dir, ent.name))).size });
        }
      }
    };
    await walk(this.root, "");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async run(_argv: string[], _timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return {
      exitCode: 126,
      stdout: "",
      stderr: "run_shell is unavailable: no isolated sandbox configured (set E2B_API_KEY or run a Docker daemon).",
    };
  }

  async snapshot() {
    const map = new Map<string, Buffer>();
    for (const f of await this.listFiles()) map.set(f.path, await readFile(path.join(this.root, f.path)));
    return map;
  }

  async dispose() {
    await rm(this.root, { recursive: true, force: true });
  }
}
