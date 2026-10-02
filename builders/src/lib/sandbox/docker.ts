import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LocalFsSandbox } from "./local";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pexec = promisify(execFile);

export async function dockerAvailable() {
  try {
    await pexec("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

const IMAGE = process.env.SANDBOX_DOCKER_IMAGE || "nikolaik/python-nodejs:python3.12-nodejs22-slim";

/**
 * Local Docker fallback. One throwaway container per command, workspace bind-mounted
 * at /workspace, no network, non-root, read-only rootfs, capped CPU/memory/pids.
 * The container never sees anything on the host except the run's temp workspace.
 */
export class DockerSandbox extends LocalFsSandbox {
  override readonly kind = "docker" as const;
  override readonly shellEnabled = true;

  static override async create() {
    const root = await mkdtemp(path.join(os.tmpdir(), "builders-run-"));
    return new DockerSandbox(root);
  }

  override async run(argv: string[], timeoutMs: number) {
    const args = [
      "run", "--rm",
      "--network", process.env.SANDBOX_DOCKER_NETWORK || "none",
      "--read-only", "--tmpfs", "/tmp:rw,size=256m", "--tmpfs", "/root:rw,size=256m",
      "--memory", "1g", "--cpus", "1", "--pids-limit", "256",
      "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
      "-e", "HOME=/tmp", "-e", "npm_config_cache=/tmp/.npm",
      "-v", `${this.root}:/workspace:rw`, "-w", "/workspace",
      IMAGE, ...argv,
    ];
    try {
      const { stdout, stderr } = await pexec("docker", args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
      return { exitCode: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
      return {
        exitCode: typeof err.code === "number" ? err.code : 1,
        stdout: err.stdout ?? "",
        stderr: (err.killed ? "[timeout] " : "") + (err.stderr ?? String(e)),
      };
    }
  }
}
