import type { Rocket } from "./types";

/** The classic: one bottle, three fins cut from another bottle's sides. */
export const single: Rocket = {
  id: "single",
  name: "Classic Single",
  description: "One 2L bottle as the chamber, three side-cut fins taped near the nozzle.",
  parts: [
    { kind: "bottle", cut: "full", role: "chamber" },
    { kind: "fins", count: 3, span: 0.07, height: 0.12 },
  ],
  joins: [{ type: "tape", between: [0, 1] }],
  color: 0x5ec8ff,
};
