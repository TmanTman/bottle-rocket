/**
 * The rocket-design agent: one Claude conversation turn, running tool calls until it answers.
 * Stateless: the browser round-trips the message history.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Rocket } from "../src/rockets/types";
import type { ChatEvent, ChatMessage, ChatRequest, ChatResponse } from "../src/api/protocol";
import { BOTTLE, TAPE_MASS } from "../src/rockets/parts";
import { LIMITS } from "../src/rockets/validate";
import { executeTool, tools, REFERENCE_LAUNCH } from "./rocketTools";

export const MODEL = "claude-opus-5";
const MAX_TOOL_ROUNDS = 8;

const SYSTEM_PROMPT = `You are the rocket designer inside a browser-based 3D water-rocket simulator. You chat with the user and build or edit their custom rocket by calling set_rocket. Whatever you set appears immediately in the 3D scene, and the user launches it with sliders for pressure, water fill and launch angle.

## What a rocket is made of
Every part is a standard 2L PET soda bottle (${(BOTTLE.height * 100).toFixed(0)} cm tall, ${(BOTTLE.radius * 200).toFixed(0)} mm diameter, ${(BOTTLE.mass * 1000).toFixed(0)} g empty, ${BOTTLE.volume * 1000} L), fins cut from bottle sides, or a stage coupling. Parts are taped together; each join adds ${TAPE_MASS * 1000} g. Parts are listed bottom (nozzle) to top (nose).

Bottle cuts:
- full: untouched bottle. The only cut that can be a chamber (holds water and pressurised air). Chambers point neck-down; the neck is the ${(BOTTLE.neckRadius * 2000).toFixed(1)} mm nozzle.
- top-half: neck and shoulder, about 45% of the height. Point it neck-up on top as a nose cone. It cuts drag a lot (Cd 0.75 without a nose, 0.35 with one).
- body-tube: straight middle section, half height, light. A spacer or a longer body.
- bottom-half: base cup, half height. A blunt cap or a shroud around the nozzle end.

Roles: chamber (full bottles only), nose (topmost bottle, neck up), structure (spacer). Fins ({ kind: "fins", count, span, height }) sit on the bottle listed just before them; count ${LIMITS.fins.count[0]}..${LIMITS.fins.count[1]}, span ${LIMITS.fins.span[0]}..${LIMITS.fins.span[1]} m, height ${LIMITS.fins.height[0]}..${LIMITS.fins.height[1]} m. Typical fins are 3 or 4, span 0.06 to 0.08 m, height 0.12 to 0.15 m.

Staging:
- A coupling ({ kind: "coupling", release: "booster-empty", delaySeconds? }) splits the stack into stages. Everything below it is the lower stage; everything above it is the next stage.
- Multiple couplings are allowed, so you can build two-stage, three-stage or other multi-stage rockets within the parts limit.
- delaySeconds is optional, ${LIMITS.coupling.delaySeconds[0]}..${LIMITS.coupling.delaySeconds[1]} s. A small delay like 0.05-0.15 s lets the booster coast briefly before release.
- Each stage must start with its own full-bottle chamber as that stage's nozzle. The sustainer stage fires after the booster burns out and separates.

Hard rules (set_rocket rejects anything else and tells you why):
- parts[0] is the nozzle end: a full-bottle chamber. The first part after every coupling must also be a full-bottle chamber.
- Couplings must be between stages, not first, last or adjacent to another coupling.
- Only one nose, and nothing above it.
- At most ${LIMITS.maxParts} parts. Tape joins are derived for you.

## Physics intuition
Thrust comes from air pushing water out of the neck; it lasts a few tenths of a second. Then the rocket coasts against gravity and drag. More chambers mean more stored energy but more dry mass; a nose cone halves the drag; big fins add mass and a little drag but keep it stable (the sim assumes fins keep it pointed along its velocity). Staging drops empty booster mass and lights the next stage from altitude, but the lower stage must lift sealed upper-stage water at first; a two-bottle booster often works better than a tiny booster. About 30-40% water is the usual sweet spot. Reference results at ${REFERENCE_LAUNCH.pressureBar} bar, ${REFERENCE_LAUNCH.waterFill * 100}% water: a bare single bottle reaches about 23 m, a streamlined two-chamber stack about 55 m, and a tuned two-stage stack is in the same range but separates a few metres up. Think in terms of the simulator's numbers, not real-world safety limits; the pump goes to 8 bar.

## How to work
- When the user asks for a rocket, or to change one, call set_rocket with the complete design. There is a single custom slot, so each call replaces the previous custom rocket. To edit, resend the whole design with the change applied.
- The current rocket loaded in the UI is given below. If the user asks to tweak a preset ("make the Dart have four fins"), build the custom rocket from that preset's parts.
- set_rocket returns the derived spec and flights at ${REFERENCE_LAUNCH.pressureBar} bar and 8 bar. Use simulate_rocket for other launch settings. If a result is far from what the user wanted, adjust and call set_rocket again before answering.
- Reply briefly and concretely: what you built, the apex at the reference settings, and one suggestion if there is an obvious improvement. No headings, no JSON in prose. Two to four sentences is usually right.
- Pick a colour that suits the name. Stay on the topic of bottle rockets and this simulator.`;

function currentRocketContext(rocket: Rocket | null): string {
  if (!rocket) return "Current rocket loaded in the UI: none.";
  const tag = rocket.id === "custom" ? "the user's custom rocket" : `preset "${rocket.id}"`;
  return `Current rocket loaded in the UI (${tag}): ${JSON.stringify({
    name: rocket.name,
    description: rocket.description,
    color: "#" + rocket.color.toString(16).padStart(6, "0"),
    parts: rocket.parts,
  })}`;
}

export type EmitEvent = (event: ChatEvent) => void | Promise<void>;

/**
 * Runs one turn, streaming text deltas and tool activity through `emit` as they happen.
 * Resolves with the complete result once the model ends its turn.
 */
export async function runChatTurn(client: Anthropic, req: ChatRequest, emit: EmitEvent): Promise<ChatResponse> {
  const messages: ChatMessage[] = [...req.messages, { role: "user", content: req.message }];
  let loaded: Rocket | null = req.rocket;
  let produced: Rocket | null = null;
  const replies: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: currentRocketContext(loaded) },
      ],
      tools,
      messages,
    });
    stream.on("text", (delta) => { void emit({ type: "text", delta }); });
    const response = await stream.finalMessage();

    messages.push({ role: "assistant", content: response.content });
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) replies.push(block.text.trim());
    }

    if (response.stop_reason === "refusal") {
      const note = "I can't help with that request. Ask me about bottle rockets and I'll build you one.";
      replies.push(note);
      await emit({ type: "text", delta: note });
      break;
    }
    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") break;

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      await emit({ type: "tool", name: tu.name, status: "start" });
      const outcome = executeTool(tu.name, tu.input, loaded);
      if (outcome.rocket) {
        loaded = outcome.rocket;
        produced = outcome.rocket;
        await emit({ type: "rocket", rocket: outcome.rocket });
      }
      await emit({ type: "tool", name: tu.name, status: outcome.isError ? "error" : "ok" });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: outcome.content, is_error: outcome.isError ?? false });
    }
    messages.push({ role: "user", content: results });
  }

  return { reply: replies.join("\n\n"), messages, rocket: produced };
}
