import type { Rocket } from "./types";
import { single } from "./single";
import { twinStack } from "./twin-stack";
import { dart } from "./dart";

/** Register new rockets here. Order is the order shown in the UI. */
export const rockets: Rocket[] = [single, dart, twinStack];

export * from "./types";
