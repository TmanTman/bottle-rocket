import type { World } from "../world/world";
import type { Rocket } from "../rockets/types";
import { deriveStages, aggregate, type RocketSpec, type StageSpec } from "../rockets/parts";

export type Vec3 = [number, number, number];

export interface LaunchParams {
  /** Gauge pressure in bar, what the pump gauge reads. Applies to every stage. */
  pressureBar: number;
  /** Fraction of chamber volume filled with water, 0..1. Applies to every stage. */
  waterFill: number;
  /** Degrees from vertical, tilted toward +X. */
  angleDeg: number;
}

export interface Sample {
  t: number;
  /** Position of the bottom (nozzle) of the body. */
  pos: Vec3;
  vel: Vec3;
  /** Unit vector the nose points along. */
  dir: Vec3;
  mass: number;
  thrusting: boolean;
  /** Remaining water in the active chamber as a fraction of its initial fill. */
  waterFraction: number;
  /** Index of the lowest stage still attached to this body. */
  stage: number;
}

export interface DebrisTrack {
  stage: number;
  separationTime: number;
  samples: Sample[];
}

export interface Separation {
  t: number;
  stage: number;   // the stage that fell away
  altitude: number;
  speed: number;
}

export interface Trajectory {
  /** The body that carries on: the full stack, then whatever is left after each separation. */
  samples: Sample[];
  debris: DebrisTrack[];
  separations: Separation[];
  stages: StageSpec[];
  spec: RocketSpec;
  apex: number;
  range: number;
  flightTime: number;
  maxSpeed: number;
  /** Total time any chamber was thrusting. */
  burnTime: number;
  liftoffMass: number;
}

const GAMMA = 1.4; // adiabatic index of air
const SAMPLE_INTERVAL = 1 / 240;
const DEBRIS_CD = 0.9; // an empty booster tumbles; treat it as blunt

interface Body {
  pos: Vec3;
  vel: Vec3;
  dir: Vec3;
  dryMass: number;       // structure plus any dead water in sealed upper stages
  spec: RocketSpec;      // drag + chamber/nozzle of the active stage
  waterVolume: number;
  waterVolume0: number;
  airVolume0: number;
  P0: number;
  thrusting: boolean;
  landed: boolean;
  stage: number;
  samples: Sample[];
  nextSample: number;
}

/**
 * Pure function: rocket + world + launch settings -> full flight, including staging.
 * Thrust phase: water expelled by expanding air (adiabatic). Coast: gravity + drag.
 * Fins are assumed to keep the nose aligned with the velocity vector.
 * At a coupling, the spent lower stage becomes debris and the next stage fires immediately.
 */
