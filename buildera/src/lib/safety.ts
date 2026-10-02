// Lightweight, conservative prompt screen. Rejects requests for malware, exploits and
// credential theft before any sandbox or model is touched. Not a substitute for
// provider-side moderation, but it's a hard gate for the MVP.

const PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(ransomware|keylogger|key[- ]?logger|rootkit|botnet|cryptojack\w*|trojan|spyware|stealer|rat\s+(payload|malware))\b/i, reason: "malware" },
  { re: /\bmalware|malicious\s+(payload|code|script|software)\b/i, reason: "malware" },
  { re: /\b(write|build|create|make|develop|generate)\b[^.]{0,40}\b(virus|worm|backdoor|dropper|payload)\b/i, reason: "malware" },
  { re: /\b(exploit|0[- ]?day|zero[- ]?day|rce\b|remote code execution|privilege escalation|buffer overflow)\b[^.]{0,60}\b(for|against|in|on|target|cve|unpatched|server|system)\b/i, reason: "exploit" },
  { re: /\bcve-\d{4}-\d{3,}\b[^.]{0,60}\b(exploit|poc|weaponi[sz]e|payload)\b/i, reason: "exploit" },
  { re: /\b(sql injection|xss|csrf)\b[^.]{0,40}\b(attack|exploit|payload)s?\b[^.]{0,40}\b(against|target|site|website)\b/i, reason: "exploit" },
  { re: /\b(steal|harvest|exfiltrat\w*|grab|dump|phish\w*|sniff)\b[^.]{0,50}\b(password|credential|cookie|session|token|seed phrase|private key|login|2fa|otp|wallet)s?\b/i, reason: "credential theft" },
  { re: /\b(phishing|credential[- ]harvest\w*|fake login|clone[^.]{0,30}login page)\b/i, reason: "credential theft" },
  { re: /\b(wallet drainer|drainer kit|drain (their|user|victim)s?'? wallets?)\b/i, reason: "credential theft" },
  { re: /\b(ddos|denial[- ]of[- ]service|flood)\b[^.]{0,30}\b(tool|script|attack|bot)\b/i, reason: "attack tooling" },
  { re: /\b(bypass|evade|disable)\b[^.]{0,40}\b(antivirus|edr|av detection|defender|captcha)\b/i, reason: "detection evasion" },
];

export type SafetyVerdict = { ok: true } | { ok: false; reason: string };

export function screenPrompt(text: string): SafetyVerdict {
  const t = text.normalize("NFKC");
  for (const p of PATTERNS) {
    if (p.re.test(t)) return { ok: false, reason: p.reason };
  }
  return { ok: true };
}
