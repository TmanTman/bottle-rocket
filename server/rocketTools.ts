/**
 * Tools the rocket-design agent can call. Both run the project's own physics, so the
 * agent gets the same numbers the UI will show.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Rocket } from "../src/rockets/types";
import { deriveSpec } from "../src/rockets/parts";
import { simulate, type LaunchParams } from "../src/sim/simulate";
import { earth } from "../src/world/world";
import { buildRocket, LIMITS, RocketValidationError, type RocketDraft } from "../src/rockets/validate";

/** The launch settings the UI starts with; used as the reference flight in tool results. */
export const REFERENCE_LAUNCH: LaunchParams = { pressureBar: 5, waterFill: 0.35, angleDeg: 10, windSpeed: 0, windDirectionDeg: 0 };

const bottlePartSchema = {
  type: "object",
  description: "A 2L soda bottle, whole or cut.",
  properties: {
    kind: { type: "string", enum: ["bottle"] },
    cut: {
      type: "string",
      enum: ["full", "top-half", "bottom-half", "body-tube"],
      description: "full = untouched bottle; top-half = neck + shoulder (nose cone); bottom-half = base cup; body-tube = straight middle section.",
    },
    role: {
      type: "string",
      enum: ["chamber", "nose", "structure"],
      description: "chamber holds water and pressure (full bottles only, neck points down to the nozzle); nose points neck-up at the top; structure is a spacer.",
    },
  },
  required: ["kind", "cut", "role"],
  additionalProperties: false,
} as const;

const finsPartSchema = {
  type: "object",
  description: "A set of fins cut from bottle sides, evenly spaced around the bottle immediately below them in the parts list.",
  properties: {
    kind: { type: "string", enum: ["fins"] },
    count: { type: "integer", description: `Number of fins, ${LIMITS.fins.count[0]}..${LIMITS.fins.count[1]}.` },
    span: { type: "number", description: `How far each fin sticks out from the body in metres, ${LIMITS.fins.span[0]}..${LIMITS.fins.span[1]}.` },
    height: { type: "number", description: `Fin length along the body in metres, ${LIMITS.fins.height[0]}..${LIMITS.fins.height[1]}.` },
  },
  required: ["kind", "count", "span", "height"],
  additionalProperties: false,
} as const;

export const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "set_rocket",
    description:
      "Create or replace the user's custom rocket. Pass the complete design every time (there is one custom slot; calling again overwrites it). " +
      "Parts are listed bottom (nozzle) to top (nose). Tape joins are added automatically. " +
      "The result includes the derived mass, drag and a reference flight, or a list of validation problems to fix.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short display name, max 40 characters." },
        description: { type: "string", description: "One sentence on what the design is and why, max 240 characters." },
        color: { type: "string", description: 'Body colour as a CSS hex string, e.g. "#5ec8ff".' },
        parts: {
          type: "array",
          description: `Bottom to top. First part must be a full-bottle chamber. At most ${LIMITS.maxParts} parts.`,
          items: { anyOf: [bottlePartSchema, finsPartSchema] },
        },
      },
      required: ["name", "description", "color", "parts"],
      additionalProperties: false,
    },
  },
  {
    name: "simulate_rocket",
    description:
      "Fly the currently loaded rocket (the custom one if it exists, otherwise the one selected in the UI) with given launch settings and return apex, range, speed and timing.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pressureBar: { type: "number", description: "Gauge pressure in bar, 1..8." },
        waterFill: { type: "number", description: "Fraction of chamber volume filled with water, 0..0.7." },
        angleDeg: { type: "number", description: "Launch angle from vertical in degrees, 0..45." },
      },
      required: ["pressureBar", "waterFill", "angleDeg"],
      additionalProperties: false,
    },
  },
];

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Present when set_rocket produced a valid rocket. */
  rocket?: Rocket;
}

function flightSummary(rocket: Rocket, launch: LaunchParams) {
  const t = simulate(rocket, earth, launch);
  return {
    launch,
    apexM: round(t.apex, 1),
    rangeM: round(t.range, 1),
    maxSpeedMs: round(t.maxSpeed, 1),
    flightTimeS: round(t.flightTime, 2),
    burnTimeMs: Math.round(t.burnTime * 1000),
    liftoffMassG: Math.round(t.liftoffMass * 1000),
  };
}

function specSummary(rocket: Rocket) {
  const s = deriveSpec(rocket);
  return {
    dryMassG: Math.round(s.dryMass * 1000),
    lengthM: round(s.length, 2),
    chamberCount: s.chamberCount,
    chamberVolumeL: round(s.chamberVolume * 1000, 1),
    dragCoefficient: round(s.dragCoefficient, 2),
  };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function executeTool(name: string, input: unknown, current: Rocket | null): ToolOutcome {
  if (name === "set_rocket") {
    try {
      const rocket = buildRocket(input as RocketDraft);
      return {
        rocket,
        content: JSON.stringify({
          ok: true,
          rocket: { name: rocket.name, parts: rocket.parts, joins: rocket.joins.length },
          spec: specSummary(rocket),
          referenceFlight: flightSummary(rocket, REFERENCE_LAUNCH),
          highPressureFlight: flightSummary(rocket, { ...REFERENCE_LAUNCH, pressureBar: 8 }),
        }),
      };
    } catch (e) {
      const problems = e instanceof RocketValidationError ? e.problems : [e instanceof Error ? e.message : String(e)];
      return { isError: true, content: JSON.stringify({ ok: false, problems }) };
    }
  }

  if (name === "simulate_rocket") {
    if (!current) return { isError: true, content: JSON.stringify({ ok: false, problems: ["No rocket is loaded. Call set_rocket first."] }) };
    const raw = (input ?? {}) as Record<string, unknown>;
    const launch: LaunchParams = {
      ...REFERENCE_LAUNCH,
      pressureBar: clamp(raw.pressureBar, 1, 8, REFERENCE_LAUNCH.pressureBar),
      waterFill: clamp(raw.waterFill, 0, 0.7, REFERENCE_LAUNCH.waterFill),
      angleDeg: clamp(raw.angleDeg, 0, 45, REFERENCE_LAUNCH.angleDeg),
    };
    return { content: JSON.stringify({ ok: true, rocket: current.name, ...flightSummary(current, launch) }) };
  }

  return { isError: true, content: JSON.stringify({ ok: false, problems: [`Unknown tool ${name}`] }) };
}