export function simulate(rocket: Rocket, world: World, launch: LaunchParams): Trajectory {
  const stages = deriveStages(rocket);
  const spec = aggregate(stages);

  const angle = (launch.angleDeg * Math.PI) / 180;
  const dir0: Vec3 = [Math.sin(angle), Math.cos(angle), 0];

  /** Dead water carried in sealed stages above `from`. */
  const sealedWaterMass = (from: number) =>
    stages.slice(from).reduce((s, st) => s + launch.waterFill * st.chamberVolume * world.waterDensity, 0);

  const makeBody = (stageIndex: number, pos: Vec3, vel: Vec3, dir: Vec3): Body => {
    const stack = stages.slice(stageIndex);
    const active = stack[0];
    const waterVolume0 = launch.waterFill * active.chamberVolume;
    return {
      pos: [...pos] as Vec3, vel: [...vel] as Vec3, dir: [...dir] as Vec3,
      dryMass: stack.reduce((s, st) => s + st.dryMass, 0) + sealedWaterMass(stageIndex + 1),
      spec: { ...aggregate(stack), chamberVolume: active.chamberVolume, nozzleArea: active.nozzleArea },
      waterVolume: waterVolume0,
      waterVolume0,
      airVolume0: active.chamberVolume - waterVolume0,
      P0: world.atmosphericPressure + launch.pressureBar * 1e5,
      thrusting: waterVolume0 > 0,
      landed: false,
      stage: stageIndex,
      samples: [],
      nextSample: 0,
    };
  };

  const massOf = (b: Body) => b.dryMass + b.waterVolume * world.waterDensity;

  const record = (b: Body, t: number) => {
    b.samples.push({
      t,
      pos: [...b.pos] as Vec3,
      vel: [...b.vel] as Vec3,
      dir: [...b.dir] as Vec3,
      mass: massOf(b),
      thrusting: b.thrusting,
      waterFraction: b.waterVolume0 > 0 ? b.waterVolume / b.waterVolume0 : 0,
      stage: b.stage,
    });
    b.nextSample += SAMPLE_INTERVAL;
  };

  /** Advance one body by dt. Returns true if its thrust ended during this step. */
  const step = (b: Body, dt: number, onPad: boolean): boolean => {
    let burnoutNow = false;
    const mass = massOf(b);
    let fx = 0, fy = -world.gravity * mass, fz = 0;

    if (b.thrusting) {
      const airVolume = b.spec.chamberVolume - b.waterVolume;
      const P = b.P0 * Math.pow(b.airVolume0 / airVolume, GAMMA);
      const gauge = P - world.atmosphericPressure;
      if (gauge <= 0 || b.waterVolume <= 0) {
        b.thrusting = false;
        b.waterVolume = 0;
        burnoutNow = true;
      } else {
        const ve = Math.sqrt((2 * gauge) / world.waterDensity); // Bernoulli exhaust speed
        const thrust = 2 * gauge * b.spec.nozzleArea;           // rho * A * ve^2
        fx += thrust * b.dir[0]; fy += thrust * b.dir[1]; fz += thrust * b.dir[2];
        b.waterVolume -= Math.min(b.spec.nozzleArea * ve * dt, b.waterVolume);
      }
    }

    const rvx = b.vel[0] - world.wind[0], rvy = b.vel[1] - world.wind[1], rvz = b.vel[2] - world.wind[2];
    const speed = Math.hypot(rvx, rvy, rvz);
    if (speed > 1e-6) {
      const drag = 0.5 * world.airDensity * b.spec.dragCoefficient * b.spec.frontalArea * speed * speed;
      fx -= (drag * rvx) / speed; fy -= (drag * rvy) / speed; fz -= (drag * rvz) / speed;
    }

    const m = massOf(b);
    b.vel = [b.vel[0] + (fx / m) * dt, b.vel[1] + (fy / m) * dt, b.vel[2] + (fz / m) * dt];
    if (onPad && b.pos[1] <= 0 && b.vel[1] < 0) b.vel = [0, 0, 0];
    b.pos = [b.pos[0] + b.vel[0] * dt, b.pos[1] + b.vel[1] * dt, b.pos[2] + b.vel[2] * dt];

    const s = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
    if (s > 0.5) b.dir = [b.vel[0] / s, b.vel[1] / s, b.vel[2] / s];
    return burnoutNow;
  };

  let main = makeBody(0, [0, 0, 0], [0, 0, 0], dir0);
  const liftoffMass = massOf(main);
  const debris: { body: Body; track: DebrisTrack }[] = [];
  const separations: Separation[] = [];
  let t = 0;
  let burnTime = 0;
  let maxSpeed = 0;
  let apex = 0;
  let separateAt: number | null = null;
  record(main, 0);

  const maxT = 60;
  while (t < maxT) {
    const dt = main.thrusting ? 0.0002 : 0.002;

    if (!main.landed) {
      const burnout = step(main, dt, main.stage === 0 && t < 1);
      if (main.thrusting) burnTime += dt;
      if (burnout && main.stage < stages.length - 1) {
        separateAt = t + (stages[main.stage].coupling?.delaySeconds ?? 0);
      }
    }
    for (const d of debris) {
      if (d.body.landed) continue;
      step(d.body, dt, false);
      if (d.body.pos[1] < 0) { d.body.pos[1] = 0; d.body.landed = true; record(d.body, t + dt); }
    }
    t += dt;

    // Stage separation: spent stage becomes debris, next stage fires from the top of it.
    if (separateAt !== null && t >= separateAt && !main.landed) {
      const spent = stages[main.stage];
      const booster = makeBody(main.stage, main.pos, main.vel, main.dir);
      booster.dryMass = spent.dryMass;
      booster.spec = { ...spent, dragCoefficient: DEBRIS_CD };
      booster.waterVolume = 0; booster.waterVolume0 = 0; booster.thrusting = false;
      booster.nextSample = main.nextSample;
      const track: DebrisTrack = { stage: main.stage, separationTime: t, samples: booster.samples };
      debris.push({ body: booster, track });
      record(booster, t);

      const speed = Math.hypot(...main.vel);
      separations.push({ t, stage: main.stage, altitude: main.pos[1], speed });

      const upperPos: Vec3 = [
        main.pos[0] + main.dir[0] * spent.length,
        main.pos[1] + main.dir[1] * spent.length,
        main.pos[2] + main.dir[2] * spent.length,
      ];
      const upper = makeBody(main.stage + 1, upperPos, main.vel, main.dir);
      upper.samples = main.samples;
      upper.nextSample = main.nextSample;
      main = upper;
      record(main, t);
      separateAt = null;
    }

    if (!main.landed) {
      const s = Math.hypot(...main.vel);
      if (s > maxSpeed) maxSpeed = s;
      if (main.pos[1] > apex) apex = main.pos[1];
      if (t >= main.nextSample) record(main, t);
      if (main.pos[1] < 0 && t > 0.05) { main.pos[1] = 0; main.landed = true; record(main, t); }
    }
    for (const d of debris) if (!d.body.landed && t >= d.body.nextSample) record(d.body, t);

    if (main.landed && debris.every((d) => d.body.landed)) break;
  }

  const samples = main.samples;
  const last = samples[samples.length - 1];
  return {
    samples,
    debris: debris.map((d) => d.track),
    separations,
    stages,
    spec,
    apex,
    range: Math.hypot(last.pos[0], last.pos[2]),
    flightTime: last.t,
    maxSpeed,
    burnTime,
    liftoffMass,
  };
}
