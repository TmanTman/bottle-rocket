/**
 * Wire format shared by the browser and the /api/chat endpoint.
 * The conversation history is the raw Claude message list; the client only round-trips it.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Rocket } from "../rockets/types";

export type ChatMessage = Anthropic.Beta.BetaMessageParam;

export interface ChatRequest {
  /** The new user message. */
  message: string;
  /** Prior turns exactly as returned by the last `done` event. Empty on the first turn. */
  messages: ChatMessage[];
  /** The rocket currently loaded in the UI, preset or custom. Lets the agent edit it. */
  rocket: Rocket | null;
}

export interface ChatResponse {
  /** All assistant text for this turn, joined. */
  reply: string;
  /** Full updated history to send back next turn. */
  messages: ChatMessage[];
  /** Set when the agent created or edited the custom rocket during this turn. */
  rocket: Rocket | null;
}

export interface ChatError {
  error: string;
}

/**
 * /api/chat responds with Server-Sent Events, one JSON-encoded ChatEvent per `data:` line.
 * Pre-stream failures (missing key, bad body) come back as a plain JSON ChatError instead.
 */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "start" | "ok" | "error" }
  | { type: "rocket"; rocket: Rocket }
  | { type: "done"; response: ChatResponse }
  | { type: "error"; error: string };
