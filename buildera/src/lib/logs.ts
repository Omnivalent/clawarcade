export type LogKind = "system" | "model" | "tool" | "result" | "shell" | "error" | "safety" | "fee";

export type LogEntry = {
  t: number; // ms since run start
  kind: LogKind;
  text: string;
  tool?: string;
};
