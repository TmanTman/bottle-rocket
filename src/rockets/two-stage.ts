import type { Rocket } from "./types";

/**
 * Genuine two-stage rocket. The booster (below the coupling) lifts the stack, then
 * falls away after its water runs out. The sustainer (above) fires its own chamber
 * from altitude. Both stages are pumped to the same pressure through the coupling.
 *
 * Water-rocket burns last well under a second, so staging happens low: a few metres
 * up. A two-bottle booster and a slightly slow coupling push separation higher.
 */
export const twoStage: Rocket = {
  id: "two-stage",
  name: "Two-Stage",
  description: "Two-bottle booster with four fins, release coupling, then a sustainer with its own chamber, fins and nose cone. Booster drops away 0.1 s after burnout.",
  parts: [
    // Stage 1: booster (two bottles joined as one 4L chamber)
    { kind: "bottle", cut: "full", role: "chamber" },
    { kind: "fins", count: 4, span: 0.09, height: 0.14 },
    { kind: "bottle", cut: "full", role: "chamber" },
    { kind: "coupling", release: "booster-empty", delaySeconds: 0.1 },
    // Stage 2: sustainer
    { kind: "bottle", cut: "full", role: "chamber" },
    { kind: "fins", count: 3, span: 0.05, height: 0.10 },
    { kind: "bottle", cut: "top-half", role: "nose" },
  ],
  joins: [
    { type: "tape", between: [0, 1] },
    { type: "tape", between: [0, 2] },
    { type: "tape", between: [4, 5] },
    { type: "tape", between: [4, 6] },
  ],
  color: 0xf7d354,
};
