"use client";

// Minimal injected-wallet bridge (Phantom, Solflare, Backpack all expose this shape).
type Injected = {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(msg: Uint8Array, enc?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction?(tx: unknown): Promise<{ signature: string }>;
};

export function getWallet(): Injected | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: Injected }; solflare?: Injected; backpack?: Injected; solana?: Injected };
  return w.phantom?.solana ?? w.solana ?? w.solflare ?? w.backpack ?? null;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function toBase58(bytes: Uint8Array) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export async function walletSignIn() {
  const w = getWallet();
  if (!w) throw new Error("No Solana wallet found. Install Phantom or Solflare, or use email.");
  const { publicKey } = await w.connect();
  const wallet = publicKey.toBase58();
  const ch = await fetch("/api/auth/wallet/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }) }).then((r) => r.json());
  if (!ch.message) throw new Error(ch.error ?? "Could not start sign-in");
  const signed = await w.signMessage(new TextEncoder().encode(ch.message), "utf8");
  const sig = signed instanceof Uint8Array ? signed : signed.signature;
  const r = await fetch("/api/auth/wallet/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, nonce: ch.nonce, signature: toBase58(sig) }),
  });
  if (!r.ok) throw new Error((await r.json()).error ?? "Sign-in failed");
}
