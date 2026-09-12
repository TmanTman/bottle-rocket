# Bottle Rocket Simulator

Browser-based 3D water-rocket simulator. Vite + TypeScript + Three.js, no backend.

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # typecheck + production bundle

## Layout

- `src/world/world.ts` – environment constants (gravity, air density, ambient wind).
- `src/rockets/` – one file per rocket design plus `types.ts` (schema), `parts.ts` (2L bottle dimensions and `deriveSpec`), `index.ts` (registry shown in the UI).
- `src/sim/simulate.ts` – pure physics. `(rocket, world, launchParams) -> Trajectory`. No Three.js here.
- `src/render/` – Three.js scene, rocket mesh builder (built from the parts list), trail and spray effects.
- `src/main.ts` – UI wiring and playback of a precomputed trajectory.

## Adding a rocket

1. Create `src/rockets/<id>.ts` exporting a `Rocket` (see `twin-stack.ts` for a full example).
2. Add it to the `rockets` array in `src/rockets/index.ts`.
3. Run `npx tsc --noEmit`. The mesh and physics are derived automatically from the parts list.

Rules encoded in the model: every part is a 2L soda bottle (`full`, `top-half`, `bottom-half`, `body-tube`) or fins cut from bottle sides. Only `full` bottles can be a `chamber`. Parts are joined with `tape`; each join adds mass. Parts are listed bottom (nozzle) to top (nose).

**Staging.** A `{ kind: "coupling", release: "booster-empty", delaySeconds?: number }` part splits the list into stages (see `two-stage.ts`). Every stage needs its own chamber. In the sim the lower stage fires first with everything above as dead weight; when its water runs out (plus the optional delay) it becomes a tumbling debris body and the next stage fires immediately from the top of it. `Trajectory.debris` and `Trajectory.separations` carry the booster path and the separation events; the renderer detaches the stage group and drops it. Burns are short, so separation happens low (a few metres); a bigger booster or a small delay raises it.

## Physics notes

Thrust phase is adiabatic air expansion pushing water out of the standard 21.6 mm neck (thrust = 2 × gauge pressure × nozzle area). Coast phase is gravity plus quadratic drag. Fins are assumed to keep the nose along the velocity vector. Drag coefficient comes from whether a nose cone is present. Sanity reference at 5 bar, 35% water: a single bottle reaches about 23 m, a streamlined two-bottle stack about 55 m, the two-stage about 55 m with separation near 3.6 m.

Quick numeric check without a browser:

    npx -y tsx -e 'import {simulate} from "./src/sim/simulate"; import {rockets} from "./src/rockets"; import {earth} from "./src/world/world"; console.log(simulate(rockets[0], earth, {pressureBar:5, waterFill:0.35, angleDeg:10, windSpeed:0, windDirectionDeg:0}).apex)'
