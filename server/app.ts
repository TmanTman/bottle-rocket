/**
 * HTTP API. Runs in the Vite dev server (via vite.config.ts) and on Cloudflare Workers (server/worker.ts).
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatError, ChatEvent, ChatRequest } from "../src/api/protocol";
import { MODEL, runChatTurn } from "./agent";

type Bindings = { ANTHROPIC_API_KEY?: string };

const KEY_HELP =
  "ANTHROPIC_API_KEY is not set. Put it in .env for `npm run dev`, or run `npx wrangler secret put ANTHROPIC_API_KEY` for deploys.";

function resolveApiKey(env: Bindings | undefined): string | undefined {
  if (env?.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
  if (typeof process !== "undefined" && process.env?.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  return undefined;
}

/** Map SDK failures to something the chat panel can show. */
function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. Try again in a moment.";
  if (err instanceof Anthropic.BadRequestError) return `Bad request to Anthropic: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  console.error(err);
  return err instanceof Error ? err.message : "Unknown server error";
}

export const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ ok: true, model: MODEL, hasKey: Boolean(resolveApiKey(c.env)) }));

/**
 * Streams the turn as Server-Sent Events (one ChatEvent per `data:` line, ending with `done`).
 * Problems we can detect before the model starts are returned as plain JSON errors.
 */
app.post("/api/chat", async (c) => {
  const apiKey = resolveApiKey(c.env);
  if (!apiKey) return c.json<ChatError>({ error: KEY_HELP }, 500);

  const body = (await c.req.json().catch(() => null)) as Partial<ChatRequest> | null;
  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    return c.json<ChatError>({ error: "Body must be JSON with a non-empty `message` string." }, 400);
  }
  const req: ChatRequest = {
    message: body.message.trim(),
    messages: Array.isArray(body.messages) ? body.messages : [],
    rocket: body.rocket && typeof body.rocket === "object" ? body.rocket : null,
  };

  return streamSSE(c, async (stream) => {
    const emit = (event: ChatEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    try {
      const client = new Anthropic({ apiKey });
      const response = await runChatTurn(client, req, emit);
      await emit({ type: "done", response });
    } catch (err) {
      await emit({ type: "error", error: describeError(err) });
    }
  });
});
