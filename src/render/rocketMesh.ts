import * as THREE from "three";
import type { Rocket, BottleCut } from "../rockets/types";
import { BOTTLE, cutLength } from "../rockets/parts";

export interface RocketMesh {
  group: THREE.Group;
  /** Set remaining water 0..1 to animate the chamber emptying. */
  setWater(fraction: number): void;
  /** Total height in metres, for camera framing. */
  height: number;
}

// --- 2L bottle silhouette, neck at y=0, base at y=height. x = radius. ---
const NECK_R = 0.0135;
const NECK_LEN = 0.022;
const SHOULDER_END = 0.10;
const BODY_END = 0.305;

function fullProfile(): THREE.Vector2[] {
  const R = BOTTLE.radius, H = BOTTLE.height;
  const pts: THREE.Vector2[] = [new THREE.Vector2(NECK_R, 0), new THREE.Vector2(NECK_R, NECK_LEN)];
  const n = 14;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const y = NECK_LEN + t * (SHOULDER_END - NECK_LEN);
    const r = NECK_R + (R - NECK_R) * Math.sin((t * Math.PI) / 2); // convex shoulder
    pts.push(new THREE.Vector2(r, y));
  }
  pts.push(new THREE.Vector2(R, BODY_END));
  const m = 10;
  for (let i = 1; i <= m; i++) {
    const t = i / m;
    const y = BODY_END + t * (H - BODY_END);
    const r = R * Math.sqrt(Math.max(0, 1 - t * t)) * 0.9 + R * 0.1 * (1 - t); // rounded base
    pts.push(new THREE.Vector2(Math.max(r, 0.012), y));
  }
  pts.push(new THREE.Vector2(0.012, H));
  pts.push(new THREE.Vector2(0, H));
  return pts;
}

/** Profile of a cut bottle in *rocket* orientation (y=0 at the bottom of the part). */
function cutProfile(cut: BottleCut, neckUp: boolean): THREE.Vector2[] {
  const full = fullProfile();
  const L = cutLength(cut);
  const H = BOTTLE.height;
  let pts: THREE.Vector2[];
  if (cut === "full") pts = full;
  else if (cut === "top-half") pts = clip(full, 0, L);
  else if (cut === "bottom-half") pts = clip(full, H - L, H).map((p) => new THREE.Vector2(p.x, p.y - (H - L)));
  else pts = [new THREE.Vector2(BOTTLE.radius, 0), new THREE.Vector2(BOTTLE.radius, L)];
  if (neckUp) pts = pts.map((p) => new THREE.Vector2(p.x, L - p.y)).reverse();
  return pts;
}

/** Keep the section of a profile between two heights, interpolating the ends. */
function clip(pts: THREE.Vector2[], y0: number, y1: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const at = (y: number) => {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].y <= y && pts[i].y >= y && pts[i].y !== pts[i - 1].y) {
        const t = (y - pts[i - 1].y) / (pts[i].y - pts[i - 1].y);
        return new THREE.Vector2(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y);
      }
    }
    return pts[pts.length - 1];
  };
  out.push(at(y0));
  for (const p of pts) if (p.y > y0 && p.y < y1) out.push(p);
  out.push(at(y1));
  return out;
}

/** Cumulative volume of a solid of revolution along the profile, for water levels. */
function volumeTable(pts: THREE.Vector2[]): { ys: number[]; vols: number[] } {
  const ys = [pts[0].y], vols = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const h = Math.abs(b.y - a.y);
    const v = (Math.PI / 3) * h * (a.x * a.x + a.x * b.x + b.x * b.x);
    ys.push(b.y);
    vols.push(vols[vols.length - 1] + v);
  }
  return { ys, vols };
}

/**
 * Builds a Three.js model from the parts list. Origin is at the nozzle, +Y is up the rocket.
 * Bottles are lathed from a real 2L silhouette; chambers point neck-down (the nozzle),
 * nose parts point neck-up.
 */
export function buildRocketMesh(rocket: Rocket): RocketMesh {
  const group = new THREE.Group();
  const R = BOTTLE.radius;

  const plastic = new THREE.MeshPhysicalMaterial({
    color: rocket.color, transparent: true, opacity: 0.5, roughness: 0.12, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide, depthWrite: false,
  });
  const tape = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.7, metalness: 0.2 });
  const cap = new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.5 });
  const finMat = new THREE.MeshPhysicalMaterial({
    color: rocket.color, transparent: true, opacity: 0.8, roughness: 0.2, clearcoat: 0.8, side: THREE.DoubleSide,
  });
  const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x2f8fff, transparent: true, opacity: 0.78, roughness: 0.05 });

  interface WaterSlot { mesh: THREE.Mesh; profile: THREE.Vector2[]; table: ReturnType<typeof volumeTable>; last: number }
  const waters: WaterSlot[] = [];
  let y = 0;
  let lastBottleBottom = 0;

  for (const part of rocket.parts) {
    if (part.kind === "bottle") {
      const h = cutLength(part.cut);
      const neckUp = part.role === "nose";
      const profile = cutProfile(part.cut, neckUp);
      const shell = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), plastic);
      shell.position.y = y;
      group.add(shell);

      if (neckUp) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(NECK_R * 1.1, NECK_R * 1.1, 0.016, 24), cap);
        c.position.y = y + h + 0.008;
        group.add(c);
      }
      if (part.role === "chamber") {
        // Water occupies the neck end; shrink the profile slightly so it sits inside the shell.
        const wp = profile.map((p) => new THREE.Vector2(p.x * 0.96, p.y));
        const w = new THREE.Mesh(new THREE.BufferGeometry(), waterMat);
        w.position.y = y;
        group.add(w);
        waters.push({ mesh: w, profile: wp, table: volumeTable(wp), last: -1 });
      }
      if (y > 0) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.035, 48, 1, true), tape);
        band.position.y = y;
        group.add(band);
      }
      lastBottleBottom = y;
      y += h;
    } else {
      // Fins: root sits on the straight body just above the shoulder, swept trailing edge.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(part.span, -part.height * 0.4);
      shape.lineTo(part.span, part.height * 0.2);
      shape.lineTo(0, part.height);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.002, bevelEnabled: false });
      for (let i = 0; i < part.count; i++) {
        const fin = new THREE.Mesh(geo, finMat);
        const pivot = new THREE.Group();
        fin.position.set(R * 0.985, lastBottleBottom + SHOULDER_END * 0.92, -0.001);
        pivot.add(fin);
        pivot.rotation.y = (i / part.count) * Math.PI * 2;
        group.add(pivot);
      }
    }
  }

  const setWater = (fraction: number) => {
    for (const w of waters) {
      if (Math.abs(fraction - w.last) < 0.004 && !(fraction <= 0 && w.last > 0)) continue;
      w.last = fraction;
      if (fraction <= 0.001) { w.mesh.visible = false; continue; }
      w.mesh.visible = true;
      const { ys, vols } = w.table;
      const target = fraction * vols[vols.length - 1];
      let level = ys[ys.length - 1];
      for (let i = 1; i < vols.length; i++) {
        if (vols[i] >= target) {
          const t = (target - vols[i - 1]) / (vols[i] - vols[i - 1] || 1);
          level = ys[i - 1] + (ys[i] - ys[i - 1]) * t;
          break;
        }
      }
      const pts = [new THREE.Vector2(0, w.profile[0].y), ...clip(w.profile, w.profile[0].y, level), new THREE.Vector2(0, level)];
      w.mesh.geometry.dispose();
      w.mesh.geometry = new THREE.LatheGeometry(pts, 40);
    }
  };
  setWater(0.35);

  return { group, setWater, height: y };
}
