import { z } from "zod";
import { db } from "@/lib/db";
import { newNonce } from "@/lib/auth";
import { env } from "@/lib/config";
import { handle, json } from "@/lib/http";

export const POST = handle(async (req: Request) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(await req.json());
  const nonce = newNonce();
  await db.authChallenge.create({ data: { kind: "email", subject: email, nonce, expiresAt: new Date(Date.now() + 15 * 60_000) } });
  const link = `${env.appUrl}/api/auth/email/verify?token=${nonce}`;
  // No mail provider is wired in the MVP: the link is logged server-side, and in
  // DEV_MODE it is also returned so the local demo works without SMTP.
  console.log(`[buildera] magic link for ${email}: ${link}`);
  return json({ sent: true, ...(env.devMode ? { devLink: link } : {}) });
});
