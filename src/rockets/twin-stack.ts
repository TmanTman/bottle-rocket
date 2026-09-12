import type { Rocket } from "./types";

/** Two full bottles taped neck-to-base as one long chamber, with a nose cone. */
export const twinStack: Rocket = {
  id: "twin-stack",
  name: "Twin Stack",
  description: "Two chamber bottles taped in line for double the volume, top-half nose cone, four fins.",
  parts: [
    { kind: "bottle", cut: "full", role: "chamber" },
    { kind: "fins", count: 4, span: 0.08, height: 0.14 },
    { kind: "bottle", cut: "full", role: "chamber" },
    { kind: "bottle", cut: "top-half", role: "nose" },
  ],
  joins: [
    { type: "tape", between: [0, 1] },
    { type: "tape", between: [0, 2] },
    { type: "tape", between: [2, 3] },
  ],
  color: 0xff8f5e,
};
