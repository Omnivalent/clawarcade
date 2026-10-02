import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./auth";

export function json(data: unknown, init?: number | ResponseInit) {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const opts: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return new NextResponse(body, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof ZodError) return json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
      console.error(e);
      return json({ error: "Internal error" }, 500);
    }
  };
}
