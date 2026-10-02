import "server-only";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { AuthorityType, createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority } from "@solana/spl-token";
import { env, TOKEN } from "./config";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export function explorerUrl(kind: "address" | "tx", id: string) {
  return `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
}

function platformKeypair(): Keypair | null {
  if (!env.platformKeypair) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.platformKeypair)));
  } catch {
    throw new Error("PLATFORM_KEYPAIR must be a JSON array secret key");
  }
}

export function platformAddress(): string | null {
  return platformKeypair()?.publicKey.toBase58() ?? null;
}

/** Hard guard: refuse to talk to anything but devnet. */
async function devnetConnection() {
  if (/mainnet/i.test(env.solanaRpc)) throw new Error("Refusing to use a mainnet RPC. Buildera is devnet-only.");
  const conn = new Connection(env.solanaRpc, "confirmed");
  const genesis = await conn.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) throw new Error("SOLANA_RPC is not Solana devnet. Buildera is devnet-only.");
  return conn;
}

export type MintResult = { mint: string; onChain: boolean; launchTx?: string; vault?: string; note?: string };

/**
 * Platform-owned launch: create an SPL mint (6 decimals), mint the fixed supply to the
 * platform vault, then revoke mint authority so supply is permanently fixed. Metadata
 * is served by Buildera at /api/tokens/[mint]/metadata.
 * Without PLATFORM_KEYPAIR the launch is simulated with a placeholder address.
 */
export async function createAgentMint(): Promise<MintResult> {
  const payer = platformKeypair();
  if (!payer) {
    return {
      mint: Keypair.generate().publicKey.toBase58(),
      onChain: false,
      note: "PLATFORM_KEYPAIR not configured — simulated mint address, not on chain.",
    };
  }
  const conn = await devnetConnection();
  const bal = await conn.getBalance(payer.publicKey);
  if (bal < 0.05 * LAMPORTS_PER_SOL) {
    throw new Error(`Platform wallet ${payer.publicKey.toBase58()} needs devnet SOL (has ${bal / LAMPORTS_PER_SOL}). Run: solana airdrop 2 ${payer.publicKey.toBase58()} --url devnet`);
  }
  const mint = await createMint(conn, payer, payer.publicKey, null, TOKEN.decimals);
  const vault = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  const raw = BigInt(TOKEN.supply) * 10n ** BigInt(TOKEN.decimals);
  await mintTo(conn, payer, mint, vault.address, payer, raw);
  const launchTx = await setAuthority(conn, payer, mint, payer, AuthorityType.MintTokens, null);
  return { mint: mint.toBase58(), onChain: true, launchTx, vault: vault.address.toBase58() };
}

/** Verify a devnet SOL transfer from `wallet` to the platform vault. Returns lamports received. */
export async function verifyDeposit(signature: string, wallet: string): Promise<bigint> {
  const payer = platformKeypair();
  if (!payer) throw new Error("Deposits are disabled: PLATFORM_KEYPAIR not configured");
  const conn = await devnetConnection();
  const tx = await conn.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx || tx.meta?.err) throw new Error("Transaction not found or failed");
  let lamports = 0n;
  for (const ix of tx.transaction.message.instructions) {
    if (!("parsed" in ix) || ix.programId.toBase58() !== SystemProgram.programId.toBase58()) continue;
    const p = ix.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } };
    if (p.type === "transfer" && p.info?.source === wallet && p.info?.destination === payer.publicKey.toBase58()) {
      lamports += BigInt(p.info.lamports ?? 0);
    }
  }
  if (lamports === 0n) throw new Error("No transfer from your wallet to the Buildera vault in that transaction");
  return lamports;
}

export { PublicKey };
