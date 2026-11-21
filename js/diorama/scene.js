// 한반도 디오라마: 모델(.glb)을 불러오고 그 위에 하늘, 달빛, 구름, 관측지 점수를 얹음
/* global SunCalc */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { project, lonLatToKm, calibrate, fitBox, LON0, LAT0 } from "./geo.js";
import { moonLighting } from "./moon.js";

const DRACO = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/";

const SKY = {
  day: [new THREE.Color("#f6d9c4"), new THREE.Color("#c9d7ef")],
  dusk: [new THREE.Color("#f3b9a6"), new THREE.Color("#8d86c9")],
  night: [new THREE.Color("#4a4686"), new THREE.Color("#1d1d45")],
};

export class Diorama {
  constructor(canvas, overlay, moon) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.moon = moon;
    this.waterTime = { value: 0 };
    this.showClouds = true;
    this.hasClouds = false;
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
        o.castShadow = o.name !== "water";
        o.receiveShadow = true;
        if (o.name === "water" && o.material?.isMeshStandardMaterial) this.#surfaceWater(o.material);
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
    this.moonOrigin = this.ground(LON0, LAT0);
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
    this.controls.minDistance = r * 0.5;
    this.controls.maxDistance = r * 6;
    const view = new THREE.Vector3(0.54, 0.82, 1.42).normalize();
    this.camera.position.copy(this.center).add(view);
    this.camera.lookAt(this.center);
    const rotation = this.camera.quaternion;
    const inverse = rotation.clone().invert();
    const samples = [];
    const water = this.root.getObjectByName("water");
    const positions = water?.geometry?.getAttribute("position");
    const collect = (x, y, z) => samples.push(new THREE.Vector3(x, y, z).sub(this.center).applyQuaternion(inverse));
    if (positions) {
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(water.matrixWorld);
        collect(point.x, this.box.min.y, point.z);
        collect(point.x, this.box.max.y, point.z);
      }
    } else {
      for (const x of [this.box.min.x, this.box.max.x]) for (const y of [this.box.min.y, this.box.max.y]) {
        for (const z of [this.box.min.z, this.box.max.z]) collect(x, y, z);
      }
    }
    const frame = new THREE.Box3().setFromPoints(samples);
    const middle = frame.getCenter(new THREE.Vector3());
    const target = this.center.clone().add(new THREE.Vector3(middle.x, middle.y, 0).applyQuaternion(rotation));
    const slopeY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.75;
    const slopeX = slopeY * this.camera.aspect;
    const distance = Math.max(...samples.map((p) => p.z + Math.max(Math.abs(p.x - middle.x) / slopeX,
      Math.abs(p.y - middle.y) / slopeY)));
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(view, distance);
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

  #surfaceWater(material) {
    material.roughness = 0.34;
    material.depthWrite = false;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.waterTime = this.waterTime;
      shader.vertexShader = `varying vec2 waterXZ;\n${shader.vertexShader}`.replace("#include <begin_vertex>",
        "#include <begin_vertex>\nwaterXZ = (modelMatrix * vec4(position, 1.0)).xz;");
      shader.fragmentShader = `uniform float waterTime;\nvarying vec2 waterXZ;\n${shader.fragmentShader}`
        .replace("#include <color_fragment>", `#include <color_fragment>
          float swell = sin(dot(waterXZ, vec2(0.036, 0.042))) * cos(dot(waterXZ, vec2(0.058, -0.029)));
          diffuseColor.rgb *= 0.97 + 0.07 * swell;`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          float gust = 1.7 * sin(dot(waterXZ, vec2(0.041, -0.062)));
          float swellLine = dot(waterXZ, vec2(0.64, 0.24)) + gust - waterTime;
          float crossLine = dot(waterXZ, vec2(-0.19, 0.52)) - 0.7 * gust + waterTime * 0.58;
          vec2 waves = vec2(0.82, 0.31) * cos(swellLine) + vec2(-0.14, 0.36) * cos(crossLine);
          normal = normalize(normal + mat3(viewMatrix) * vec3(waves.x, 0.0, waves.y) * 0.061);
          float grazing = 1.0 - abs(dot(normal, normalize(vViewPosition)));
          diffuseColor.a *= 0.86 + 0.24 * grazing * grazing * grazing;`);
    };
  }

  #makeMoon() {
    this.moonTexture = new THREE.CanvasTexture(this.moon.querySelector("canvas"));
    this.moonTexture.colorSpace = THREE.SRGBColorSpace;
    this.moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.moonTexture, transparent: true,
      depthWrite: false, toneMapped: false }));
    this.moonDisc.scale.setScalar(this.radius * 0.122);
    this.moonDisc.visible = false;
    this.moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture("rgba(255,223,166,0.21)"),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.moonGlow.scale.setScalar(this.radius * 0.30);
    this.moonGlow.visible = false;
    this.moonGlow.renderOrder = 3;
    this.moonDisc.renderOrder = 4;
    this.moonBeam = new THREE.SpotLight("#becbff", 0, this.radius * 0.9, Math.PI / 3, 0.78, 2);
    this.scene.add(this.moonGlow, this.moonDisc, this.moonBeam, this.moonBeam.target);
  }

  #showMoon(position, illumination) {
    const altitude = THREE.MathUtils.radToDeg(position.altitude);
    const bearing = (THREE.MathUtils.radToDeg(position.azimuth) + 540) % 360;
    const directions = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
    const direction = directions[Math.round(bearing / 45) % 8];
    const light = moonLighting(position, illumination);
    const phase = `${light.name} ${Math.round(illumination.fraction * 100)}%`;
    this.moonCaption = altitude < 0
      ? `${phase} · 지평선 아래`
      : `${phase} · ${direction} ${Math.round(bearing) % 360}° · 고도 ${Math.round(altitude)}°`;
    const canvas = this.moon.querySelector("canvas");
    canvas.setAttribute("aria-label", `달의 위상 ${phase}`);
    const ctx = canvas.getContext("2d");
    const n = canvas.width;
    const pixels = ctx.createImageData(n, n);
    const craters = [[-0.22, 0.30, 0.093], [0.29, 0.18, 0.11], [0.51, -0.28, 0.078],
                     [-0.49, -0.31, 0.064], [0.07, 0.63, 0.071]];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x - n / 2) / (n * 0.43), v = (y - n / 2) / (n * 0.43);
      const r2 = u * u + v * v;
      if (r2 >= 1) continue;
      const sun = u * light.x + v * light.y + Math.sqrt(1 - r2) * light.z;
      const lit = THREE.MathUtils.smoothstep(sun, -0.017, 0.017);
      const diffuse = lit * (0.60 + 0.40 * Math.sqrt(Math.max(0, sun)));
      const maria = -0.10 * Math.exp(-12 * (u + 0.22) ** 2 - 5 * (v + 0.27) ** 2)
        - 0.095 * Math.exp(-10 * (u - 0.24) ** 2 - 18 * (v + 0.09) ** 2)
        - 0.07 * Math.exp(-17 * (u + 0.09) ** 2 - 26 * (v - 0.43) ** 2);
      let relief = 0.10 * (cloudNoise(x / 5, y / 5) - 0.50);
      for (const [cx, cy, radius] of craters) {
        const d = Math.hypot(u - cx, v - cy) / radius;
        if (d < 1.45) relief += 0.09 * Math.exp(-23 * (d - 1) ** 2) - 0.07 * Math.exp(-3 * d * d);
      }
      const tone = Math.max(0, diffuse * (1.0 + 0.08 * (1 - r2) + maria + relief));
      const i = (y * n + x) * 4;
      pixels.data.set([38 + 215 * tone, 44 + 199 * tone, 72 + 146 * tone,
        (75 + 180 * lit) * THREE.MathUtils.clamp((1 - r2) * n / 4, 0, 1)], i);
    }
    ctx.putImageData(pixels, 0, 0);
    this.moonTexture.needsUpdate = true;
  }

  // ---------- 시각 ----------
  setTime(date) {
    this.time = date;
    const sun = SunCalc.getPosition(date, LAT0, LON0);
    const mp = SunCalc.getMoonPosition(date, LAT0, LON0);
    const moon = SunCalc.getMoonIllumination(date);
    const il = moon.fraction;
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
    this.cloudMesh.material.color.set("#aebbdc").lerp(new THREE.Color("#fff8f1"), t);

    // 달: SunCalc 방위각은 남쪽 기준 시계방향
    const dir = (az, alt) =>
      new THREE.Vector3(-Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));
    const origin = this.moonOrigin ?? this.center;
    const moonDirection = dir(mp.azimuth, mp.altitude);
    this.#showMoon(mp, moon);
    this.moonDisc.position.copy(origin).addScaledVector(moonDirection, this.radius * 0.31);
    this.moonDisc.visible = mp.altitude > 0;
    this.moonGlow.position.copy(this.moonDisc.position);
    this.moonBeam.position.copy(this.moonDisc.position);
    this.moonBeam.target.position.copy(origin);
    this.moonGlow.visible = this.moonDisc.visible && t < 0.55;
    this.moonGlow.material.opacity = il * (1 - t);
    const aboveHorizon = THREE.MathUtils.smoothstep(mp.altitude, 0, 0.21);
    this.moonBeam.intensity = (this.radius * 0.31) ** 2 * 0.92 * il * aboveHorizon * (1 - t) ** 2;

    // 주 조명: 낮이면 해, 밤이면 달 (달 밝기에 비례)
    const night = t < 0.35;
    // 실제 달의 방위는 유지하고 그림자가 읽히도록 광원의 고도만 낮춘다.
    const shadowAltitude = Math.atan(Math.tan(mp.altitude) * 0.64);
    const src = night && mp.altitude > 0 ? dir(mp.azimuth, Math.max(shadowAltitude, 0.017)) : dir(sun.azimuth, Math.max(sun.altitude, 0.08));
    const shadowCenter = this.shadowFocus ?? origin;
    this.key.position.copy(shadowCenter).addScaledVector(src, this.radius * 2.5);
    this.key.target.position.copy(shadowCenter);
    this.key.color.set(night ? "#c9d4ff" : dusk > 0.4 ? "#ffc89a" : "#fff1dc");
    this.key.intensity = night ? (mp.altitude > 0 ? 0.25 + 1.25 * il : 0) : 1.2 + 0.6 * t;
    this.key.castShadow = !night || mp.altitude > 0;
    this.hemi.color.lerpColors(new THREE.Color("#7c7fd0"), new THREE.Color("#e8ecff"), t);
    this.hemi.groundColor.lerpColors(new THREE.Color("#55486b"), new THREE.Color("#8b765f"), t);
    this.hemi.intensity = 0.67 + 0.48 * t;
    this.lanternOn = 1 - t;
    for (const m of this.markers) m.glow.material.opacity = 0.14 + 0.50 * this.lanternOn;
  }

  // ---------- 구름 ----------
  #makeClouds() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 360;
    this.cloudContext = canvas.getContext("2d");
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 0.72 });
    this.cloudMesh = new THREE.Mesh(geo, mat);
    this.cloudMesh.visible = false;
    this.cloudMesh.renderOrder = 2;
    this.scene.add(this.cloudMesh);
  }

  // field: 행(북→남) × 열(서→동) 평탄 배열, 0~100
  setClouds(field, lats, lons) {
    this.hasClouds = Boolean(field?.some((v) => v > 8)) && lats.length > 1 && lons.length > 1;
    this.cloudMesh.visible = this.showClouds && this.hasClouds;
    if (!this.hasClouds) return;
    const west = lons[0], east = lons.at(-1), north = lats[0], south = lats.at(-1);
    const pos = this.cloudMesh.geometry.getAttribute("position");
    [[west, north], [east, north], [east, south], [west, south]].forEach(([lon, lat], i) => {
      const { x, z } = project(lon, lat);
      pos.setXYZ(i, x, this.box.max.y + 13, z);
    });
    pos.needsUpdate = true;
    this.cloudMesh.geometry.computeBoundingSphere();

    const context = this.cloudContext;
    const w = context.canvas.width, h = context.canvas.height;
    const image = context.createImageData(w, h);
    const sample = (row, col) => (field[row * lons.length + col] ?? 0) / 100;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = x * (lons.length - 1) / (w - 1), gy = y * (lats.length - 1) / (h - 1);
      const i = Math.min(lons.length - 2, Math.floor(gx)), j = Math.min(lats.length - 2, Math.floor(gy));
      const coverage = THREE.MathUtils.lerp(THREE.MathUtils.lerp(sample(j, i), sample(j, i + 1), gx - i),
        THREE.MathUtils.lerp(sample(j + 1, i), sample(j + 1, i + 1), gx - i), gy - j);
      const broad = cloudNoise(x / 27 + y / 154, y / 23);
      const detail = cloudNoise(x / 10, y / 8);
      const wisps = cloudNoise(x / 4 + y / 81, y / 3.2);
      const cloud = broad * 0.60 + detail * 0.29 + wisps * 0.11;
      const threshold = 1.03 - 0.78 * coverage;
      const fade = THREE.MathUtils.smoothstep(Math.min(x, w - 1 - x, y, h - 1 - y), 1, 31);
      const opacity = THREE.MathUtils.smoothstep(cloud, threshold - 0.04, threshold + 0.18) * fade * (0.16 + 0.36 * coverage);
      const gray = 210 + 38 * broad + 7 * detail;
      const offset = (y * w + x) * 4;
      image.data.set([gray, gray + 2, gray + 8, 255 * opacity], offset);
    }
    context.putImageData(image, 0, 0);
    this.cloudMesh.material.map.needsUpdate = true;
  }

  setCloudVisibility(visible) {
    this.showClouds = visible;
    this.cloudMesh.visible = visible && this.hasClouds;
  }

  resetView() {
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.#frame();
    this.shadowFocus = undefined;
    if (this.time) this.setTime(this.time);
    this.controls.update();
    this.controls.enableDamping = damping;
  }

  focusSite(site) {
    const point = this.anchors[site.id]?.clone() ?? this.ground(site.lon, site.lat);
    const view = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.minDistance = this.radius * 0.016;
    this.controls.target.copy(point).y += 1.0;
    this.camera.position.copy(this.controls.target).addScaledVector(view, this.radius * 0.039);
    this.controls.update();
    this.shadowFocus = point;
    const shadow = this.key.shadow.camera;
    const span = this.radius * 0.13;
    Object.assign(shadow, { left: -span, right: span, top: span, bottom: -span });
    shadow.updateProjectionMatrix();
    if (this.time) this.setTime(this.time);
  }

  // ---------- 관측지 ----------
  // sites: [{ id, name, lat, lon, primary, score }]
  setSites(sites) {
    const previous = new Map(this.markers.map((marker) => [marker.s.id, marker]));
    this.markers = sites.map((s) => {
      const existing = previous.get(s.id);
      if (existing) {
        previous.delete(s.id);
        existing.s = s;
        existing.badge.textContent = s.score ?? "–";
        existing.badge.style.setProperty("--c", scoreHex(s.score));
        return existing;
      }
      const p = this.anchors[s.id]?.clone() ?? this.ground(s.lon, s.lat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture("rgba(255,193,123,0.38)"),
        opacity: 0.14 + 0.50 * (this.lanternOn ?? 0), depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(this.radius * (s.primary ? 0.023 : 0.016));
      glow.position.copy(p).add(new THREE.Vector3(0, 2.4, 0));
      this.scene.add(glow);
      const el = document.createElement("button");
      const stem = document.createElement("span");
      stem.className = "pin-stem";
      stem.setAttribute("aria-hidden", "true");
      el.type = "button";
      el.dataset.site = s.id;
      el.setAttribute("aria-controls", this.overlay.dataset.controls || "site-detail");
      el.className = "pin" + (s.primary ? " primary" : "");
      const badge = document.createElement("b");
      badge.textContent = s.score ?? "–";
      badge.style.setProperty("--c", scoreHex(s.score));
      const name = document.createElement("span");
      name.textContent = s.name;
      el.append(badge, name);
      this.overlay.append(stem, el);
      return { s, p, glow, el, badge, stem };
    });
    for (const marker of previous.values()) {
      this.scene.remove(marker.glow);
      marker.glow.material.map.dispose();
      marker.glow.material.dispose();
      marker.stem.remove();
      marker.el.remove();
    }
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
    const localMoon = new THREE.Vector3();
    const caption = this.moon.querySelector("span");
    const loop = (now = 0) => {
      this.controls.update();
      this.waterTime.value = now * 0.00065;
      this.renderer.render(this.scene, this.camera);
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      const placed = [];
      if (this.moonCaption) {
        v.copy(this.moonDisc.position).project(this.camera);
        const inView = this.moonDisc.visible && v.z > -1 && v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
        const text = `${this.moonCaption}${this.moonDisc.visible && !inView ? " · 시야 밖" : ""}`;
        if (caption.textContent !== text) caption.textContent = text;
        this.moon.hidden = false;
        this.moon.toggleAttribute("data-status", !inView);
        if (inView) {
          localMoon.copy(this.moonDisc.position).applyMatrix4(this.camera.matrixWorldInverse);
          const radiusPx = this.moonDisc.scale.x * h * 0.23 / (-localMoon.z * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
          const x = (v.x + 1) * w / 2, y = (1 - v.y) * h / 2;
          this.moon.style.left = `${THREE.MathUtils.clamp(x, 75, Math.max(75, w - 75))}px`;
          this.moon.style.top = `${THREE.MathUtils.clamp(y + radiusPx + 8, 12, Math.max(12, h - 24))}px`;
          placed.push({ x: x - radiusPx, y: y - radiusPx, w: 2 * radiusPx, h: 2 * radiusPx });
          placed.push({ x: this.moon.offsetLeft - caption.offsetWidth / 2, y: this.moon.offsetTop, w: caption.offsetWidth, h: caption.offsetHeight });
        }
      }
      for (const m of this.markers) {
        v.copy(m.p).project(this.camera);
        const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
        m.el.hidden = !visible;
        m.stem.hidden = !visible;
        if (!visible) continue;
        const x = (v.x + 1) * w / 2;
        const y = (1 - v.y) * h / 2;
        const pw = m.el.offsetWidth;
        const ph = m.el.offsetHeight;
        const choices = [[x + 9, y - ph - 7], [x - pw - 9, y - ph - 7], [x + 9, y + 8], [x - pw - 9, y + 8]];
        for (const row of [-2, 1, -3, 2, -4, 3]) {
          const top = y + row * (ph + 7);
          choices.push([x - pw / 2, top], [x + 22, top], [x - pw - 22, top]);
        }
        const boxes = choices.map(([left, top]) => ({
          x: THREE.MathUtils.clamp(left, 8, Math.max(8, w - pw - 8)),
          y: THREE.MathUtils.clamp(top, 8, Math.max(8, h - ph - 8)), w: pw, h: ph,
        }));
        const box = boxes.find((a) => placed.every((b) => a.x + a.w + 6 <= b.x || b.x + b.w + 6 <= a.x ||
          a.y + a.h + 5 <= b.y || b.y + b.h + 5 <= a.y)) ?? boxes[0];
        placed.push(box);
        m.el.style.transform = `translate(${box.x}px, ${box.y}px)`;
        const dx = THREE.MathUtils.clamp(x, box.x + 7, box.x + pw - 7) - x;
        const dy = THREE.MathUtils.clamp(y, box.y + 5, box.y + ph - 5) - y;
        m.stem.style.width = `${Math.hypot(dx, dy)}px`;
        m.stem.style.transform = `translate(${x}px, ${y}px) rotate(${Math.atan2(dy, dx)}rad)`;
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
}

// ---------- 도움 함수 ----------
function cloudNoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  const u = THREE.MathUtils.smoothstep(x - i, 0, 1), v = THREE.MathUtils.smoothstep(y - j, 0, 1);
  const at = (a, b) => {
    const n = Math.imul(a + 197, 1597334677) ^ Math.imul(b + 937, 3812015801);
    return ((n ^ n >>> 16) >>> 0) / 4294967295;
  };
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(i, j), at(i + 1, j), u),
    THREE.MathUtils.lerp(at(i, j + 1), at(i + 1, j + 1), u), v);
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


