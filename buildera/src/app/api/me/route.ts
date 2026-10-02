import { getUser } from "@/lib/auth";
import { json } from "@/lib/http";
import { platformAddress } from "@/lib/solana";
import { ECONOMICS, env } from "@/lib/config";

export async function GET() {
  const u = await getUser();
  return json({
    user: u && { id: u.id, wallet: u.wallet, email: u.email, credits: u.credits, earnedCredits: u.earnedCredits, simSol: u.simSol },
    platform: { vault: platformAddress(), creditsPerSol: ECONOMICS.creditsPerSol, devMode: env.devMode },
  });
}
