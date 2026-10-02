// Central limits and economics. Server-side only values live in `env` below.

export const LIMITS = {
  maxSteps: 25,
  maxRunMs: 4 * 60 * 1000,
  shellTimeoutMs: 60 * 1000,
  maxPriceCredits: 500,
  minPriceCredits: 1,
  maxFileBytes: 512 * 1024,
  maxWorkspaceFiles: 400,
  maxPromptChars: 4000,
  maxSystemPromptChars: 8000,
  maxConcurrentRunsPerUser: 2,
} as const;

/** Fee split in basis points (sum = 10_000). */
export const FEE_SPLIT = { creatorBps: 7000, tokenBps: 2000, platformBps: 1000 } as const;

export const ECONOMICS = {
  /** Credits granted per 1 devnet SOL deposited. */
  creditsPerSol: 1000,
  /** Simulated SOL value of one credit when routed to a token's virtual reserve. */
  solPerCredit: 0.001,
  faucetCredits: 200,
  faucetSimSol: 2,
  signupCredits: 100,
} as const;

export const TOKEN = {
  decimals: 6,
  supply: 1_000_000_000,
  initialVirtualSol: 10,
  creatorFeeBps: 100,
} as const;

export const SHELL_ALLOWLIST = ["npm", "node", "npx", "python", "python3", "pytest"] as const;
export const NETWORK_ALLOWLIST = ["registry.npmjs.org", "pypi.org", "files.pythonhosted.org"] as const;

export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  sessionSecret: process.env.SESSION_SECRET ?? "",
  devMode: process.env.DEV_MODE === "true",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  e2bKey: process.env.E2B_API_KEY ?? "",
  sandboxDriver: process.env.SANDBOX_DRIVER ?? "",
  solanaRpc: process.env.SOLANA_RPC || "https://api.devnet.solana.com",
  platformKeypair: process.env.PLATFORM_KEYPAIR ?? "",
};
