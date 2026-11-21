// 한반도 디오라마: 모델(.glb)을 불러오고 그 위에 하늘, 달빛, 구름, 관측지 점수를 얹음
/* global SunCalc */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { project, lonLatToKm, calibrate, fitBox, LON0, LAT0 } from "./geo.js";

const DRACO = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/";

const SKY = {
  day: [new THREE.Color("#f6d9c4"), new THREE.Color("#c9d7ef")],
  dusk: [new THREE.Color("#f3b9a6"), new THREE.Color("#8d86c9")],
  night: [new THREE.Color("#4a4686"), new THREE.Color("#1d1d45")],
};

export class Diorama {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 1, 20000);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, minPolarAngle: 0.35, maxPolarAngle: 1.15, enablePan: true });

    this.sky = this.#makeSky();
    this.hemi = new THREE.HemisphereLight("#cfd6ff", "#6b5a7a", 0.9);
    this.key = new THREE.DirectionalLight("#fff1dc", 1.6); // 해 또는 달
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.radius = 4;
    this.scene.add(this.hemi, this.key, this.key.target);

    this.markers = [];
    this.ray = new THREE.Raycaster();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  // ---------- 모델 ----------
  async load(url) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO);
    loader.setDRACOLoader(draco);
    let root;
    try {
      root = (await loader.loadAsync(url)).scene;
      this.placeholder = false;
    } catch (e) {
      console.info(`${url} 없음, 임시 섬 사용`, e.message);
      root = placeholderIsland();
      this.placeholder = true;
    }
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.scene.add(root);
    this.root = root;
    root.updateMatrixWorld(true);
    this.box = new THREE.Box3().setFromObject(root);
    this.size = this.box.getSize(new THREE.Vector3());
    this.center = this.box.getCenter(new THREE.Vector3());

    // 관측지 빈 오브젝트로 좌표 보정
    this.anchors = {};
    root.traverse((o) => {
      const m = /^site_(.+)$/.exec(o.name);
      if (m) this.anchors[m[1]] = o.getWorldPosition(new THREE.Vector3());
    });
    this.terrain = [];
    root.traverse((o) => o.isMesh && this.terrain.push(o));

    this.#frame();
    this.#makeStars();
    this.#makeMoon();
    this.#makeClouds();
    return this;
  }

  calibrateWith(sites) {
    const pairs = sites
      .filter((s) => this.anchors[s.id])
      .map((s) => ({ km: lonLatToKm(s.lon, s.lat), model: { x: this.anchors[s.id].x, z: this.anchors[s.id].z } }));
    const ok = calibrate(pairs);
    if (!ok && !this.placeholder) fitBox(this.box);
    console.info(ok ? `관측지 ${pairs.length}곳으로 좌표 보정` : "관측지 이름 없음, 섬 크기로 대략 맞춤");
  }

  // 위경도 → 지면 위 점 (위에서 아래로 광선을 쏴서 높이 찾기)
  ground(lon, lat) {
    const { x, z } = project(lon, lat);
    const top = this.box.max.y + 100;
    this.ray.set(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0));
    const hit = this.ray.intersectObjects(this.terrain, false)[0];
    return new THREE.Vector3(x, hit ? hit.point.y : this.box.max.y * 0.3, z);
  }

  #frame() {
    const r = Math.max(this.size.x, this.size.z);
    this.radius = r;
    this.controls.target.copy(this.center);
    this.controls.minDistance = r * 0.5;
    this.controls.maxDistance = r * 4;
    // 비스듬한 위에서 (남동쪽)
    this.camera.position.copy(this.center).add(new THREE.Vector3(r * 0.95, r * 1.05, r * 1.55));
    this.camera.near = r / 200;
    this.camera.far = r * 20;
    this.camera.updateProjectionMatrix();
    const sc = this.key.shadow.camera;
    Object.assign(sc, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 6 });
    sc.updateProjectionMatrix();
    this.sky.scale.setScalar(r * 8);
  }

  // ---------- 하늘 ----------
  #makeSky() {
    const geo = new THREE.SphereGeometry(1, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { bottom: { value: new THREE.Color() }, top: { value: new THREE.Color() } },
      vertexShader: "varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader:
        "uniform vec3 bottom; uniform vec3 top; varying vec3 p; void main(){ float h = smoothstep(-0.25, 0.75, p.y); gl_FragColor = vec4(mix(bottom, top, h), 1.); }",
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -1;
    this.scene.add(m);
    return m;
  }

  #makeStars() {
    const n = 900;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const th = rnd() * Math.PI * 2;
      const y = 0.15 + rnd() * 0.85;
      const rr = Math.sqrt(1 - y * y);
      const R = this.radius * 7;
      pos.set([Math.cos(th) * rr * R + this.center.x, y * R, Math.sin(th) * rr * R + this.center.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: "#fff6dd", size: 2.2, sizeAttenuation: false, transparent: true, depthWrite: false }));
    this.scene.add(this.stars);
  }

  #makeMoon() {
    const r = this.radius;
    this.moon = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r * 0.06, 32, 16), new THREE.MeshBasicMaterial({ color: "#fff4d6" }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture("rgba(255,240,200,0.55)"), depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(r * 0.45);
    this.moon.add(glow, ball);
    this.moonBall = ball;
    this.scene.add(this.moon);
  }

  // ---------- 시각 ----------
  setTime(date) {
    const sun = SunCalc.getPosition(date, LAT0, LON0);
    const mp = SunCalc.getMoonPosition(date, LAT0, LON0);
    const il = SunCalc.getMoonIllumination(date).fraction;
    const sunAlt = (sun.altitude * 180) / Math.PI;
    const t = THREE.MathUtils.smoothstep(sunAlt, -14, 4); // 0 밤 → 1 낮
    const dusk = 1 - Math.abs(t - 0.5) * 2;
    const [b, tp] = [new THREE.Color(), new THREE.Color()];
    if (t < 0.5) {
      b.lerpColors(SKY.night[0], SKY.dusk[0], t * 2);
      tp.lerpColors(SKY.night[1], SKY.dusk[1], t * 2);
    } else {
      b.lerpColors(SKY.dusk[0], SKY.day[0], (t - 0.5) * 2);
      tp.lerpColors(SKY.dusk[1], SKY.day[1], (t - 0.5) * 2);
    }
    this.sky.material.uniforms.bottom.value.copy(b);
    this.sky.material.uniforms.top.value.copy(tp);
    this.stars.material.opacity = 1 - t;

    // 달: SunCalc 방위각은 남쪽 기준 시계방향
    const dir = (az, alt) =>
      new THREE.Vector3(-Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));
    const md = dir(mp.azimuth, Math.max(mp.altitude, -0.05));
    this.moon.position.copy(this.center).addScaledVector(md, this.radius * 3.2);
    this.moon.visible = mp.altitude > -0.05;
    this.moonBall.material.color.set(il > 0.5 ? "#fff4d6" : "#f2e6c8");
    this.moon.scale.setScalar(0.6 + 0.4 * il);

    // 주 조명: 낮이면 해, 밤이면 달 (달 밝기에 비례)
    const night = t < 0.35;
    const src = night ? md : dir(sun.azimuth, Math.max(sun.altitude, 0.08));
    this.key.position.copy(this.center).addScaledVector(src, this.radius * 2.5);
    this.key.target.position.copy(this.center);
    this.key.color.set(night ? "#c9d4ff" : dusk > 0.4 ? "#ffc89a" : "#fff1dc");
    this.key.intensity = night ? (mp.altitude > 0 ? 0.25 + 1.5 * il : 0.12) : 1.2 + 0.6 * t;
    this.hemi.color.lerpColors(new THREE.Color("#7c7fd0"), new THREE.Color("#e8ecff"), t);
    this.hemi.groundColor.lerpColors(new THREE.Color("#2f2850"), new THREE.Color("#8b765f"), t);
    this.hemi.intensity = 0.55 + 0.6 * t;
    this.lanternOn = 1 - t;
    for (const m of this.markers) m.glow.material.opacity = 0.35 + 0.65 * this.lanternOn;
  }

  // ---------- 구름 ----------
  #makeClouds() {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: "#f4f1ff", roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
    this.cloudMesh = new THREE.InstancedMesh(geo, mat, 4000);
    this.cloudMesh.castShadow = true;
    this.cloudMesh.count = 0;
    this.scene.add(this.cloudMesh);
  }

  // field: 행(북→남) × 열(서→동) 평탄 배열, 0~100
  setClouds(field, lats, lons) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const step = Math.abs(lons[1] - lons[0]);
    const cell = Math.abs(project(lons[0] + step, lats[0]).x - project(lons[0], lats[0]).x);
    const base = this.box.max.y + this.radius * 0.05;
    let k = 0;
    for (let r = 0; r < lats.length; r++) {
      for (let c = 0; c < lons.length; c++) {
        const v = field?.[r * lons.length + c];
        if (v == null || v < 15) continue;
        const puffs = Math.round(1 + (v / 100) * 5);
        for (let p = 0; p < puffs && k < 4000; p++) {
          const h = hash(r * 131 + c * 17 + p * 7);
          const lon = lons[c] + (h[0] - 0.5) * step;
          const lat = lats[r] + (h[1] - 0.5) * step;
          const { x, z } = project(lon, lat);
          const s = cell * (0.22 + 0.3 * (v / 100)) * (0.6 + 0.6 * h[2]);
          m.compose(new THREE.Vector3(x, base + h[2] * cell * 0.2, z), q.setFromEuler(new THREE.Euler(0, h[0] * 6, 0)), new THREE.Vector3(s, s * 0.62, s));
          this.cloudMesh.setMatrixAt(k++, m);
        }
      }
    }
    this.cloudMesh.count = k;
    this.cloudMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- 관측지 ----------
  // sites: [{ id, name, lat, lon, primary, score }]
  setSites(sites) {
    for (const m of this.markers) {
      this.scene.remove(m.glow);
      m.el.remove();
    }
    this.markers = sites.map((s) => {
      const p = this.anchors[s.id]?.clone() ?? this.ground(s.lon, s.lat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture("rgba(255,196,120,0.9)"), depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(this.radius * (s.primary ? 0.07 : 0.045));
      glow.position.copy(p).add(new THREE.Vector3(0, this.radius * 0.01, 0));
      this.scene.add(glow);
      const el = document.createElement("div");
      el.className = "pin" + (s.primary ? " primary" : "");
      el.innerHTML = `<b style="--c:${scoreHex(s.score)}">${s.score ?? "-"}</b><span>${s.name}</span>`;
      this.overlay.append(el);
      return { s, p, glow, el };
    });
  }

  // ---------- 그리기 ----------
  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    const v = new THREE.Vector3();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      for (const m of this.markers) {
        v.copy(m.p).project(this.camera);
        m.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        m.el.style.display = v.z < 1 ? "" : "none";
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
}

// ---------- 도움 함수 ----------
function hash(n) {
  const f = (k) => {
    const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return [f(1), f(2), f(3)];
}

function radialTexture(inner) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function scoreHex(score) {
  if (score == null) return "#a8a3b8";
  return score >= 70 ? "#7fbf7a" : score >= 40 ? "#e8b85c" : "#e0857a";
}

// 모델이 없을 때 보여 줄 임시 섬 (남한 윤곽을 대충 두껍게 뽑아냄)
const OUTLINE = [
  [126.1, 37.7], [126.7, 37.95], [127.1, 38.3], [128.0, 38.33], [128.35, 38.6], [129.35, 37.4],
  [129.45, 36.5], [129.55, 35.6], [129.2, 35.15], [128.6, 34.85], [127.8, 34.55], [127.3, 34.45],
  [126.5, 34.3], [126.25, 34.7], [126.4, 35.3], [126.6, 35.9], [126.4, 36.5], [126.15, 36.9], [126.6, 37.3], [126.1, 37.7],
];
function placeholderIsland() {
  const g = new THREE.Group();
  const shape = new THREE.Shape(OUTLINE.map(([lo, la]) => {
    const p = lonLatToKm(lo, la);
    return new THREE.Vector2(p.x, -p.z);
  }));
  const soil = new THREE.ExtrudeGeometry(shape, { depth: 26, bevelEnabled: true, bevelSize: 6, bevelThickness: 6, bevelSegments: 4, curveSegments: 4 });
  soil.rotateX(-Math.PI / 2);
  soil.translate(0, -30, 0);
  const grass = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: true, bevelSize: 6, bevelThickness: 3, bevelSegments: 4 });
  grass.rotateX(-Math.PI / 2);
  g.add(new THREE.Mesh(soil, new THREE.MeshStandardMaterial({ color: "#a27b5c", roughness: 1 })));
  g.add(new THREE.Mesh(grass, new THREE.MeshStandardMaterial({ color: "#9cc48a", roughness: 0.95 })));
  // 제주
  const j = lonLatToKm(126.55, 33.38);
  const jeju = new THREE.Mesh(new THREE.CylinderGeometry(20, 16, 22, 24), new THREE.MeshStandardMaterial({ color: "#9cc48a", roughness: 1 }));
  jeju.scale.set(1.9, 1, 1);
  jeju.position.set(j.x, -8, j.z);
  g.add(jeju);
  g.name = "island";
  return g;
}


