import * as THREE from "three";
import { createScene } from "./render/scene";
import { buildRocketMesh, type RocketMesh } from "./render/rocketMesh";
import { Trail, Spray } from "./render/effects";
import { simulate, type Trajectory, type Sample, type DebrisTrack } from "./sim/simulate";
import { rockets, type Rocket } from "./rockets";
import { CUSTOM_ROCKET_ID } from "./rockets/validate";
import { earth } from "./world/world";
import { deriveSpec, deriveStages } from "./rockets/parts";
import { initChat } from "./chat";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const { scene, camera, renderer, controls, padTop } = createScene($("app"));
const trail = new Trail();
const spray = new Spray();
const debrisTrails = [new Trail(8000, 0xcccccc), new Trail(8000, 0xcccccc), new Trail(8000, 0xcccccc)];
scene.add(trail.line, spray.points, ...debrisTrails.map((t) => t.line));

// Fake shadow blob so altitude reads visually
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.25, 32),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = padTop + 0.003;
scene.add(shadow);

const windArrow = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, padTop + 0.07, -1.5),
  1,
  0x697084,
  0.24,
  0.14,
);
scene.add(windArrow);

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
const windSpeed = $<HTMLInputElement>("windSpeed");
const windDirection = $<HTMLInputElement>("windDirection");
const windArrowEl = $<HTMLDivElement>("windArrow");
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
bindLabel(windSpeed, "windSpeedVal", (v) => `${v.toFixed(1)} m/s`);
bindLabel(windDirection, "windDirectionVal", (v) => `${Math.round(v)}°`);
bindLabel(speed, "speedVal", (v) => `${v.toFixed(1)}×`);

function updateWindArrow() {
  const directionDeg = parseFloat(windDirection.value);
  const windMps = parseFloat(windSpeed.value);
  const windScale = Math.min(windMps, 5) / 5;
  windArrowEl.style.setProperty("--wind-angle", `${directionDeg}deg`);
  windArrowEl.style.opacity = `${0.45 + windScale * 0.55}`;

  const a = (directionDeg * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const length = 0.8 + windScale * 1.4;
  const center = new THREE.Vector3(0, padTop + 0.07, -1.5);
  windArrow.position.copy(center).addScaledVector(dir, -length / 2);
  windArrow.setDirection(dir);
  windArrow.setLength(length, 0.24, 0.14);
  windArrow.setColor(windMps > 0 ? 0x88e5ff : 0x697084);
}
windSpeed.addEventListener("input", updateWindArrow);
windDirection.addEventListener("input", updateWindArrow);

// --- rocket model ---
let rocketMesh: RocketMesh | null = null;
let currentRocket: Rocket = rockets[0];
/** The one agent-built rocket. Not persisted; replaced on every edit. */
let customRocket: Rocket | null = null;
const UP = new THREE.Vector3(0, 1, 0);

const allRockets = () => (customRocket ? [...rockets, customRocket] : rockets);

function setCustomRocket(rocket: Rocket) {
  customRocket = { ...rocket, id: CUSTOM_ROCKET_ID };
  let opt = rocketSel.querySelector<HTMLOptionElement>(`option[value="${CUSTOM_ROCKET_ID}"]`);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = CUSTOM_ROCKET_ID;
    rocketSel.appendChild(opt);
  }
  opt.textContent = `✦ ${customRocket.name}`;
  rocketSel.value = CUSTOM_ROCKET_ID;
  stopFlight();
  loadRocket();
}

function loadRocket() {
  currentRocket = allRockets().find((r) => r.id === rocketSel.value) ?? rockets[0];
  if (rocketMesh) {
    scene.remove(rocketMesh.root);
    for (const s of rocketMesh.stages) s.group.removeFromParent();
  }
  rocketMesh = buildRocketMesh(currentRocket);
  scene.add(rocketMesh.root);
  $("desc").textContent = currentRocket.description;
  const spec = deriveSpec(currentRocket);
  const stages = deriveStages(currentRocket);
  $("stats").innerHTML =
    `Dry mass <b>${(spec.dryMass * 1000).toFixed(0)} g</b> · Length <b>${spec.length.toFixed(2)} m</b><br>` +
    `Chamber <b>${(spec.chamberVolume * 1000).toFixed(0)} L</b> · Cd <b>${spec.dragCoefficient.toFixed(2)}</b>` +
    (stages.length > 1 ? ` · <b>${stages.length}</b> stages` : "");
  placeOnPad();
}

function placeOnPad() {
  if (!rocketMesh) return;
  rocketMesh.reset();
  const a = (parseFloat(angle.value) * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.sin(a), Math.cos(a), 0);
  rocketMesh.root.position.set(0, padTop, 0);
  rocketMesh.root.quaternion.setFromUnitVectors(UP, dir);
  for (const s of rocketMesh.stages) s.setWater(parseFloat(water.value));
  shadow.position.set(0, padTop + 0.003, 0);
  shadow.scale.setScalar(1);
}

rocketSel.addEventListener("change", () => { stopFlight(); loadRocket(); });
angle.addEventListener("input", () => { if (!flight) placeOnPad(); });
water.addEventListener("input", () => { if (!flight) placeOnPad(); });

