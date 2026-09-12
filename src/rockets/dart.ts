import type { Rocket } from "./types";

/** Single chamber with a nose cone and a body tube spacer: light, streamlined, goes high. */
export const dart: Rocket = {
  id: "dart",
  name: "Dart",
  description: "One chamber, a body-tube spacer and a top-half nose. Streamlined for altitude.",
  parts: [
    { kind: "bottle", cut: "full", role: "chamber" },
    { kind: "fins", count: 3, span: 0.06, height: 0.15 },
    { kind: "bottle", cut: "body-tube", role: "structure" },
    { kind: "bottle", cut: "top-half", role: "nose" },
  ],
  joins: [
    { type: "tape", between: [0, 1] },
    { type: "tape", between: [0, 2] },
    { type: "tape", between: [2, 3] },
  ],
  color: 0xb3ff6d,
};
