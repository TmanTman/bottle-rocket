import * as THREE from "three";
import type { Rocket } from "../rockets/types";
import { BOTTLE, cutLength } from "../rockets/parts";

export interface RocketMesh {
  group: THREE.Group;
  /** Set remaining water 0..1 to animate the chamber emptying. */
  setWater(fraction: number): void;
  /** Total height in metres, for camera framing. */
  height: number;
}

/**
 * Builds a Three.js model from the parts list. Origin is at the nozzle, +Y is up the rocket.
 * Every part is a cylinder/cone with 2L-bottle dimensions, so the model always matches the spec.
 */
export function buildRocketMesh(rocket: Rocket): RocketMesh {
  const group = new THREE.Group();
  const R = BOTTLE.radius;
  const rn = BOTTLE.neckRadius;

  const plastic = new THREE.MeshPhysicalMaterial({
    color: rocket.color,
    transparent: true,
    opacity: 0.55,
    roughness: 0.15,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    side: THREE.DoubleSide,
  });
  const tape = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.7, metalness: 0.2 });
  const finMat = new THREE.MeshPhysicalMaterial({
    color: rocket.color, transparent: true, opacity: 0.75, roughness: 0.2, clearcoat: 0.8, side: THREE.DoubleSide,
  });
  const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.7, roughness: 0.05 });

  const waters: { mesh: THREE.Mesh; fullHeight: number; base: number }[] = [];
  let y = 0;
  let lastBottleBottom = 0;
  let lastBottleHeight = 0;

  for (const part of rocket.parts) {
    if (part.kind === "bottle") {
      const h = cutLength(part.cut);
      const shoulder = Math.min(0.09, h * 0.3); // tapered section near the neck
      const body = h - shoulder;

      if (part.cut === "full" || part.cut === "body-tube" || part.cut === "bottom-half") {
        const straight = part.cut === "full" ? body : h;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(R, R, straight, 40, 1, part.cut === "body-tube"), plastic);
        // chamber: neck down, so straight body sits above the shoulder
        const straightY = part.cut === "full" ? y + shoulder + straight / 2 : y + straight / 2;
        cyl.position.y = straightY;
        group.add(cyl);

        if (part.cut === "full") {
          const cone = new THREE.Mesh(new THREE.CylinderGeometry(R, rn, shoulder, 40, 1, true), plastic);
          cone.position.y = y + shoulder / 2;
          group.add(cone);
        }
        if (part.role === "chamber") {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.97, R * 0.97, 1, 32), waterMat);
          group.add(w);
          waters.push({ mesh: w, fullHeight: h * 0.85, base: y + shoulder * 0.6 });
        }
      } else {
        // top-half used as a nose cone: neck up
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(rn, R, h * 0.6, 40, 1, true), plastic);
        cone.position.y = y + h * 0.4 + h * 0.3;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(R, R, h * 0.4, 40, 1, true), plastic);
        cyl.position.y = y + h * 0.2;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(rn * 1.15, rn * 1.15, 0.02, 24), tape);
        cap.position.y = y + h + 0.01;
        group.add(cone, cyl, cap);
      }

      // Tape band at each joint above the first part
      if (y > 0) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.03, 40, 1, true), tape);
        band.position.y = y;
        group.add(band);
      }
      lastBottleBottom = y;
      lastBottleHeight = h;
      y += h;
    } else {
      // Fins attach to the lower part of the previous bottle, trapezoid shape
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(part.span, -part.height * 0.35);
      shape.lineTo(part.span, part.height * 0.25);
      shape.lineTo(0, part.height);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.002, bevelEnabled: false });
      for (let i = 0; i < part.count; i++) {
        const fin = new THREE.Mesh(geo, finMat);
        const pivot = new THREE.Group();
        fin.position.set(R * 0.98, lastBottleBottom + Math.min(lastBottleHeight * 0.3, 0.09) + part.height * 0.35, -0.001);
        pivot.add(fin);
        pivot.rotation.y = (i / part.count) * Math.PI * 2;
        group.add(pivot);
      }
    }
  }

  const setWater = (fraction: number) => {
    for (const w of waters) {
      const hh = Math.max(0.0005, w.fullHeight * fraction);
      w.mesh.scale.y = hh;
      w.mesh.position.y = w.base + hh / 2;
      w.mesh.visible = fraction > 0.001;
    }
  };
  setWater(0.35);

  return { group, setWater, height: y };
}