// --- flight playback ---
interface Debris { track: DebrisTrack; group: THREE.Group; idx: number; trail: Trail; tumbleAxis: THREE.Vector3 }
interface Flight { traj: Trajectory; t: number; idx: number; done: boolean; debris: Debris[] }
let flight: Flight | null = null;

function stopFlight() {
  flight = null;
  trail.reset();
  spray.reset();
  for (const t of debrisTrails) t.reset();
  placeOnPad();
}

function launch() {
  stopFlight();
  const traj = simulate(currentRocket, earth, {
    pressureBar: parseFloat(pressure.value),
    waterFill: parseFloat(water.value),
    angleDeg: parseFloat(angle.value),
    windSpeed: parseFloat(windSpeed.value),
    windDirectionDeg: parseFloat(windDirection.value),
  });
  flight = { traj, t: 0, idx: 0, done: false, debris: [] };
  const spec = traj.spec;
  const sepLines = traj.separations
    .map((s) => `Stage ${s.stage + 1} away at <b>${s.altitude.toFixed(1)} m</b>, <b>${s.speed.toFixed(0)} m/s</b>, t=${s.t.toFixed(2)} s`)
    .join("<br>");
  $("stats").innerHTML =
    `Apex <b>${traj.apex.toFixed(1)} m</b> · Range <b>${traj.range.toFixed(1)} m</b><br>` +
    `Max speed <b>${traj.maxSpeed.toFixed(1)} m/s</b> · Burn <b>${(traj.burnTime * 1000).toFixed(0)} ms</b><br>` +
    `Wind <b>${parseFloat(windSpeed.value).toFixed(1)} m/s</b> at <b>${parseFloat(windDirection.value).toFixed(0)}°</b><br>` +
    `Flight <b>${traj.flightTime.toFixed(2)} s</b> · Liftoff mass <b>${(traj.liftoffMass * 1000).toFixed(0)} g</b><br>` +
    (sepLines ? `<span style="color:#ffd37a">${sepLines}</span><br>` : "") +
    `<span style="color:#8d98b8">${spec.chamberCount} chamber${spec.chamberCount > 1 ? "s" : ""}, ${traj.stages.length} stage${traj.stages.length > 1 ? "s" : ""}, Cd ${spec.dragCoefficient.toFixed(2)}</span>`;
}
$("launch").addEventListener("click", launch);
window.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
  if (e.code === "Space" && !typing) { e.preventDefault(); launch(); }
});

function sampleAt(samples: Sample[], t: number, hint: number): { s: Sample; idx: number } {
  let i = hint;
  while (i < samples.length - 1 && samples[i + 1].t <= t) i++;
  return { s: samples[i], idx: i };
}

const tmpPos = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const camOffset = new THREE.Vector3();
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (flight && rocketMesh) {
    const rate = parseFloat(speed.value);
    if (!flight.done) flight.t += dt * rate;
    const { s, idx } = sampleAt(flight.traj.samples, flight.t, flight.idx);
    flight.idx = idx;
    if (idx >= flight.traj.samples.length - 1) flight.done = true;

    // Staging: drop stages the sim says are gone
    while (rocketMesh.attachedFrom() < s.stage) {
      const stageIndex = rocketMesh.attachedFrom();
      const group = rocketMesh.detachBottom();
      const track = flight.traj.debris.find((d) => d.stage === stageIndex);
      if (!group || !track) break;
      scene.add(group);
      const axis = new THREE.Vector3(Math.random() - 0.5, 0.1, Math.random() - 0.5).normalize();
      flight.debris.push({ track, group, idx: 0, trail: debrisTrails[flight.debris.length % debrisTrails.length], tumbleAxis: axis });
    }

    tmpPos.set(s.pos[0], s.pos[1] + padTop, s.pos[2]);
    tmpDir.set(s.dir[0], s.dir[1], s.dir[2]);
    rocketMesh.root.position.copy(tmpPos);
    rocketMesh.root.quaternion.setFromUnitVectors(UP, tmpDir);
    for (let i = rocketMesh.attachedFrom(); i < rocketMesh.stages.length; i++) {
      rocketMesh.stages[i].setWater(i === s.stage ? s.waterFraction : parseFloat(water.value));
    }
    trail.push(tmpPos);

    if (s.thrusting) spray.emit(tmpPos, tmpDir, 22, Math.ceil(400 * dt * rate + 4));

    // Falling boosters
    for (const d of flight.debris) {
      if (flight.t < d.track.separationTime) continue;
      const r = sampleAt(d.track.samples, flight.t, d.idx);
      d.idx = r.idx;
      const p = new THREE.Vector3(r.s.pos[0], r.s.pos[1] + padTop, r.s.pos[2]);
      d.group.position.copy(p);
      tmpQ.setFromUnitVectors(UP, new THREE.Vector3(r.s.dir[0], r.s.dir[1], r.s.dir[2]));
      const tumble = new THREE.Quaternion().setFromAxisAngle(d.tumbleAxis, (flight.t - d.track.separationTime) * 4);
      d.group.quaternion.copy(tumble.multiply(tmpQ));
      d.trail.push(p);
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
updateWindArrow();
initChat({ getRocket: () => currentRocket, onRocket: setCustomRocket });
requestAnimationFrame(frame);
