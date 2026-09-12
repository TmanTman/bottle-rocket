import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  padTop: number;
}

export function createScene(container: HTMLElement): SceneBundle {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8fb8e8, 60, 400);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
  camera.position.set(1.1, 0.7, 1.9);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.target.set(0, 0.35, 0);

  // Sky dome
  const skyGeo = new THREE.SphereGeometry(900, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x1f4fa8) },
      mid: { value: new THREE.Color(0x6fa8e6) },
      bottom: { value: new THREE.Color(0xe8f0f7) },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vPos;
      void main(){
        float h = normalize(vPos).y;
        vec3 c = h < 0.15 ? mix(bottom, mid, smoothstep(-0.05, 0.15, h)) : mix(mid, top, smoothstep(0.15, 0.9, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Lights
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a6a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
  sun.position.set(40, 80, 20);
  scene.add(sun);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(600, 64),
    new THREE.MeshStandardMaterial({ color: 0x6f9a52, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(400, 80, 0xffffff, 0xffffff);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.18;
  grid.position.y = 0.002;
  scene.add(grid);

  // Distance rings every 10 m
  for (let r = 10; r <= 150; r += 10) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.06, r + 0.06, 128),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: r % 50 === 0 ? 0.55 : 0.25, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    scene.add(ring);
  }

  // Launch pad: concrete slab + guide rod
  const padTop = 0.06;
  const slab = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.55, padTop, 48),
    new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9 }),
  );
  slab.position.y = padTop / 2;
  scene.add(slab);
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.25, 12),
    new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.3 }),
  );
  rod.position.y = padTop + 0.125;
  scene.add(rod);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener("resize", resize);
  resize();

  return { scene, camera, renderer, controls, padTop };
}
