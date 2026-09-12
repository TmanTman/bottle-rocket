import * as THREE from "three";

/** Growing line behind the rocket. */
export class Trail {
  readonly line: THREE.Line;
  private positions: Float32Array;
  private count = 0;
  constructor(max = 20000, color = 0xffffff) {
    this.positions = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, 0);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false;
  }
  reset() {
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
  }
  push(p: THREE.Vector3) {
    if ((this.count + 1) * 3 > this.positions.length) return;
    this.positions.set([p.x, p.y, p.z], this.count * 3);
    this.count++;
    this.line.geometry.setDrawRange(0, this.count);
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Simple water spray: a pool of points ejected from the nozzle. */
export class Spray {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  private readonly n: number;
  constructor(n = 3000) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xbfe6ff, size: 0.035, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.reset();
  }
  reset() {
    this.life.fill(0);
    this.pos.fill(1e6);
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  /** Emit particles from `origin` travelling along `-dir` at roughly `speed` m/s. */
  emit(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, count: number) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const spread = 0.18;
      const vx = -dir.x * speed + (Math.random() - 0.5) * speed * spread;
      const vy = -dir.y * speed + (Math.random() - 0.5) * speed * spread;
      const vz = -dir.z * speed + (Math.random() - 0.5) * speed * spread;
      this.pos.set([origin.x, origin.y, origin.z], i * 3);
      this.vel.set([vx, vy, vz], i * 3);
      this.life[i] = 0.35 + Math.random() * 0.35;
    }
  }
  update(dt: number, gravity: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= gravity * dt;
      this.vel[j] *= 0.985; this.vel[j + 1] *= 0.985; this.vel[j + 2] *= 0.985;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0) { this.pos[j + 1] = 0; this.vel[j + 1] = 0; }
      if (this.life[i] <= 0) this.pos.set([1e6, 1e6, 1e6], j);
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
