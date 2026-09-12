import * as THREE from "three";
import { createScene } from "./render/scene";
import { buildRocketMesh, type RocketMesh } from "./render/rocketMesh";
import { Trail, Spray } from "./render/effects";
import { simulate, type Trajectory, type Sample } from "./sim/simulate";
import { rockets } from "./rockets";
import { earth } from "./world/world";
import { deriveSpec } from "./rockets/parts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const { scene, camera, renderer, controls, padTop } = createScene($("app"));
const trail = new Trail();
const spray = new Spray();
scene.add(trail.line, spray.points);

// Fake shadow blob so altitude reads visually
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.25, 32),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = padTop + 0.003;
scene.add(shadow);

// --- UI wiring ---
const rocketSel = $<HTMLSelectElement>("rocket");
for (const r of rockets) {
  const o = document.createElement("option");
  o.value = r.id; o.textContent = r.name;
  rocketSel.appendChild(o);
}
const pressure = $<HTMLInputElement>("pressure");
const water = $<HTMLInputElement>("water");
const angle = $<HTMLInputElement>("angle");
const speed = $<HTMLInputElement>("speed");

const bindLabel = (input: HTMLInputElement, label: string, fmt: (v: number) => string) => {
  const el = $(label);
  const update = () => (el.textContent = fmt(parseFloat(input.value)));
  input.addEventListener("input", update);
  update();
};
bindLabel(pressure, "pressureVal", (v) => `${v.toFixed(1)} bar`);
bindLabel(water, "waterVal", (v) => `${Math.round(v * 100)}%`);
bindLabel(angle, "angleVal", (v) => `${v}°`);
bindLabel(speed, "speedVal", (v) => `${v.toFixed(1)}×`);

// --- rocket model ---
let rocketMesh: RocketMesh | null = null;
let currentRocket = rockets[0];
const UP = new THREE.Vector3(0, 1, 0);

function loadRocket() {
  currentRocket = rockets.find((r) => r.id === rocketSel.value) ?? rockets[0];
  if (rocketMesh) scene.remove(rocketMesh.group);
  rocketMesh = buildRocketMesh(currentRocket);
  scene.add(rocketMesh.group);
  $("desc").textContent = currentRocket.description;
  const spec = deriveSpec(currentRocket);
  $("stats").innerHTML =
    `Dry mass <b>${(spec.dryMass * 1000).toFixed(0)} g</b> · Length <b>${spec.length.toFixed(2)} m</b><br>` +
    `Chamber <b>${(spec.chamberVolume * 1000).toFixed(0)} L</b> · Cd <b>${spec.dragCoefficient.toFixed(2)}</b>`;
  placeOnPad();
}

function placeOnPad() {
  if (!rocketMesh) return;
  const a = (parseFloat(angle.value) * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.sin(a), Math.cos(a), 0);
  rocketMesh.group.position.set(0, padTop, 0);
  rocketMesh.group.quaternion.setFromUnitVectors(UP, dir);
  rocketMesh.setWater(parseFloat(water.value));
  shadow.position.set(0, padTop + 0.003, 0);
  shadow.scale.setScalar(1);
}

rocketSel.addEventListener("change", () => { stopFlight(); loadRocket(); });
angle.addEventListener("input", () => { if (!flight) placeOnPad(); });
water.addEventListener("input", () => { if (!flight) placeOnPad(); });

// --- flight playback ---
interface Flight { traj: Trajectory; t: number; idx: number; done: boolean }
let flight: Flight | null = null;

function stopFlight() {
  flight = null;
  trail.reset();
  spray.reset();
}

function launch() {
  stopFlight();
  const traj = simulate(currentRocket, earth, {
    pressureBar: parseFloat(pressure.value),
    waterFill: parseFloat(water.value),
    angleDeg: parseFloat(angle.value),
  });
  flight = { traj, t: 0, idx: 0, done: false };
  const spec = traj.spec;
  $("stats").innerHTML =
    `Apex <b>${traj.apex.toFixed(1)} m</b> · Range <b>${traj.range.toFixed(1)} m</b><br>` +
    `Max speed <b>${traj.maxSpeed.toFixed(1)} m/s</b> · Burn <b>${(traj.burnTime * 1000).toFixed(0)} ms</b><br>` +
    `Flight <b>${traj.flightTime.toFixed(2)} s</b> · Liftoff mass <b>${(traj.liftoffMass * 1000).toFixed(0)} g</b><br>` +
    `<span style="color:#8d98b8">${spec.chamberCount} chamber${spec.chamberCount > 1 ? "s" : ""}, Cd ${spec.dragCoefficient.toFixed(2)}</span>`;
}
$("launch").addEventListener("click", launch);
window.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); launch(); } });

function sampleAt(traj: Trajectory, t: number, hint: number): { s: Sample; idx: number } {
  const ss = traj.samples;
  let i = hint;
  while (i < ss.length - 1 && ss[i + 1].t <= t) i++;
  return { s: ss[i], idx: i };
}

const tmpPos = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const nozzle = new THREE.Vector3();
const camOffset = new THREE.Vector3();
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (flight && rocketMesh) {
    const rate = parseFloat(speed.value);
    if (!flight.done) flight.t += dt * rate;
    const { s, idx } = sampleAt(flight.traj, flight.t, flight.idx);
    flight.idx = idx;
    if (idx >= flight.traj.samples.length - 1) flight.done = true;

    tmpPos.set(s.pos[0], s.pos[1] + padTop, s.pos[2]);
    tmpDir.set(s.dir[0], s.dir[1], s.dir[2]);
    rocketMesh.group.position.copy(tmpPos);
    rocketMesh.group.quaternion.setFromUnitVectors(UP, tmpDir);
    rocketMesh.setWater(s.waterFraction);
    trail.push(tmpPos);

    if (s.thrusting) {
      nozzle.copy(tmpPos);
      spray.emit(nozzle, tmpDir, 22, Math.ceil(400 * dt * rate + 4));
    }

    shadow.position.set(tmpPos.x, padTop + 0.003, tmpPos.z);
    const sh = 1 + s.pos[1] * 0.08;
    shadow.scale.setScalar(sh);
    (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.05, 0.35 / sh);

    $("alt").textContent = `${s.pos[1].toFixed(1)} m`;

    // Camera follows: keep the user's orbit offset, glide the target onto the rocket
    camOffset.copy(camera.position).sub(controls.target);
    controls.target.lerp(tmpPos, 0.15);
    camera.position.copy(controls.target).add(camOffset);
  } else {
    $("alt").textContent = "0.0 m";
  }

  spray.update(dt, earth.gravity);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

loadRocket();
requestAnimationFrame(frame);
