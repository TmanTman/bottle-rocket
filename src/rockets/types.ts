/**
 * A rocket is a stack of parts, bottom to top, all derived from 2L soda bottles.
 * Parts are joined with tape. The sim derives mass, length, drag and chamber volume
 * from this list, so a new rocket is just a new parts list.
 */

/** How a bottle has been cut. */
export type BottleCut =
  | "full"        // untouched bottle, can hold pressure
  | "top-half"    // neck + shoulder, used as a nose cone
  | "bottom-half" // base + lower body, an open cup
  | "body-tube";  // straight middle section, both ends cut off

export interface BottlePart {
  kind: "bottle";
  cut: BottleCut;
  /** chamber: holds water + pressurised air. Only "full" bottles can be a chamber. */
  role: "chamber" | "nose" | "structure";
  /** Nose bottles face point-up. Chambers face neck-down (the nozzle). */
}

export interface FinsPart {
  kind: "fins";
  count: number;
  /** How far each fin sticks out from the body, metres. Cut from bottle sides. */
  span: number;
  /** Fin height along the body, metres. */
  height: number;
}

export type Part = BottlePart | FinsPart;

export interface TapeJoin {
  type: "tape";
  /** Indices into parts[] of the two parts joined. */
  between: [number, number];
}

export interface Rocket {
  id: string;
  name: string;
  description: string;
  /** Bottom (nozzle end) first, nose last. Fins can appear anywhere; they attach to the previous bottle. */
  parts: Part[];
  joins: TapeJoin[];
  /** Hex colour for the rendered body. */
  color: number;
}
