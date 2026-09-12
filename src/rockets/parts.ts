import type { Rocket, BottleCut, Part, CouplingPart } from "./types";

/** Real-world measurements of a standard 2L PET soda bottle. */
export const BOTTLE = {
  volume: 0.002,        // m^3
  height: 0.33,         // m, cap to base
  radius: 0.0525,       // m, outer body radius (105 mm diameter)
  mass: 0.045,          // kg, empty with cap off
  neckRadius: 0.0108,   // m, 21.6 mm inner nozzle diameter
  wallArealMass: 0.045 / 0.12, // kg/m^2, rough: bottle mass over its surface area
};

export const TAPE_MASS = 0.004;     // kg per join, a few wraps of duct tape
export const COUPLING_MASS = 0.02;  // kg, release coupling built from a bottle neck + tape
export const COUPLING_LENGTH = 0.04; // m, visible gap/collar between stages

/** Length and mass of each cut, as fractions of a whole bottle. */
const CUTS: Record<BottleCut, { length: number; mass: number; canPressurise: boolean }> = {
  full:          { length: 1.0,  mass: 1.0,  canPressurise: true },
  "top-half":    { length: 0.45, mass: 0.45, canPressurise: false },
  "bottom-half": { length: 0.5,  mass: 0.5,  canPressurise: false },
  "body-tube":   { length: 0.5,  mass: 0.4,  canPressurise: false },
};

export function cutLength(cut: BottleCut): number {
  return BOTTLE.height * CUTS[cut].length;
}
export function cutMass(cut: BottleCut): number {
  return BOTTLE.mass * CUTS[cut].mass;
}

/** Physical properties derived from a parts list. */
export interface RocketSpec {
  dryMass: number;        // kg, everything except water
  length: number;         // m
  radius: number;         // m
  frontalArea: number;    // m^2
  dragCoefficient: number;
  chamberVolume: number;  // m^3
  nozzleArea: number;     // m^2
  chamberCount: number;
}

/** One stage of a rocket: a contiguous slice of the parts list between couplings. */
export interface StageSpec extends RocketSpec {
  /** Index range [start, end) into rocket.parts. */
  start: number;
  end: number;
  parts: Part[];
  /** Coupling that attaches this stage to the one above, or null for the top stage. */
  coupling: CouplingPart | null;
}

function specFor(rocket: Rocket, parts: Part[], start: number, end: number, extraMass: number, extraLength: number): RocketSpec {
  let dryMass = extraMass;
  let length = extraLength;
  let chamberVolume = 0;
  let chamberCount = 0;
  let hasNose = false;
  let finArea = 0;

  for (const part of parts) {
    if (part.kind === "bottle") {
      dryMass += cutMass(part.cut);
      length += cutLength(part.cut);
      if (part.role === "chamber") {
        if (!CUTS[part.cut].canPressurise) {
          throw new Error(`${rocket.name}: a "${part.cut}" bottle cannot be a pressure chamber`);
        }
        chamberVolume += BOTTLE.volume;
        chamberCount += 1;
      }
      if (part.role === "nose") hasNose = true;
    } else if (part.kind === "fins") {
      const each = part.span * part.height;
      finArea += each * part.count;
      dryMass += each * BOTTLE.wallArealMass * part.count;
    }
  }
  for (const j of rocket.joins) {
    const [a, b] = j.between;
    if (a >= start && a < end && b >= start && b < end) dryMass += TAPE_MASS;
  }

  const frontalArea = Math.PI * BOTTLE.radius ** 2;
  // A top-half bottle as a nose cone streamlines things a lot. Fins add a little drag.
  const baseCd = hasNose ? 0.35 : 0.75;
  const dragCoefficient = baseCd + (finArea / frontalArea) * 0.02;

  return {
    dryMass, length, radius: BOTTLE.radius, frontalArea, dragCoefficient,
    chamberVolume, nozzleArea: Math.PI * BOTTLE.neckRadius ** 2, chamberCount,
  };
}

/** Split the parts list at couplings, bottom stage first. Every stage must have a chamber. */
export function deriveStages(rocket: Rocket): StageSpec[] {
  const stages: StageSpec[] = [];
  let start = 0;
  const flush = (end: number, coupling: CouplingPart | null) => {
    const parts = rocket.parts.slice(start, end);
    const spec = specFor(rocket, parts, start, end, coupling ? COUPLING_MASS : 0, coupling ? COUPLING_LENGTH : 0);
    if (spec.chamberCount === 0) {
      throw new Error(`${rocket.name}: stage ${stages.length + 1} needs at least one chamber bottle`);
    }
    stages.push({ ...spec, start, end, parts, coupling });
  };
  rocket.parts.forEach((p, i) => {
    if (p.kind === "coupling") {
      flush(i, p);
      start = i + 1;
    }
  });
  flush(rocket.parts.length, null);
  return stages;
}

/** Combined properties of several stages flying as one stack. Nozzle is the bottom stage's. */
export function aggregate(stages: StageSpec[]): RocketSpec {
  const top = stages[stages.length - 1];
  const bottom = stages[0];
  const finCd = stages.reduce((s, st) => s + (st.dragCoefficient - (st.dragCoefficient >= 0.75 ? 0.75 : 0.35)), 0);
  return {
    dryMass: stages.reduce((s, st) => s + st.dryMass, 0),
    length: stages.reduce((s, st) => s + st.length, 0),
    radius: BOTTLE.radius,
    frontalArea: bottom.frontalArea,
    dragCoefficient: (top.dragCoefficient >= 0.75 ? 0.75 : 0.35) + finCd,
    chamberVolume: stages.reduce((s, st) => s + st.chamberVolume, 0),
    nozzleArea: bottom.nozzleArea,
    chamberCount: stages.reduce((s, st) => s + st.chamberCount, 0),
  };
}

/** Whole-rocket spec as it sits on the pad. */
export function deriveSpec(rocket: Rocket): RocketSpec {
  return aggregate(deriveStages(rocket));
}
