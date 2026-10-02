import { env } from "../config";
import { DockerSandbox, dockerAvailable } from "./docker";
import { E2BSandbox } from "./e2b";
import { LocalFsSandbox } from "./local";
import type { Sandbox } from "./types";

export type { Sandbox } from "./types";

export async function createSandbox(timeoutMs: number): Promise<Sandbox> {
  const want = env.sandboxDriver;
  if ((want === "e2b" || !want) && env.e2bKey) return E2BSandbox.create(timeoutMs);
  if ((want === "docker" || !want) && (await dockerAvailable())) return DockerSandbox.create();
  return LocalFsSandbox.create();
}
