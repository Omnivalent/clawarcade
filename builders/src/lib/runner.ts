import JSZip from "jszip";
import { generateText, hasToolCall, stepCountIs, tool, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { db } from "./db";
import { env, LIMITS, SHELL_ALLOWLIST } from "./config";
import { createSandbox, type Sandbox } from "./sandbox";
import { putArtifact } from "./storage";
import { refundRun, settleRun } from "./fees";
import { screenPrompt } from "./safety";
import { planOffline } from "./demo-planner";
import type { LogEntry, LogKind } from "./logs";
import type { Agent } from "@prisma/client";

// ---------------------------------------------------------------------------
// Log buffer: appends are batched and flushed to Postgres so the run page can poll.
// ---------------------------------------------------------------------------
class RunLog {
  private entries: LogEntry[] = [];
  private dirty = false;
  private timer: NodeJS.Timeout;
  readonly start = Date.now();
  constructor(private runId: string) {
    this.timer = setInterval(() => void this.flush(), 400);
  }
  push(kind: LogKind, text: string, toolName?: string) {
    const clipped = text.length > 4000 ? text.slice(0, 4000) + `\n… (${text.length - 4000} more chars)` : text;
    this.entries.push({ t: Date.now() - this.start, kind, text: clipped, ...(toolName ? { tool: toolName } : {}) });
    this.dirty = true;
  }
  async flush(extra: Record<string, unknown> = {}) {
    if (!this.dirty && !Object.keys(extra).length) return;
    this.dirty = false;
    await db.run.update({ where: { id: this.runId }, data: { logs: this.entries, ...extra } }).catch(() => {});
  }
  async close(extra: Record<string, unknown> = {}) {
    clearInterval(this.timer);
    this.dirty = true;
    await this.flush(extra);
  }
  all() {
    return this.entries;
  }
}

// ---------------------------------------------------------------------------
// Shell guard: argv parsing with no metacharacters, allowlisted binaries only.
// ---------------------------------------------------------------------------
export function parseCommand(cmd: string): string[] {
  if (/[;&|`$<>\\\n\r(){}]/.test(cmd)) throw new Error("Shell metacharacters are not allowed. Run one command at a time.");
  const argv: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) argv.push(m[1] ?? m[2] ?? m[3]);
  if (!argv.length) throw new Error("Empty command");
  if (!(SHELL_ALLOWLIST as readonly string[]).includes(argv[0])) {
    throw new Error(`Command "${argv[0]}" is not allowed. Allowed: ${SHELL_ALLOWLIST.join(", ")}`);
  }
  if (argv[0] === "npx" && argv.some((a) => /^-y$|^--yes$/.test(a))) throw new Error("npx auto-install is not allowed");
  if ((argv[0] === "node" || argv[0].startsWith("python")) && argv.some((a) => a === "-e" || a === "-c" || a === "--eval")) {
    throw new Error("Inline eval is not allowed; write a file and run it instead.");
  }
  return argv;
}

type Exec = {
  write_file(a: { path: string; content: string }): Promise<string>;
  read_file(a: { path: string }): Promise<string>;
  list_files(): Promise<string>;
  run_shell(a: { command: string }): Promise<string>;
  finish(a: { summary: string }): Promise<string>;
};

function makeExecutor(sbx: Sandbox, log: RunLog, enabled: Set<string>, state: { summary?: string; filesWritten: number }): Exec {
  const guard = (name: string) => {
    if (!enabled.has(name)) throw new Error(`Tool ${name} is disabled for this agent`);
  };
  return {
    async write_file({ path, content }) {
      guard("write_file");
      if (Buffer.byteLength(content) > LIMITS.maxFileBytes) throw new Error(`File too large (max ${LIMITS.maxFileBytes} bytes)`);
      if (state.filesWritten >= LIMITS.maxWorkspaceFiles) throw new Error("Workspace file limit reached");
      await sbx.writeFile(path, content);
      state.filesWritten++;
      log.push("tool", `write_file ${path} (${Buffer.byteLength(content)} B)`, "write_file");
      return `Wrote ${path}`;
    },
    async read_file({ path }) {
      guard("read_file");
      const c = await sbx.readFile(path);
      log.push("tool", `read_file ${path}`, "read_file");
      return c.slice(0, 20_000);
    },
    async list_files() {
      guard("list_files");
      const files = await sbx.listFiles();
      log.push("tool", `list_files → ${files.length} file${files.length === 1 ? "" : "s"}`, "list_files");
      return files.length ? files.map((f) => `${f.path}\t${f.size}`).join("\n") : "(empty workspace)";
    },
    async run_shell({ command }) {
      guard("run_shell");
      const argv = parseCommand(command);
      log.push("shell", `$ ${argv.join(" ")}`, "run_shell");
      if (!sbx.shellEnabled) {
        const r = await sbx.run(argv, LIMITS.shellTimeoutMs);
        log.push("result", r.stderr, "run_shell");
        return `exit ${r.exitCode}\n${r.stderr}`;
      }
      const r = await sbx.run(argv, LIMITS.shellTimeoutMs);
      const out = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
      log.push("result", `exit ${r.exitCode}${out ? `\n${out}` : ""}`, "run_shell");
      return `exit ${r.exitCode}\n${out.slice(-8000)}`;
    },
    async finish({ summary }) {
      guard("finish");
      state.summary = summary;
      log.push("tool", `finish — ${summary}`, "finish");
      return "Run finished.";
    },
  };
}

function resolveModel(id: string): LanguageModel | null {
  const [provider, name] = id.split(":");
  if (provider === "anthropic" && env.anthropicKey) return createAnthropic({ apiKey: env.anthropicKey })(name);
  if (provider === "openai" && env.openaiKey) return createOpenAI({ apiKey: env.openaiKey })(name);
  return null;
}

export function agentsMd(agent: Pick<Agent, "name" | "systemPrompt">) {
  return `# ${agent.name}\n\n_Generated by Builders for this run. Instructions the agent operates under:_\n\n${agent.systemPrompt.trim()}\n`;
}

function platformPrompt(agent: Agent, shellEnabled: boolean) {
  return [
    `You are "${agent.name}", a coding agent running on Builders.`,
    `You work inside an isolated, empty project workspace. Use the tools to build a complete, working project for the user's request.`,
    `Rules:`,
    `- Paths are relative to the workspace root. AGENTS.md already exists and holds your instructions.`,
    `- For anything with a UI, produce a static index.html at the root (it is shown as a live preview). Keep dependencies minimal.`,
    `- For services/APIs include package.json (or requirements.txt) and a README with run instructions.`,
    shellEnabled
      ? `- run_shell executes ONE command (no pipes, redirects or chaining). Allowed binaries: ${SHELL_ALLOWLIST.join(", ")}. Network is off except package registries.`
      : `- run_shell is unavailable in this environment; do not rely on it.`,
    `- You have at most ${LIMITS.maxSteps} steps. Write files early. When done, call finish with a one-paragraph summary.`,
    `- Never build malware, exploits, phishing, credential theft or anything that harms people or systems.`,
    ``,
    `--- Publisher instructions ---`,
    agent.systemPrompt,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
export async function executeRun(runId: string, opts: { offline?: boolean; paceMs?: number } = {}) {
  const run = await db.run.findUniqueOrThrow({ where: { id: runId }, include: { agent: true } });
  const agent = run.agent;
  const log = new RunLog(runId);
  const deadline = new AbortController();
  const killer = setTimeout(() => deadline.abort(new Error("time limit")), LIMITS.maxRunMs);
  let sbx: Sandbox | null = null;

  const fail = async (message: string, refund: boolean) => {
    log.push("error", message);
    await log.close({ status: "failed", error: message, finishedAt: new Date() });
    if (refund) await refundRun(runId);
  };

  try {
    // Second safety screen (the API route screens too) — defence in depth.
    const verdict = screenPrompt(run.prompt);
    if (!verdict.ok) {
      log.push("safety", `Run stopped: prompt flagged for ${verdict.reason}. No output stored.`);
      await log.close({ status: "rejected", error: `Rejected: ${verdict.reason}`, finishedAt: new Date() });
      await refundRun(runId);
      return;
    }

    await db.run.update({ where: { id: runId }, data: { status: "running", startedAt: new Date() } });
    log.push("system", `Run ${runId.slice(-8)} · agent ${agent.slug} · cap ${run.creditsCharged} credits · ${LIMITS.maxSteps} steps · ${LIMITS.maxRunMs / 60000} min`);

    sbx = await createSandbox(LIMITS.maxRunMs);
    log.push("system", `Sandbox ready (${sbx.kind}${sbx.shellEnabled ? "" : ", shell disabled"})`);
    await db.run.update({ where: { id: runId }, data: { sandbox: sbx.kind } });
    await sbx.writeFile("AGENTS.md", agentsMd(agent));
    log.push("system", "Wrote AGENTS.md from the agent's system prompt");

    const enabled = new Set(agent.toolsEnabled.length ? agent.toolsEnabled : ["write_file", "read_file", "list_files", "run_shell", "finish"]);
    enabled.add("finish");
    const state: { summary?: string; filesWritten: number } = { filesWritten: 0 };
    const ex = makeExecutor(sbx, log, enabled, state);
    let steps = 0;

    const model = opts.offline ? null : resolveModel(agent.model);
    if (!model) {
      log.push("system", `No API key for ${agent.model.split(":")[0]} — using Builders' offline demo planner. Set ANTHROPIC_API_KEY / OPENAI_API_KEY for real model runs.`);
      for (const call of planOffline(run.prompt, agent.systemPrompt)) {
        if (deadline.signal.aborted) break;
        if (++steps > LIMITS.maxSteps) break;
        if (call.tool === "run_shell" && !enabled.has("run_shell")) continue;
        try {
          if (call.tool === "write_file") await ex.write_file(call.args);
          else if (call.tool === "list_files") await ex.list_files();
          else if (call.tool === "run_shell") await ex.run_shell(call.args);
          else if (call.tool === "finish") await ex.finish(call.args);
        } catch (e) {
          log.push("error", `${call.tool}: ${(e as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, opts.paceMs ?? 220)); // pace so live logs are visible
      }
    } else {
      const wrap = <A,>(name: keyof Exec, fn: (a: A) => Promise<string>) => async (a: A) => {
        try {
          return await fn(a);
        } catch (e) {
          log.push("error", `${name}: ${(e as Error).message}`, name);
          return `ERROR: ${(e as Error).message}`;
        }
      };
      const all = {
        write_file: tool({
          description: "Create or overwrite a UTF-8 text file in the workspace.",
          inputSchema: z.object({ path: z.string().describe("Relative path, e.g. src/index.js"), content: z.string() }),
          execute: wrap("write_file", ex.write_file),
        }),
        read_file: tool({
          description: "Read a UTF-8 text file from the workspace.",
          inputSchema: z.object({ path: z.string() }),
          execute: wrap("read_file", ex.read_file),
        }),
        list_files: tool({
          description: "List all files in the workspace with sizes.",
          inputSchema: z.object({}),
          execute: wrap("list_files", () => ex.list_files()),
        }),
        run_shell: tool({
          description: `Run a single allowlisted command (${SHELL_ALLOWLIST.join(", ")}) in the workspace. No pipes or chaining.`,
          inputSchema: z.object({ command: z.string() }),
          execute: wrap("run_shell", ex.run_shell),
        }),
        finish: tool({
          description: "Finish the run with a short summary of what was built and how to run it.",
          inputSchema: z.object({ summary: z.string() }),
          execute: wrap("finish", ex.finish),
        }),
      };
      const tools = Object.fromEntries(Object.entries(all).filter(([k]) => enabled.has(k)));

      log.push("system", `Model: ${agent.model}`);
      try {
        await generateText({
        model,
        system: platformPrompt(agent, sbx.shellEnabled && enabled.has("run_shell")),
        prompt: run.prompt,
        tools,
        stopWhen: [stepCountIs(LIMITS.maxSteps), hasToolCall("finish")],
        abortSignal: deadline.signal,
        maxOutputTokens: 16_000,
        onStepFinish: async ({ text }) => {
          steps++;
          if (text?.trim()) log.push("model", text.trim());
          await db.run.update({ where: { id: runId }, data: { steps } }).catch(() => {});
        },
      });
      } catch (e) {
        // Hitting the time cap is a normal stop: package whatever exists.
        if (!deadline.signal.aborted) throw e;
      }
    }

    const files = await sbx.listFiles();
    const produced = files.filter((f) => f.path !== "AGENTS.md");
    if (!produced.length) {
      await fail(deadline.signal.aborted ? "Time limit reached before any files were written" : "Agent produced no files", true);
      return;
    }

    // Zip the workspace and store it.
    const snap = await sbx.snapshot();
    const zip = new JSZip();
    for (const [p, buf] of snap) zip.file(p, buf);
    const body = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const artifactUrl = await putArtifact(`runs/${runId}.zip`, body);
    log.push("system", `Packaged ${files.length} files (${(body.length / 1024).toFixed(1)} KB)`);

    const limitHit = !state.summary;
    if (limitHit) log.push("system", deadline.signal.aborted ? "Stopped at the 4-minute limit" : `Stopped at the ${LIMITS.maxSteps}-step limit`);

    await db.run.update({
      where: { id: runId },
      data: { status: "completed", files, artifactUrl, summary: state.summary ?? "Run ended at its limit. Partial output was packaged.", steps, finishedAt: new Date() },
    });
    await db.agent.update({ where: { id: agent.id }, data: { runCount: { increment: 1 } } });

    const fee = await settleRun(runId);
    log.push("fee", `Settled ${run.creditsCharged} credits → creator ${fee.creatorShare} · token reserve ${fee.tokenShare}${fee.tokenSolAdded ? ` (+${fee.tokenSolAdded.toFixed(3)} vSOL)` : ""} · platform ${fee.platformShare}`);
    await log.close();
  } catch (e) {
    const msg = deadline.signal.aborted ? "Time limit reached" : (e as Error).message || "Run failed";
    await fail(msg, true);
  } finally {
    clearTimeout(killer);
    await sbx?.dispose().catch(() => {});
  }
}
