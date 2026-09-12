import type { World } from "../world/world";
import type { Rocket } from "../rockets/types";
import { deriveSpec, type RocketSpec } from "../rockets/parts";

export type Vec3 = [number, number, number];

export interface LaunchParams {
  /** Gauge pressure in bar, what the pump gauge reads. */
  pressureBar: number;
  /** Fraction of chamber volume filled with water, 0..1. */
  waterFill: number;
  /** Degrees from vertical, tilted toward +X. */
  angleDeg: number;
}

export interface Sample {
  t: number;
  pos: Vec3;
  vel: Vec3;
  /** Unit vector the nose points along. */
  dir: Vec3;
  mass: number;
  thrusting: boolean;
  /** Remaining water as a fraction of the initial fill. */
  waterFraction: number;
}

export interface Trajectory {
  samples: Sample[];
  spec: RocketSpec;
  apex: number;
  range: number;
  flightTime: number;
  maxSpeed: number;
  burnTime: number;
  liftoffMass: number;
}

const GAMMA = 1.4; // adiabatic index of air
const SAMPLE_INTERVAL = 1 / 240;

/**
 * Pure function: rocket + world + launch settings -> full flight path.
 * Thrust phase: water expelled by expanding air (adiabatic). Coast: gravity + drag.
 * Fins are assumed to keep the nose aligned with the velocity vector.
 */
export function simulate(rocket: Rocket, world: World, launch: LaunchParams): Trajectory {
  const spec = deriveSpec(rocket);

  const angle = (launch.angleDeg * Math.PI) / 180;
  let dir: Vec3 = [Math.sin(angle), Math.cos(angle), 0];

  const waterVolume0 = launch.waterFill * spec.chamberVolume;
  const airVolume0 = spec.chamberVolume - waterVolume0;
  const P0 = world.atmosphericPressure + launch.pressureBar * 1e5;

  let waterVolume = waterVolume0;
  let waterMass = waterVolume * world.waterDensity;
  let pos: Vec3 = [0, 0, 0];
  let vel: Vec3 = [0, 0, 0];
  let t = 0;
  let thrusting = waterVolume > 0;
  let burnTime = 0;
  let maxSpeed = 0;
  let apex = 0;

  const samples: Sample[] = [];
  let nextSample = 0;
  const liftoffMass = spec.dryMass + waterMass;

  const record = () => {
    samples.push({
      t,
      pos: [...pos] as Vec3,
      vel: [...vel] as Vec3,
      dir: [...dir] as Vec3,
      mass: spec.dryMass + waterMass,
      thrusting,
      waterFraction: waterVolume0 > 0 ? waterVolume / waterVolume0 : 0,
    });
    nextSample += SAMPLE_INTERVAL;
  };
  record();

  const maxT = 60;
  while (t < maxT) {
    const dt = thrusting ? 0.0002 : 0.002;
    const mass = spec.dryMass + waterMass;

    // --- forces ---
    let fx = 0, fy = -world.gravity * mass, fz = 0;

    if (thrusting) {
      const airVolume = spec.chamberVolume - waterVolume;
      const P = P0 * Math.pow(airVolume0 / airVolume, GAMMA);
      const gauge = P - world.atmosphericPressure;
      if (gauge <= 0 || waterVolume <= 0) {
        thrusting = false;
        waterVolume = 0;
        waterMass = 0;
      } else {
        const ve = Math.sqrt((2 * gauge) / world.waterDensity); // Bernoulli exhaust speed
        const volFlow = spec.nozzleArea * ve;
        const thrust = 2 * gauge * spec.nozzleArea;           // rho * A * ve^2
        fx += thrust * dir[0];
        fy += thrust * dir[1];
        fz += thrust * dir[2];
        const dV = Math.min(volFlow * dt, waterVolume);
        waterVolume -= dV;
        waterMass = waterVolume * world.waterDensity;
        burnTime = t + dt;
      }
    }

    // Drag, relative to air (wind hook for later)
    const rvx = vel[0] - world.wind[0];
    const rvy = vel[1] - world.wind[1];
    const rvz = vel[2] - world.wind[2];
    const speed = Math.hypot(rvx, rvy, rvz);
    if (speed > 1e-6) {
      const drag = 0.5 * world.airDensity * spec.dragCoefficient * spec.frontalArea * speed * speed;
      fx -= (drag * rvx) / speed;
      fy -= (drag * rvy) / speed;
      fz -= (drag * rvz) / speed;
    }

    // --- integrate (semi-implicit Euler) ---
    const m = spec.dryMass + waterMass;
    vel = [vel[0] + (fx / m) * dt, vel[1] + (fy / m) * dt, vel[2] + (fz / m) * dt];

    // Held on the pad until net force points up
    if (pos[1] <= 0 && vel[1] < 0) vel = [0, 0, 0];

    pos = [pos[0] + vel[0] * dt, pos[1] + vel[1] * dt, pos[2] + vel[2] * dt];
    t += dt;

    const s = Math.hypot(vel[0], vel[1], vel[2]);
    if (s > 0.5) dir = [vel[0] / s, vel[1] / s, vel[2] / s];
    if (s > maxSpeed) maxSpeed = s;
    if (pos[1] > apex) apex = pos[1];

    if (t >= nextSample) record();

    // Landed
    if (pos[1] < 0 && t > 0.05) {
      pos[1] = 0;
      record();
      break;
    }
  }

  const last = samples[samples.length - 1];
  return {
    samples,
    spec,
    apex,
    range: Math.hypot(last.pos[0], last.pos[2]),
    flightTime: last.t,
    maxSpeed,
    burnTime,
    liftoffMass,
  };
}
