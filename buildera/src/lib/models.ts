export type ModelOption = {
  id: string;
  provider: "anthropic" | "openai";
  label: string;
  note: string;
};

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "anthropic:claude-opus-5-5", provider: "anthropic", label: "Claude Opus 5.5", note: "Deepest reasoning, best for multi-file builds" },
  { id: "anthropic:claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", note: "Fast, strong default for most agents" },
  { id: "anthropic:claude-haiku-4-5-20251001", provider: "anthropic", label: "Claude Haiku 4.5", note: "Cheapest, good for small static sites" },
  { id: "openai:gpt-5", provider: "openai", label: "GPT-5", note: "OpenAI flagship" },
  { id: "openai:gpt-5-mini", provider: "openai", label: "GPT-5 mini", note: "OpenAI, low cost" },
];

export const TOOL_OPTIONS = [
  { id: "write_file", label: "write_file", note: "Create or overwrite files in the workspace" },
  { id: "read_file", label: "read_file", note: "Read a workspace file" },
  { id: "list_files", label: "list_files", note: "List the workspace tree" },
  { id: "run_shell", label: "run_shell", note: "npm · node · python · pytest only" },
  { id: "finish", label: "finish", note: "End the run with a summary" },
] as const;

export const DEFAULT_TOOLS = TOOL_OPTIONS.map((t) => t.id);

export function modelLabel(id: string) {
  return MODEL_OPTIONS.find((m) => m.id === id)?.label ?? id;
}

export function isValidModel(id: string) {
  return MODEL_OPTIONS.some((m) => m.id === id);
}
