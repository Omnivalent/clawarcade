import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

// Artifacts are stored by key. S3-compatible storage when S3_BUCKET is set,
// otherwise ./data/artifacts on local disk. Downloads always stream through our
// API route, so the bucket can stay private.

const DATA_DIR = path.join(process.cwd(), "data", "artifacts");

function s3() {
  if (!process.env.S3_BUCKET) return null;
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" }
      : undefined,
  });
}

function safeKey(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("bad storage key");
  return key;
}

export async function putArtifact(key: string, body: Buffer) {
  key = safeKey(key);
  const client = s3();
  if (client) {
    await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: body, ContentType: "application/zip" }));
    return `s3://${process.env.S3_BUCKET}/${key}`;
  }
  const file = path.join(DATA_DIR, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  return `local://${key}`;
}

export async function getArtifact(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("local://")) return await readFile(path.join(DATA_DIR, safeKey(url.slice(8))));
    if (url.startsWith("s3://")) {
      const client = s3();
      if (!client) return null;
      const [, , bucket, ...rest] = url.split("/");
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: rest.join("/") }));
      const bytes = await out.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    }
  } catch {
    return null;
  }
  return null;
}
