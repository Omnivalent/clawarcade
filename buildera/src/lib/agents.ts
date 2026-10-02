import { z } from "zod";
import { LIMITS } from "./config";
import { isValidModel, TOOL_OPTIONS } from "./models";

export const agentInput = z.object({
  name: z.string().trim().min(2).max(48),
  tagline: z.string().trim().max(90).optional().default(""),
  description: z.string().trim().min(10).max(2000),
  systemPrompt: z.string().trim().min(20).max(LIMITS.maxSystemPromptChars),
  model: z.string().refine(isValidModel, "Unknown model"),
  priceCredits: z.coerce.number().int().min(LIMITS.minPriceCredits).max(LIMITS.maxPriceCredits),
  toolsEnabled: z.array(z.enum(TOOL_OPTIONS.map((t) => t.id) as [string, ...string[]])).min(1).default(TOOL_OPTIONS.map((t) => t.id)),
  imageUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith("https://"), "Image must be an https URL")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  launchToken: z.boolean().optional().default(false),
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "Symbol: 2–8 letters/digits").optional(),
});

export const symbolInput = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "Symbol: 2–8 letters/digits"),
});

export function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "agent";
}

export const ACCENTS = ["#d9ff5a", "#7cf5ff", "#ff9e6b", "#c4a7ff", "#7dffb0", "#ffd166"];
