import type { Rocket, BottleCut } from "./types";

/** Real-world measurements of a standard 2L PET soda bottle. */
export const BOTTLE = {
  volume: 0.002,        // m^3
  height: 0.33,         // m, cap to base
  radius: 0.0525,       // m, outer body radius (105 mm diameter)
  mass: 0.045,          // kg, empty with cap off
  neckRadius: 0.0108,   // m, 21.6 mm inner nozzle diameter
  wallArealMass: 0.045 / 0.12, // kg/m^2, rough: bottle mass over its surface area
};

export const TAPE_MASS = 0.004; // kg per join, a few wraps of duct tape

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

export function deriveSpec(rocket: Rocket): RocketSpec {
  let dryMass = 0;
  let length = 0;
  let chamberVolume = 0;
  let chamberCount = 0;
  let hasNose = false;
  let finArea = 0;

  for (const part of rocket.parts) {
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
    } else {
      const each = part.span * part.height;
      finArea += each * part.count;
      dryMass += each * BOTTLE.wallArealMass * part.count;
    }
  }
  dryMass += TAPE_MASS * rocket.joins.length;

  if (chamberCount === 0) throw new Error(`${rocket.name}: needs at least one chamber bottle`);

  const frontalArea = Math.PI * BOTTLE.radius ** 2;
  // A top-half bottle as a nose cone streamlines things a lot. Fins add a little drag.
  const baseCd = hasNose ? 0.35 : 0.75;
  const dragCoefficient = baseCd + (finArea / frontalArea) * 0.02;

  return {
    dryMass,
    length,
    radius: BOTTLE.radius,
    frontalArea,
    dragCoefficient,
    chamberVolume,
    nozzleArea: Math.PI * BOTTLE.neckRadius ** 2,
    chamberCount,
  };
}
