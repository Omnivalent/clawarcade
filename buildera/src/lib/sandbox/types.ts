export type ShellResult = { exitCode: number; stdout: string; stderr: string };

export interface Sandbox {
  readonly kind: "e2b" | "docker" | "local";
  readonly shellEnabled: boolean;
  writeFile(rel: string, content: string): Promise<void>;
  readFile(rel: string): Promise<string>;
  listFiles(): Promise<{ path: string; size: number }[]>;
  /** argv form only — never passed through a host shell. */
  run(argv: string[], timeoutMs: number): Promise<ShellResult>;
  /** Snapshot every workspace file (path -> bytes) for zipping. */
  snapshot(): Promise<Map<string, Buffer>>;
  dispose(): Promise<void>;
}

export function normalizeRel(p: string) {
  const cleaned = p.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+/g, "/");
  if (!cleaned || cleaned.split("/").some((seg) => seg === ".." || seg === "") || cleaned.startsWith("/")) {
    throw new Error(`Invalid path: ${p}`);
  }
  if (cleaned.split("/").some((seg) => seg === ".git")) throw new Error("Writing into .git is not allowed");
  return cleaned;
}

export const IGNORED_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv", ".next", "dist/.cache"]);
