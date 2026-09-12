/**
 * Turns an untrusted rocket draft (from the agent, or later a form) into a valid Rocket.
 * Pure TypeScript, shared by the API server and available to the browser.
 */
import type { BottleCut, BottlePart, Part, Rocket, TapeJoin } from "./types";
import { deriveSpec } from "./parts";

export const CUSTOM_ROCKET_ID = "custom";

const CUTS: BottleCut[] = ["full", "top-half", "bottom-half", "body-tube"];
const ROLES: BottlePart["role"][] = ["chamber", "nose", "structure"];

export const LIMITS = {
  maxParts: 10,
  fins: { count: [1, 8], span: [0.02, 0.2], height: [0.03, 0.33] },
} as const;

/** What the agent hands us. Joins are derived, colour is a CSS hex string. */
export interface RocketDraft {
  name: string;
  description: string;
  color: string;
  parts: unknown[];
}

export class RocketValidationError extends Error {
  constructor(public problems: string[]) {
    super(problems.join("\n"));
    this.name = "RocketValidationError";
  }
}

/**
 * Tape every part to the nearest bottle below it. This reproduces the joins in the
 * preset rockets: bottles stack on the previous bottle, fins wrap the bottle they sit on.
 */
export function autoJoins(parts: Part[]): TapeJoin[] {
  const joins: TapeJoin[] = [];
  let lastBottle = -1;
  parts.forEach((part, i) => {
    if (lastBottle >= 0) joins.push({ type: "tape", between: [lastBottle, i] });
    if (part.kind === "bottle") lastBottle = i;
  });
  return joins;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function inRange(v: unknown, [lo, hi]: readonly [number, number]): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
}

function parsePart(raw: unknown, i: number, problems: string[]): Part | null {
  const at = `parts[${i}]`;
  if (!isRecord(raw)) { problems.push(`${at}: must be an object`); return null; }
  if (raw.kind === "bottle") {
    const cut = raw.cut as BottleCut;
    const role = raw.role as BottlePart["role"];
    if (!CUTS.includes(cut)) problems.push(`${at}: cut must be one of ${CUTS.join(", ")}`);
    if (!ROLES.includes(role)) problems.push(`${at}: role must be one of ${ROLES.join(", ")}`);
    if (role === "chamber" && cut !== "full") problems.push(`${at}: only a "full" bottle can be a chamber (it has to hold pressure)`);
    return { kind: "bottle", cut, role };
  }
  if (raw.kind === "fins") {
    const { count, span, height } = raw;
    if (!inRange(count, LIMITS.fins.count) || !Number.isInteger(count))
      problems.push(`${at}: fins count must be an integer ${LIMITS.fins.count[0]}..${LIMITS.fins.count[1]}`);
    if (!inRange(span, LIMITS.fins.span)) problems.push(`${at}: fin span must be ${LIMITS.fins.span[0]}..${LIMITS.fins.span[1]} m`);
    if (!inRange(height, LIMITS.fins.height)) problems.push(`${at}: fin height must be ${LIMITS.fins.height[0]}..${LIMITS.fins.height[1]} m`);
    return { kind: "fins", count: count as number, span: span as number, height: height as number };
  }
  problems.push(`${at}: kind must be "bottle" or "fins"`);
  return null;
}

/** Parse "#ff8f5e" / "ff8f5e" into the number the renderer wants. */
export function parseHexColor(s: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  return m ? parseInt(m[1], 16) : null;
}

/** Validate a draft and build the Rocket. Throws RocketValidationError listing every problem. */
export function buildRocket(draft: RocketDraft): Rocket {
  const problems: string[] = [];

  const name = typeof draft.name === "string" ? draft.name.trim() : "";
  if (!name) problems.push("name is required");
  if (name.length > 40) problems.push("name must be 40 characters or fewer");
  const description = typeof draft.description === "string" ? draft.description.trim() : "";
  if (description.length > 240) problems.push("description must be 240 characters or fewer");

  const color = typeof draft.color === "string" ? parseHexColor(draft.color) : null;
  if (color === null) problems.push('color must be a hex string like "#5ec8ff"');

  const rawParts = Array.isArray(draft.parts) ? draft.parts : [];
  if (rawParts.length === 0) problems.push("parts must have at least one entry");
  if (rawParts.length > LIMITS.maxParts) problems.push(`parts must have at most ${LIMITS.maxParts} entries`);

  const parts: Part[] = [];
  rawParts.forEach((raw, i) => {
    const p = parsePart(raw, i, problems);
    if (p) parts.push(p);
  });

  if (parts.length === rawParts.length && parts.length > 0) {
    const first = parts[0];
    if (first.kind !== "bottle" || first.role !== "chamber")
      problems.push('parts[0] is the nozzle end and must be a { kind: "bottle", cut: "full", role: "chamber" }');
    const noseIdx = parts.findIndex((p) => p.kind === "bottle" && p.role === "nose");
    if (noseIdx >= 0 && parts.slice(noseIdx + 1).some((p) => p.kind === "bottle"))
      problems.push("the nose must be the topmost bottle; nothing can sit above it");
    if (parts.filter((p) => p.kind === "bottle" && p.role === "nose").length > 1)
      problems.push("only one nose part is allowed");
  }

  if (problems.length) throw new RocketValidationError(problems);

  const rocket: Rocket = {
    id: CUSTOM_ROCKET_ID,
    name,
    description,
    parts,
    joins: autoJoins(parts),
    color: color as number,
  };

  try {
    deriveSpec(rocket);
  } catch (e) {
    throw new RocketValidationError([e instanceof Error ? e.message : String(e)]);
  }
  return rocket;
}
