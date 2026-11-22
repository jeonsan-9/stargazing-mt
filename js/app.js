/* global maplibregl, deck, SunCalc */
import { SITES, DEPARTURE } from "./sites.js";
import { renderSiteInfo } from "./site-info.js";
import { MODELS, GRID_MODELS, modelLabel } from "./models.js";
import { loadForecast } from "./data.js";
import { renderMonth, renderSemester, renderYear, moonIcon } from "./longrange.js";
import { targetsHTML } from "./targets.js";
import { scoreNight, scoreColor, moonInfo, darkWindow, parseLocal, ymd, addDays, nightIndices, verdict, dewPoint } from "./score.js";
import { cityLightsEnabled, rememberCityLights } from "./city-lights.js";
import { LAT0, LON0 } from "./diorama/geo.js";
import { drawNightSky, nightSky } from "./diorama/night.js";

const EXAG = 3; // 지형 과장 배율 (한반도 산은 낮아서 3배로 키워야 높낮이가 보임)
const CLOUD_ALT = 2500; // 구름층 고도 (m, 과장 전)

// 지도 색감 테마. ?theme=glade 는 아늑한 미니어처(디오라마) 밤 풍경
const THEME = document.documentElement.dataset.theme || "glade";
const GLADE = THEME.startsWith("glade");
const PAL = GLADE
  ? {
      land: "#56648a", water: "#34446f", waterway: "#3d4f7c", stateLine: "#8d97c4", countryLine: "#a7afd6", road: "#8a86b0",
      label: "#fff4e2", labelState: "#d9d2f0", halo: "rgba(52,48,88,0.9)",
      shadow: "#2b2550", accent: "#6f7fb0", highlight: "#ffe2bd",
      dark: [92, 92, 150], moonlit: [255, 226, 190], dusk: [255, 180, 150],
      sky: [58, 66, 118], skyMoon: [96, 104, 160], skyDusk: [240, 170, 150], horizon: [255, 196, 170],
      cloud: [255, 248, 242], cloudBlur: 16, mask: "#2a2748", maskOpacity: 0.55,
    }
  : {
      land: "#0b1124", water: "#04060f", waterway: "#0a1022", stateLine: "#2c3a66", countryLine: "#3a4a80", road: "#26315a",
      label: "#9fabcf", labelState: "#5d6a90", halo: "rgba(6,9,20,0.85)",
      shadow: "#000000", accent: "#1b2440", highlight: "#b8c8f0",
      dark: [26, 32, 54], moonlit: [120, 136, 186], dusk: [255, 190, 150],
      sky: [11, 16, 32], skyMoon: [40, 52, 88], skyDusk: [70, 60, 90], horizon: [120, 130, 170],
      cloud: [235, 240, 250], cloudBlur: 10, mask: "#04060d", maskOpacity: 0.78,
    };

const state = {
  data: null,
  night: null, // YYYY-MM-DD (저녁 날짜)
  hourIdx: 0, // data.times 인덱스 (슬라이더 위치의 앞 시각)
  nextIdx: 0, // 다음 시각
  hourFrac: 0, // 두 시각 사이 위치 (0~1), 구름과 달빛을 부드럽게 섞는 데 씀
  cloudModel: "ecmwf_ifs025",
  cloudLayer: "total", // total | low | mid | high
  showCloud: true,
  is3D: true,
  showExtra: true,
  selected: null,
  results: [],
  view: "week",
  month: null, // YYYY-MM (월 보기)
};

const $ = (id) => document.getElementById(id);
const fmtTime = (d) =>
  d && !isNaN(d) ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }) : "-";
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const fmtHour = (d) => (d && !isNaN(d) ? String(+d.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Seoul" }) % 24).padStart(2, "0") + "시" : "-");

// ---------- 지도 ----------
const terrainMode = document.documentElement.dataset.map === "terrain";
const map = terrainMode ? new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [128.95, 36.12],
  zoom: 8.6,
  pitch: 62,
  bearing: -20,
  maxPitch: 75,
  // 한국만: 범위 밖으로 끌거나 너무 멀리 축소하지 못하게
  maxBounds: [
    [122.6, 31.6],
    [133.2, 39.6],
  ],
  minZoom: 6.2,
  renderWorldCopies: false,
  attributionControl: { compact: true },
}) : null;
if (map) map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

const overlay = map ? new deck.MapboxOverlay({ interleaved: false, layers: [] }) : null;
if (map) map.addControl(overlay);
let diorama, dioramaHour, dioramaCloud;
let detailSky;

async function loadDiorama() {
  if (map) {
    $("map-link").href = "./index.html";
    $("map-link").textContent = "3D 지도";
    return;
  }
  $("toggle3d").textContent = "시점 초기화";
  $("map-status").textContent = "3D 지도 불러오는 중…";
  try {
    const { Diorama } = await import("./diorama/scene.js?v=20261122f");
    const pins = $("pins");
    diorama = await new Diorama($("scene"), pins, $("moon")).load("models/korea.glb?v=20261122s");
    diorama.calibrateWith([...SITES, DEPARTURE]);
    diorama.setCityLights($("city-view").checked);
    pins.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-site]");
      if (!button) return;
      if (state.data) selectSite(button.dataset.site, false);
      else location.href = "./diorama.html?site=" + encodeURIComponent(button.dataset.site);
    });
    diorama.setTime(new Date());
    diorama.setSites(SITES);
    diorama.start();
    $("map-status").textContent = diorama.placeholder ? "임시 지형 표시 중" : "";
    renderLayers();
  } catch (error) {
    $("map-status").textContent = "3D 지도를 열지 못했습니다. 기존 지도로 볼 수 있어요.";
    console.error(error);
  }
}

// ---------- 지도 스타일 다듬기 ----------
// CARTO dark-matter 위에서 색을 절제하고 라벨은 주요 도시와 도 이름만 남김
const KEEP_LABELS = new Set(["place_city_r6", "place_city_r5", "place_state"]);
const HIDE = /^(tunnel|bridge_(service|minor|path|sec)|road_(service|minor|path|sec|pri)|rail|aeroway|building|boundary_county|water_shadow|landuse_residential|park_)/;

function styleBasemap() {
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === "symbol") {
      if (!KEEP_LABELS.has(id)) {
        map.setLayoutProperty(id, "visibility", "none");
        continue;
      }
      map.setLayoutProperty(id, "text-field", ["coalesce", ["get", "name:ko"], ["get", "name"]]);
      map.setLayoutProperty(id, "text-letter-spacing", 0.08);
      map.setPaintProperty(id, "text-color", id === "place_state" ? PAL.labelState : PAL.label);
      map.setPaintProperty(id, "text-halo-color", PAL.halo);
      map.setPaintProperty(id, "text-halo-width", 1.4);
      continue;
    }
    if (HIDE.test(id)) {
      map.setLayoutProperty(id, "visibility", "none");
      continue;
    }
    if (id === "background") map.setPaintProperty(id, "background-color", PAL.land);
    else if (id === "water") map.setPaintProperty(id, "fill-color", PAL.water);
    else if (id === "waterway") map.setPaintProperty(id, "line-color", PAL.waterway);
    else if (id === "landcover" || id === "landuse" || id === "park_national_park") map.setPaintProperty(id, "fill-opacity", 0.0);
    else if (id.startsWith("boundary_state")) {
      map.setPaintProperty(id, "line-color", PAL.stateLine);
      map.setPaintProperty(id, "line-opacity", 0.7);
    } else if (id.startsWith("boundary_country")) map.setPaintProperty(id, "line-color", PAL.countryLine);
    else if (/^(road|bridge)_(mot|trunk)/.test(id)) {
      map.setPaintProperty(id, "line-color", id.includes("case") ? "rgba(0,0,0,0)" : PAL.road);
      map.setPaintProperty(id, "line-opacity", 0.55);
    }
  }
}

map?.on("load", () => {
  styleBasemap();
  map.addSource("dem", {
    type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 13,
    attribution: "Terrain: Mapzen/AWS Terrain Tiles",
  });
  map.addSource("dem-hs", {
    type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 13,
  });
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addLayer(
    {
      id: "hillshade",
      type: "hillshade",
      source: "dem-hs",
      paint: {
        "hillshade-exaggeration": 1,
        "hillshade-shadow-color": PAL.shadow,
        "hillshade-highlight-color": PAL.highlight,
        "hillshade-accent-color": PAL.accent,
        "hillshade-illumination-direction": 315,
      },
    },
    firstSymbol
  );
  map.addSource("city-lights", {type: "image", url: "./js/diorama/lights-map.png",
    coordinates: [[124.5, 38.8], [131, 38.8], [131, 32.8], [124.5, 32.8]]});
  map.addLayer({id: "city-lights", type: "raster", source: "city-lights",
    layout: {visibility: $("city-view").checked ? "visible" : "none"}, paint: {"raster-opacity": 0.84}}, firstSymbol);
  map.setSky({
    "sky-color": "#0b1020",
    "horizon-color": "#22305a",
    "fog-color": "#0b1020",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.4,
  });
  apply3D();
  addKoreaMask();
  updateLighting();
});

function apply3D() {
  if (!map?.getSource("dem")) return;
  if (state.is3D) {
    map.setTerrain({ source: "dem", exaggeration: EXAG });
    map.easeTo({ pitch: 62, bearing: -20, duration: 800 });
  } else {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
  }
  renderLayers();
}

// ---------- 구름 이미지 ----------
// deck.gl은 image 객체가 바뀌어야 텍스처를 다시 올리므로, 시각마다 새 캔버스를 만들어 캐시함
const cloudCache = new Map();
let cloudKey = "";

let noiseCache = null;
function noiseCanvas(w, h) {
  if (noiseCache && noiseCache.width === w && noiseCache.height === h) return noiseCache;
  // 여러 크기의 무작위 격자를 겹친 값 잡음 (알파 0.45~1)
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const acc = new Float32Array(w * h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  [[8, 0.5], [16, 0.3], [40, 0.2]].forEach(([cells, amp]) => {
    const gw = cells + 1;
    const gh = Math.ceil((cells * h) / w) + 1;
    const g = Array.from({ length: gw * gh }, rnd);
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * (gh - 1);
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * (gw - 1);
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a0 = g[y0 * gw + x0] + (g[y0 * gw + x0 + 1] - g[y0 * gw + x0]) * sx;
        const a1 = g[(y0 + 1) * gw + x0] + (g[(y0 + 1) * gw + x0 + 1] - g[(y0 + 1) * gw + x0]) * sx;
        acc[y * w + x] += (a0 + (a1 - a0) * sy) * amp;
      }
    }
  });
  const img = ctx.createImageData(w, h);
  for (let k = 0; k < w * h; k++) {
    img.data[k * 4 + 3] = Math.round(255 * (0.45 + 0.55 * Math.min(1, acc[k])));
  }
  ctx.putImageData(img, 0, 0);
  noiseCache = c;
  return c;
}

let cloudMask = null;
function koreaCloudMask(W, H, g) {
  if (cloudMask && cloudMask.width === W && cloudMask.height === H) return cloudMask;
  const half = Math.abs(g.lons[1] - g.lons[0]) / 2;
  const w = g.lons[0] - half;
  const e = g.lons[g.lons.length - 1] + half;
  const n = Math.max(g.lats[0], g.lats[g.lats.length - 1]) + half;
  const s = Math.min(g.lats[0], g.lats[g.lats.length - 1]) - half;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, 0, W, H);
  ctx.filter = "blur(18px)";
  ctx.fillStyle = "#000";
  ctx.beginPath();
  KOREA_RING.forEach(([lon, lat], k) => {
    const x = ((lon - w) / (e - w)) * W;
    const y = ((n - lat) / (n - s)) * H;
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.fill();
  cloudMask = c;
  return c;
}

function cloudImageAt(hourIdx) {
  const g = state.data?.grid;
  const field = cloudField(hourIdx);
  if (!field) return null;
  const key = `${state.cloudModel}:${state.cloudLayer}:${hourIdx}`;
  if (cloudCache.has(key)) {
    cloudKey = key;
    return cloudCache.get(key);
  }
  const nLat = g.lats.length;
  const nLon = g.lons.length;
  const small = document.createElement("canvas");
  small.width = nLon;
  small.height = nLat;
  const ctx = small.getContext("2d");
  const img = ctx.createImageData(nLon, nLat);
  for (let r = 0; r < nLat; r++) {
    for (let c = 0; c < nLon; c++) {
      const v = field[r * nLon + c];
      const p = (r * nLon + c) * 4;
      [img.data[p], img.data[p + 1], img.data[p + 2]] = PAL.cloud;
      img.data[p + 3] = v == null ? 0 : Math.round(Math.pow(v / 100, 1.3) * 235);
    }
  }
  ctx.putImageData(img, 0, 0);
  const cloudCanvas = document.createElement("canvas");
  cloudCanvas.width = nLon * 32;
  cloudCanvas.height = nLat * 32;
  const big = cloudCanvas.getContext("2d");
  big.imageSmoothingEnabled = true;
  big.imageSmoothingQuality = "high";
  big.filter = `blur(${PAL.cloudBlur}px)`;
  big.drawImage(small, 0, 0, cloudCanvas.width, cloudCanvas.height);
  big.filter = "none";
  // 구름 질감: 미리 만든 잡음으로 가장자리를 뭉게뭉게하게
  big.globalCompositeOperation = "destination-in";
  big.drawImage(noiseCanvas(cloudCanvas.width, cloudCanvas.height), 0, 0);
  // 한국 밖 구름은 옅게 (지도 마스크와 맞춤)
  big.drawImage(koreaCloudMask(cloudCanvas.width, cloudCanvas.height, g), 0, 0);
  big.globalCompositeOperation = "source-over";
  cloudKey = key;
  cloudCache.set(key, cloudCanvas);
  return cloudCanvas;
}

const LAYER_LABEL = { total: "전체", low: "하층", mid: "중층", high: "상층" };

function cloudField(i = state.hourIdx) {
  const g = state.data?.grid;
  if (!g) return null;
  if (state.cloudLayer === "total") return g.models?.[state.cloudModel]?.[i] ?? null;
  return g.layers?.[state.cloudModel]?.[state.cloudLayer]?.[i] ?? null;
}

function cloudBounds(z) {
  const g = state.data.grid;
  const half = Math.abs(g.lons[1] - g.lons[0]) / 2;
  const w = g.lons[0] - half;
  const e = g.lons[g.lons.length - 1] + half;
  const n = g.lats[0] + half;
  const s = g.lats[g.lats.length - 1] - half;
  return [
    [w, s, z],
    [w, n, z],
    [e, n, z],
    [e, s, z],
  ];
}

// ---------- 한국 밖 가리기 ----------
// 남한 육지와 가까운 바다(제주, 울릉도 포함)만 밝게 두고 나머지는 어둡게 덮음
const KOREA_RING = [
  [125.6, 37.6], [126.1, 37.75], [126.65, 37.95], [127.1, 38.3], [128.0, 38.33], [128.32, 38.62],
  [128.9, 38.6], [131.1, 37.8], [131.1, 37.2], [129.8, 35.6], [129.45, 35.0], [128.7, 34.6],
  [127.6, 34.1], [126.95, 33.15], [126.45, 32.95], [126.05, 33.15], [125.9, 33.6], [125.0, 34.0],
  [124.5, 34.8], [125.6, 36.0], [125.5, 36.8], [125.6, 37.6],
];

function addKoreaMask() {
  map.addSource("korea-mask", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [[100, 20], [160, 20], [160, 50], [100, 50], [100, 20]],
          [...KOREA_RING].reverse(),
        ],
      },
    },
  });
  // 라벨보다 위에 올려 일본·중국·북한 지명도 함께 흐리게
  map.addLayer({ id: "korea-mask", type: "fill", source: "korea-mask", paint: { "fill-color": PAL.mask, "fill-opacity": PAL.maskOpacity, "fill-antialias": false } });
}

// ---------- 하늘의 달 ----------
// 화면 위쪽 하늘 띠에 달을 띄움. 가로 위치 = 카메라가 보는 방향 대비 달 방위, 세로 위치 = 고도
function moonDisc(phase, size) {
  const r = 50;
  const k = Math.cos(phase * 2 * Math.PI);
  const waxing = phase < 0.5;
  const rx = Math.abs(k) * r;
  const outer = waxing ? 1 : 0;
  const inner = k > 0 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  const lit = `M ${r} 0 A ${r} ${r} 0 0 ${outer} ${r} ${2 * r} A ${rx} ${r} 0 0 ${inner} ${r} 0 Z`;
  const craters = [[34, 30, 9], [62, 44, 6], [44, 64, 11], [70, 70, 5], [28, 52, 4], [58, 22, 4]]
    .map(([x, y, cr]) => `<circle cx="${x}" cy="${y}" r="${cr}" fill="rgba(120,110,80,.18)"/>`)
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <defs><clipPath id="mclip"><path d="${lit}"/></clipPath>
    <radialGradient id="mg" cx="40%" cy="38%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#e9dcb0"/></radialGradient></defs>
    <circle cx="50" cy="50" r="50" fill="rgba(150,165,210,.10)"/>
    <g clip-path="url(#mclip)"><circle cx="50" cy="50" r="50" fill="url(#mg)"/>${craters}</g>
  </svg>`;
}

let lastMoonKey = "";
function updateSkyMoon(info) {
  const el = $("skyMoon");
  if (!el || !info) return;
  const { az, alt, ill, phase, moonLight } = info;
  const diff = ((az - map.getBearing() + 540) % 360) - 180; // -180~180, 0 = 정면
  const w = window.innerWidth;
  const panelW = w > 760 ? 360 : 0; // 왼쪽 패널 피하기
  const half = 70; // 화면 좌우 끝 = ±70°
  const clamped = Math.max(-half, Math.min(half, diff));
  const x = panelW + ((clamped + half) / (2 * half)) * (w - panelW - 120) + 30;
  const skyTop = 70;
  const skyH = Math.max(90, window.innerHeight * 0.22);
  const y = skyTop + (1 - Math.min(alt, 80) / 80) * skyH;
  const size = 46 + 10 * ill;
  const key = `${phase.toFixed(3)}|${Math.round(size)}`;
  if (key !== lastMoonKey) {
    el.querySelector(".disc").innerHTML = moonDisc(phase, size);
    lastMoonKey = key;
  }
  el.style.transform = `translate(${x}px, ${y}px)`;
  el.style.setProperty("--glow", (0.15 + 0.85 * moonLight).toFixed(2));
  el.classList.toggle("down", alt <= 0);
  el.classList.toggle("behind", Math.abs(diff) > half);
  const dirs = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  const dir = dirs[Math.round(az / 45) % 8];
  el.querySelector(".tag").textContent =
    alt > 0 ? `${dir} ${Math.round(alt)}° · ${Math.round(ill * 100)}%${Math.abs(diff) > half ? (diff > 0 ? " →" : " ←") : ""}` : `지평선 아래 · ${Math.round(ill * 100)}%`;
  // 달빛이 강할수록 화면에 은은한 빛 번짐
  $("moonGlow").style.opacity = (0.55 * moonLight).toFixed(2);
  $("moonGlow").style.background = `radial-gradient(60% 50% at ${x + size / 2}px ${y + size / 2}px, rgba(220,228,255,.22), rgba(220,228,255,0) 70%)`;
}

// ---------- 달빛 조명 ----------
// 슬라이더 시각의 달 위치(방위, 고도)와 위상으로 지형 음영 방향과 밝기, 하늘색을 바꿈
const LIGHT_POINT = [36.0, 128.8];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c.join(",")})`;

let lastMoon = null;
map?.on("rotate", () => updateSkyMoon(lastMoon));
if (map) window.addEventListener("resize", () => updateSkyMoon(lastMoon));

function updateLighting() {
  if (!state.data) return;
  const t = currentTime();
  if (!map) {
    const { altitude } = SunCalc.getMoonPosition(t, LAT0, LON0);
    const fraction = SunCalc.getMoonIllumination(t).fraction;
    $("moonLabel").textContent = altitude > 0 ? `달 ${Math.round(fraction * 100)}%` : "달 지평선 아래";
    return;
  }
  if (!map.getLayer("hillshade")) return;
  const [lat, lon] = LIGHT_POINT;
  const mp = SunCalc.getMoonPosition(t, lat, lon);
  const sp = SunCalc.getPosition(t, lat, lon);
  const illum = SunCalc.getMoonIllumination(t);
  const ill = illum.fraction;
  const moonAlt = (mp.altitude * 180) / Math.PI;
  const sunAlt = (sp.altitude * 180) / Math.PI;
  const az = ((mp.azimuth * 180) / Math.PI + 180 + 360) % 360; // 북=0, 시계방향
  const moonLight = moonAlt > 0 ? ill * Math.min(1, (moonAlt + 2) / 30) : 0;
  const twilight = sunAlt > -18 ? Math.min(1, (sunAlt + 18) / 18) : 0;

  const { dark, moonlit, dusk } = PAL;
  let hi = mix(dark, moonlit, moonLight);
  if (twilight > 0) hi = mix(hi, dusk, twilight * 0.6);
  map.setPaintProperty("hillshade", "hillshade-highlight-color", rgb(hi));
  map.setPaintProperty("hillshade", "hillshade-exaggeration", (GLADE ? 0.55 : 0.4) + 0.3 * Math.max(moonLight, twilight));
  map.setPaintProperty("hillshade", "hillshade-illumination-anchor", "map");
  map.setPaintProperty(
    "hillshade",
    "hillshade-illumination-direction",
    moonLight > 0.02 ? az : ((sp.azimuth * 180) / Math.PI + 180 + 360) % 360
  );
  const sky = mix(mix(PAL.sky, PAL.skyMoon, moonLight), PAL.skyDusk, twilight * 0.7);
  map.setSky({
    "sky-color": rgb(sky),
    "horizon-color": rgb(mix(sky, PAL.horizon, 0.35 + 0.3 * moonLight)),
    "fog-color": rgb(sky),
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.4,
  });
  lastMoon = { az, alt: moonAlt, ill, phase: illum.phase, moonLight };
  updateSkyMoon(lastMoon);
  const dir = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"][Math.round(az / 45) % 8];
  $("moonLabel").textContent =
    moonAlt > 0 ? `달 ${dir}쪽 ${Math.round(moonAlt)}° · ${Math.round(ill * 100)}%` : sunAlt > -18 ? "박명" : "달 없음";
}

// ---------- deck.gl 레이어 ----------
function siteZ(r) {
  if (!state.is3D) return 0;
  const elev = state.data.sites[r.site.id]?.elevation ?? 0;
  return elev * EXAG;
}

function renderLayers() {
  if (!state.data) return;
  const visible = state.results.filter((r) => state.showExtra || r.site.primary);
  if (!map) {
    if (!diorama) return;
    const time = currentTime();
    const minute = Math.floor(+time / 180_000);
    if (dioramaHour !== minute) {
      diorama.setTime(time);
      dioramaHour = minute;
    }
    const i = state.hourFrac < 0.5 ? state.hourIdx : state.nextIdx;
    const key = `${state.cloudModel}:${state.cloudLayer}:${i}`;
    if (dioramaCloud !== key) {
      const grid = state.data.grid;
      diorama.setClouds(cloudField(i), grid?.lats ?? [], grid?.lons ?? []);
      dioramaCloud = key;
    }
    diorama.setCloudVisibility(state.showCloud);
    diorama.setSites(visible.map(({ site, hours }) =>
      ({ ...site, score: hours.find((hour) => hour.i === i)?.score ?? null })));
    return;
  }
  const layers = [];

  if (state.showCloud && state.data.grid) {
    // 앞뒤 두 시각의 구름을 슬라이더 위치만큼 섞어서, 끄는 동안 구름이 부드럽게 변하게 함
    const bounds = cloudBounds(state.is3D ? CLOUD_ALT * EXAG : 0);
    const pairs = [
      [state.hourIdx, 1 - state.hourFrac],
      [state.nextIdx, state.hourFrac],
    ];
    pairs.forEach(([i, w], k) => {
      if (w < 0.02) return;
      const image = cloudImageAt(i);
      if (!image) return;
      layers.push(
        new deck.BitmapLayer({
          id: `cloud-${k}-${cloudKey}-${i}`,
          image,
          bounds,
          opacity: 0.92 * w,
          parameters: { depthTest: false },
        })
      );
    });
  }

  if (GLADE) {
    // 디오라마: 막대 대신 등불처럼 빛나는 동그란 표시
    const z = (r) => siteZ(r) + (state.is3D ? 120 * EXAG : 0);
    layers.push(
      new deck.ScatterplotLayer({
        id: "site-glow",
        data: visible,
        getPosition: (r) => [r.site.lon, r.site.lat, z(r)],
        getRadius: (r) => (r.site.primary ? 5200 : 3600),
        radiusMinPixels: 22,
        getFillColor: [255, 196, 120, 70],
        stroked: false,
        parameters: { depthTest: false },
        updateTriggers: { getPosition: [state.is3D] },
      }),
      new deck.ScatterplotLayer({
        id: "sites",
        data: visible,
        pickable: true,
        getPosition: (r) => [r.site.lon, r.site.lat, z(r)],
        getRadius: (r) => (r.site.primary ? 1800 : 1300),
        radiusMinPixels: 8,
        getFillColor: (r) => scoreColor(r.score, 255),
        getLineColor: [255, 246, 226, 255],
        stroked: true,
        lineWidthMinPixels: 2.5,
        parameters: { depthTest: false },
        onClick: ({ object }) => object && selectSite(object.site.id, true),
        updateTriggers: { getPosition: [state.is3D], getFillColor: [state.night] },
      })
    );
  } else layers.push(
    new deck.ColumnLayer({
      id: "sites",
      data: visible,
      diskResolution: 32,
      radius: 1100,
      extruded: true,
      pickable: true,
      getPosition: (r) => [r.site.lon, r.site.lat, siteZ(r)],
      getElevation: (r) => (state.is3D ? 300 + (r.score ?? 0) * 60 : 0),
      getFillColor: (r) => scoreColor(r.score),
      getLineColor: [255, 255, 255, 200],
      lineWidthMinPixels: 1,
      stroked: !state.is3D,
      filled: true,
      material: { ambient: 0.6, diffuse: 0.6, shininess: 20 },
      onClick: ({ object }) => object && selectSite(object.site.id, true),
      updateTriggers: {
        getPosition: [state.is3D],
        getElevation: [state.is3D, state.night],
        getFillColor: [state.night],
      },
    })
  );

  layers.push(
    new deck.ScatterplotLayer({
      id: "departure",
      data: [DEPARTURE],
      getPosition: (d) => [d.lon, d.lat, state.is3D ? 40 * EXAG : 0],
      getRadius: 1500,
      radiusMinPixels: 5,
      getFillColor: [88, 166, 255, 255],
      getLineColor: [255, 255, 255, 255],
      stroked: true,
      lineWidthMinPixels: 2,
      updateTriggers: { getPosition: [state.is3D] },
    })
  );

  layers.push(
    new deck.TextLayer({
      id: "labels",
      data: [...visible, { site: DEPARTURE, score: null, departure: true }],
      characterSet: "auto",
      fontFamily: '"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif',
      getPosition: (r) =>
        r.departure
          ? [r.site.lon, r.site.lat, state.is3D ? 40 * EXAG : 0]
          : [r.site.lon, r.site.lat, siteZ(r) + (state.is3D ? (GLADE ? 120 * EXAG : 300 + (r.score ?? 0) * 60) : 0)],
      getText: (r) => (r.departure ? "출발 · 계명대" : `${r.site.name} ${r.score ?? "-"}`),
      getSize: (r) => (r.site.primary || r.departure ? 14 : 12),
      getColor: (r) =>
        GLADE
          ? r.departure ? [90, 80, 140, 255] : [62, 52, 96, 255]
          : r.departure ? [150, 200, 255, 255] : r.site.primary ? [255, 255, 255, 255] : [200, 205, 215, 230],
      // 가까이 붙은 보현산 두 곳 이름이 겹치지 않게 하나는 아래로
      getPixelOffset: (r) => (r.site.id === "bohyeon_sci" ? [0, GLADE ? 22 : 14] : [0, GLADE ? -22 : -14]),
      background: true,
      getBackgroundColor: GLADE ? [255, 244, 226, 235] : [10, 14, 25, 190],
      backgroundPadding: GLADE ? [8, 4] : [5, 3],
      ...(GLADE ? { getBorderColor: [255, 255, 255, 255], getBorderWidth: 0 } : {}),
      parameters: { depthTest: false },
      updateTriggers: { getPosition: [state.is3D, state.night], getText: [state.night] },
    })
  );

  overlay.setProps({ layers });
}

// ---------- 계산 ----------
function nightsAvailable() {
  const times = state.data.times;
  const first = parseLocal(times[0]);
  const last = parseLocal(times[times.length - 1]);
  const nights = [];
  let d = ymd(new Date(Math.max(first.getTime(), Date.now()) - 6 * 3600e3));
  for (let k = 0; k < 8; k++) {
    const eve = parseLocal(`${d}T21:00`);
    if (eve > last) break;
    nights.push(d);
    d = addDays(d, 1);
  }
  return nights;
}

function nightHourIndices() {
  return nightIndices(state.data, state.night);
}

function recompute() {
  state.results = SITES.map((s) => scoreNight(state.data, s, state.night) ?? { site: s, score: null, models: {}, hours: [] });
}

// ---------- 화면 ----------

// 이번 주 금·토 밤 중 보현산 점수가 더 좋은 밤으로 한 줄 결론
function renderVerdict() {
  const box = $("verdict");
  if (!box) return;
  const site = SITES.find((s) => s.id === "bohyeon_obs");
  const cands = nightsAvailable()
    .filter((n) => [5, 6].includes(new Date(`${n}T12:00:00+09:00`).getDay()))
    .map((n) => ({ n, r: scoreNight(state.data, site, n) }))
    .filter((x) => x.r?.score != null);
  if (!cands.length) {
    box.innerHTML = "";
    return;
  }
  const { n, r } = cands.reduce((a, b) => (b.r.score > a.r.score ? b : a));
  const d = new Date(`${n}T12:00:00+09:00`);
  const win = r.hours.filter((h) => h.t >= r.windowStart && h.t < r.windowEnd);
  const rain = Math.max(0, ...win.map((h) => h.precip ?? 0));
  const [word, cls] = r.score >= 70 ? ["가자!", "go"] : r.score >= 45 ? ["애매해요", "maybe"] : ["접자", "no"];
  box.className = `verdict ${cls}`;
  box.innerHTML = `<b>이번 주말 보현산: ${word}</b>
    <small>${WD[d.getDay()]}요일 밤 ${fmtHour(r.windowStart)}~${fmtHour(r.windowEnd)} · 구름 ${r.cloud}%${rain >= 0.1 ? ` · 비 ${rain.toFixed(1)}mm` : ""} · ${r.score}점 ${verdict(r.score).word} · 모델 일치 ${r.agreement}</small>`;
  box.onclick = () => setNight(n);
}

function renderNights() {
  renderVerdict();
  const box = $("nights");
  box.innerHTML = "";
  for (const n of nightsAvailable()) {
    const d = new Date(`${n}T12:00:00+09:00`);
    const best = Math.max(
      ...SITES.filter((s) => s.primary).map((s) => scoreNight(state.data, s, n)?.score ?? 0)
    );
    const hasData = SITES.some((s) => scoreNight(state.data, s, n)?.score != null);
    const moon = moonInfo(n, 36, 128.7);
    const btn = document.createElement("button");
    btn.className = "night" + (n === state.night ? " active" : "");
    btn.title = `${d.getMonth() + 1}월 ${d.getDate()}일 밤 · 영천 최고 ${hasData ? best : "-"}점 · 달 ${Math.round(moon.fraction * 100)}%`;
    btn.innerHTML = `<span class="nd">${WD[d.getDay()]}<b>${d.getDate()}</b></span>
      <span class="ns" style="background:rgba(${scoreColor(hasData ? best : null).slice(0, 3).join(",")},.95)">${hasData ? best : "-"}</span>
      ${moonIcon(moon.phase)}`;
    btn.onclick = () => setNight(n);
    box.appendChild(btn);
  }
}

function renderHourSlider() {
  const idx = nightHourIndices();
  const slider = $("hour");
  slider.min = 0;
  slider.disabled = idx.length === 0;
  slider.max = Math.max(0, idx.length - 1);
  slider.step = 0.02;
  if (!idx.includes(state.hourIdx)) {
    const target = parseLocal(`${addDays(state.night, 0)}T22:00`).getTime();
    let best = 0;
    idx.forEach((i, k) => {
      if (Math.abs(parseLocal(state.data.times[i]).getTime() - target) < Math.abs(parseLocal(state.data.times[idx[best]]).getTime() - target)) best = k;
    });
    state.hourIdx = idx[best] ?? 0;
  }
  slider.value = Math.max(0, idx.indexOf(state.hourIdx));
  slider.oninput = () => {
    if (!idx.length) {
      $("hourLabel").textContent = "예보 시간 없음";
      return;
    }
    const v = +slider.value;
    const k = Math.min(Math.floor(v), idx.length - 1);
    state.hourIdx = idx[k];
    state.nextIdx = idx[Math.min(k + 1, idx.length - 1)];
    state.hourFrac = k + 1 < idx.length ? v - k : 0;
    updateHourLabel();
    updateLighting();
    renderLayers();
    if (detailSky && document.body.classList.contains("detail-open")) {
      drawNightSky($("detail-night-chart"), detailSky, currentTime());
      updateSiteSkyLink();
    }
  };
  slider.oninput();
}

function currentTime() {
  return new Date(parseLocal(state.data.times[state.hourIdx]).getTime() + state.hourFrac * 3600e3);
}

function updateHourLabel() {
  const t = currentTime();
  $("wide-map-link").href = `./diorama.html?${new URLSearchParams({ t: t.toISOString() })}`;
  const has = !!cloudField();
  const md = t.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
  $("hourLabel").textContent = `${md} ${fmtTime(t)}${has ? "" : " (자료 없음)"}`;
}

function renderModelSelect() {
  const sel = $("cloudModel");
  sel.innerHTML = "";
  const available = GRID_MODELS.filter((m) => state.data.grid?.models?.[m]);
  for (const m of available) {
    const o = document.createElement("option");
    o.value = m;
    o.textContent = modelLabel(m);
    sel.appendChild(o);
  }
  if (!available.includes(state.cloudModel)) state.cloudModel = available[0];
  sel.value = state.cloudModel;
  sel.onchange = () => {
    state.cloudModel = sel.value;
    renderLayerSelect();
    updateHourLabel();
    renderLayers();
  };
  renderLayerSelect();
}

function renderLayerSelect() {
  const sel = $("cloudLayer");
  const layers = state.data.grid?.layers?.[state.cloudModel] ?? {};
  const opts = ["total", ...["low", "mid", "high"].filter((k) => layers[k])];
  sel.innerHTML = opts.map((k) => `<option value="${k}">${LAYER_LABEL[k]}</option>`).join("");
  if (!opts.includes(state.cloudLayer)) state.cloudLayer = "total";
  sel.value = state.cloudLayer;
  sel.disabled = opts.length === 1;
  sel.title = opts.length === 1 ? "이 모델은 층별 구름 지도가 없어요 (ECMWF, GFS만)" : "";
  sel.onchange = () => {
    state.cloudLayer = sel.value;
    updateHourLabel();
    renderLayers();
  };
}

function renderList() {
  const list = $("list");
  list.innerHTML = "";
  const rows = state.results
    .filter((r) => state.showExtra || r.site.primary)
    .sort((a, b) => (b.site.primary - a.site.primary) || ((b.score ?? -1) - (a.score ?? -1)));
  let lastPrimary = null;
  for (const r of rows) {
    if (r.site.primary !== lastPrimary) {
      const h = document.createElement("div");
      h.className = "group";
      h.textContent = r.site.primary ? "영천 · 동아리 MT 장소" : "전국 관측지";
      list.appendChild(h);
      lastPrimary = r.site.primary;
    }
    const el = document.createElement("button");
    el.className = "site" + (state.selected === r.site.id ? " active" : "");
    el.innerHTML = `
      <span class="score" style="background:rgba(${scoreColor(r.score).slice(0, 3).join(",")},.92)">${r.score ?? "-"}</span>
      <span class="sname">${r.site.name}${r.site.verified ? "" : ' <em title="좌표 확인 필요">위치 확인 필요</em>'}<small>${r.score == null ? "" : `<b class="word ${verdict(r.score).cls}">${verdict(r.score).word}</b> `}${r.site.region} · ${r.score == null ? "예보 없음" : `최적 ${fmtHour(r.windowStart)}~${fmtHour(r.windowEnd)} · 좋은 시간 ${r.goodHours}h · 모델 일치 ${r.agreement}`}</small></span>`;
    el.onclick = () => selectSite(r.site.id, true);
    list.appendChild(el);
  }
}

// Meteoblue식 시간별 표: 열 = 18시~06시, 행 = 점수와 각 요소
function cell(v, cls = "", style = "", title = "") {
  return `<td class="${cls}" style="${style}"${title ? ` title="${title}"` : ""}>${v}</td>`;
}

function cloudCell(v) {
  if (v == null) return cell("·", "na");
  const a = (Math.min(100, v) / 100) * 0.85;
  // 색은 테마 CSS 변수로 (밝은 종이 테마에서도 읽히게)
  return cell(Math.round(v), "c", `background:rgba(var(--cloud-rgb, 225, 232, 245), ${a.toFixed(2)});color:${v > 55 ? "var(--cloud-hi-text, #0b1020)" : "var(--cloud-lo-text, #e6edf3)"}`);
}

function warnCell(v, fmt, bad, worse) {
  if (v == null) return cell("·", "na");
  const cls = v >= worse ? "w2" : v >= bad ? "w1" : "";
  return cell(fmt(v), cls);
}

function hourTable(r) {
  const hrs = r.hours;
  const head = hrs.map((h) => `<th>${fmtHour(h.t).replace("시", "")}</th>`).join("");
  const row = (label, cells, title = "") => `<tr><th class="rl"${title ? ` title="${title}"` : ""}>${label}</th>${cells}</tr>`;
  const scoreCells = hrs
    .map((h) => {
      if (h.f.dark === 0 || h.score == null) return cell("", "day");
      const [cr, cg, cb] = scoreColor(h.score);
      const inWin = h.t >= r.windowStart && h.t < r.windowEnd;
      return cell(h.score, "s" + (inWin ? " win" : ""), `background:rgba(${cr},${cg},${cb},.92)`);
    })
    .join("");
  const darkCells = hrs
    .map((h) =>
      cell(
        "",
        "dk",
        h.f.dark >= 1 ? "background:#24336e" : h.f.dark > 0 ? "background:linear-gradient(90deg,#6b4a6e,#24336e)" : "background:#a0663e",
        h.f.dark >= 1 ? "완전히 어두움" : h.f.dark > 0 ? `박명 (태양 ${Math.round(h.sunAlt)}°)` : "해가 있음"
      )
    )
    .join("");
  const moonCells = hrs
    .map((h) =>
      h.moonAlt > 0
        ? cell(Math.round(h.moonAlt) + "°", "moon", `background:rgba(255,236,170,${(0.15 + 0.6 * h.illum * Math.min(1, h.moonAlt / 40)).toFixed(2)})`)
        : cell("·", "na")
    )
    .join("");
  return `
  <div class="tbl-wrap"><table class="hourly">
    <thead><tr><th class="rl"></th>${head}</tr></thead>
    <tbody>
      ${row("점수", scoreCells, "시간별 관측 점수. 굵은 테두리 = 가장 좋은 3시간")}
      ${row("어둠", darkCells, "진할수록 완전히 어두움 (천문박명 이후)")}
      ${row("하층운", hrs.map((h) => cloudCell(h.low)).join(""), "2km 아래 구름 %")}
      ${row("중층운", hrs.map((h) => cloudCell(h.mid)).join(""), "2~6km 구름 %")}
      ${row("상층운", hrs.map((h) => cloudCell(h.high)).join(""), "6km 위 구름 % (권운)")}
      ${row("전체", hrs.map((h) => cloudCell(h.total)).join(""), "모델 중간값 전체 구름 %")}
      ${row("모델차", hrs.map((h) => warnCell(h.n > 1 ? h.spread : null, (v) => Math.round(v), 30, 50)).join(""), "모델 간 구름량 최대-최소 차이 %p. 클수록 불확실")}
      ${row("달 고도", moonCells, "달이 떠 있으면 고도°, 밝을수록 달빛 강함")}
      ${row("습도", hrs.map((h) => warnCell(h.rh, (v) => Math.round(v), 85, 95)).join(""), "%")}
      ${row("바람", hrs.map((h) => warnCell(h.wind, (v) => v.toFixed(1), 5, 8)).join(""), "m/s")}
      ${row("PM2.5", hrs.map((h) => warnCell(h.pm25, (v) => Math.round(v), 16, 36)).join(""), "㎍/㎥ (Open-Meteo CAMS)")}
      ${row("시정", hrs.map((h) => (h.vis == null ? cell("·", "na") : cell(Math.round(h.vis / 1000), h.vis < 10000 ? "w1" : ""))).join(""), "km")}
      ${row("시상", hrs.map((h) => warnCell(h.seeing, (v) => v, 4, 6)).join(""), "7Timer 1(좋음)~8(나쁨)")}
      ${row("투명도", hrs.map((h) => warnCell(h.transparency, (v) => v, 4, 6)).join(""), "7Timer 1(좋음)~8(나쁨)")}
      ${row("비", hrs.map((h) => (h.precip == null ? cell("·", "na") : cell(h.precip >= 0.1 ? h.precip.toFixed(1) : "", h.precip >= 1 ? "w2" : h.precip >= 0.1 ? "w1" : ""))).join(""), "mm/시간, 모델 중간값")}
      ${row("이슬", hrs.map((h) => { const gap = h.temp == null ? null : h.temp - dewPoint(h.temp, h.rh); return gap == null || !Number.isFinite(gap) ? cell("·", "na") : cell(gap < 2 ? "💧" : gap < 4 ? "·" : "", gap < 2 ? "w2" : gap < 4 ? "w1" : "", "", `기온−이슬점 ${gap.toFixed(1)}°C`); }).join(""), "기온과 이슬점 차가 2°C 아래면 💧")}
      ${row("기온", hrs.map((h) => (h.temp == null ? cell("·", "na") : cell(Math.round(h.temp)))).join(""), "°C")}
    </tbody>
  </table></div>`;
}

function flagsHTML(r) {
  const flags = [];
  if (r.score != null && r.agreement === "낮음") flags.push(["warn", `⚠ 모델끼리 의견이 크게 갈립니다 (구름 차이 평균 ${Math.round(r.spread)}%p). 출발 직전 예보를 다시 보세요.`]);
  if (r.dew === "높음") flags.push(["dew", "💧 이슬이 맺히기 쉬운 밤입니다. 열선 밴드나 후드, 렌즈 닦이를 챙기세요."]);
  else if (r.dew === "주의") flags.push(["dew", "💧 새벽에 이슬이 생길 수 있습니다. 후드를 챙기세요."]);
  return flags.map(([cls, text]) => `<p class="flag ${cls}">${text}</p>`).join("");
}

function renderDetail() {
  const box = $("detail");
  const r = state.results.find((x) => x.site.id === state.selected);
  if (!r) {
    detailSky = undefined;
    box.innerHTML = `<p class="hint">관측지를 누르면 시간별 예보표와 그날 밤 달 정보가 보입니다.</p>`;
    return;
  }
  const moon = moonInfo(state.night, r.site.lat, r.site.lon);
  const dw = darkWindow(state.night, r.site.lat, r.site.lon);
  detailSky = nightSky(state.night, r.site);
  const moonless = detailSky.moonless.map(([from, to]) => `${fmtTime(from)}–${fmtTime(to)}`).join(", ");
  const elev = state.data.sites[r.site.id]?.elevation;
  const bars = Object.entries(r.models)
    .sort((a, b) => a[1] - b[1])
    .map(
      ([m, v]) => `<div class="bar"><span class="bl">${modelLabel(m)}</span>
        <span class="bt"><span style="width:${Math.max(v, 1)}%;background:${MODELS[m]?.color ?? "#888"}"></span></span>
        <span class="bv">${v}%</span></div>`
    )
    .join("");
  const [cr, cg, cb] = scoreColor(r.score);
  box.innerHTML = `
    <h3>${r.site.name} <span class="score" style="background:rgba(${cr},${cg},${cb},.92)">${r.score ?? "-"}</span> <span class="word ${verdict(r.score).cls}">${verdict(r.score).word}</span></h3>
    ${flagsHTML(r)}
    <a id="site-sky-link" class="diorama-link" href="./sky.html">이곳에서 하늘 보기</a>
    ${!map ? '<button id="site-model" class="diorama-link" type="button">이 지점 확대</button>' : ''}
    <details><summary>관측 시 주의사항</summary><div id="main-site-info" class="hint"></div></details>
    <p class="lead">${
      r.score == null
        ? "이 밤의 예보 자료가 없습니다."
        : `가장 좋은 시간 <b>${fmtHour(r.windowStart)}~${fmtHour(r.windowEnd)}</b> · 70점 넘는 시간 <b>${r.goodHours}시간</b> · 최고 ${r.peak.score}점 (${fmtHour(r.peak.t)})`
    }</p>
    <div class="kv"><span>이슬 위험</span><b>${r.dew == null ? "-" : `${r.dew} · 기온과 이슬점 차 최소 ${r.dewGap.toFixed(1)}°C`}</b></div>
    <div class="kv"><span>해발</span><b>${elev != null ? Math.round(elev) + " m" : "-"}</b></div>
    <div class="kv"><span>천문박명 (완전히 어두운 시간)</span><b>${fmtTime(dw.dusk)} ~ ${fmtTime(dw.dawn)}</b></div>
    <div class="kv"><span>달</span><b>${moon.phaseName} · ${Math.round(moon.fraction * 100)}% · 뜸 ${fmtTime(moon.rise)} / 짐 ${fmtTime(moon.set)}</b></div>
    <div class="kv"><span>달 없는 어둠</span><b>${moonless || "이 밤에는 없음"}</b></div>
    <canvas id="detail-night-chart" width="604" height="212" role="img" aria-label="해와 달의 고도, 달 없는 시간대"></canvas>
    <p class="hint">분홍색은 해, 크림색은 달, 음영은 달 없는 어둠</p>
    <h4>오늘 밤 볼거리</h4>
    ${targetsHTML(state.night, r.site.lat, r.site.lon)}
    <h4>시간별 예보</h4>
    ${hourTable(r)}
    <h4>모델별 구름량 (가장 좋은 3시간 평균)</h4>
    ${bars || '<p class="hint">자료 없음</p>'}
    <p class="hint">모델 일치도 ${r.agreement ?? "-"} (모델 간 평균 차이 ${r.spread != null ? Math.round(r.spread) : "-"}%p)</p>`;
  drawNightSky($("detail-night-chart"), detailSky, currentTime());
  renderSiteInfo($("main-site-info"), r.site.id);
  $("site-model")?.addEventListener("click", () => diorama?.focusSite(r.site));
  updateSiteSkyLink();
}

function updateSiteSkyLink() {
  const link = $("site-sky-link");
  if (!link || !state.night || !state.selected) return;
  const query = new URLSearchParams({ site: state.selected, day: state.night, t: currentTime().toISOString() });
  if (map) query.set("from", "terrain");
  link.href = `./sky.html?${query}`;
}

function avg(a) {
  return (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
}

function selectSite(id, fly) {
  state.selected = id;
  updateObserveLink();
  renderList();
  renderDetail();
  document.body.classList.add("detail-open");
  if (!map) renderLayers();
  if (fly && map) {
    const s = SITES.find((x) => x.id === id);
    map.flyTo({ center: [s.lon, s.lat], zoom: 9.5, pitch: state.is3D ? 65 : 0, duration: 1200 });
  }
}

function setNight(n) {
  state.night = n;
  updateObserveLink();
  recompute();
  renderNights();
  renderHourSlider();
  renderList();
  renderDetail();
  renderLayers();
}

function updateObserveLink() {
  const query = new URLSearchParams({ site: state.selected ?? "bohyeon_obs" });
  if (state.night) query.set("day", state.night);
  $("observe-link").href = `./observe.html?${query}`;
}

// ---------- 컨트롤 ----------
$("toggle3d").onclick = () => {
  if (!map) { diorama?.resetView(); return; }
  state.is3D = !state.is3D;
  $("toggle3d").textContent = state.is3D ? "평면 보기" : "3D 보기";
  apply3D();
};
$("city-view").checked = cityLightsEnabled();
$("city-legend").hidden = !$("city-view").checked;
$("city-view").onchange = (event) => {
  const enabled = event.target.checked;
  rememberCityLights(enabled);
  $("city-legend").hidden = !enabled;
  diorama?.setCityLights(enabled);
  if (map?.getLayer("city-lights")) map.setLayoutProperty("city-lights", "visibility", enabled ? "visible" : "none");
};
$("toggleCloud").onchange = (e) => {
  state.showCloud = e.target.checked;
  renderLayers();
};
$("toggleExtra").onchange = (e) => {
  state.showExtra = e.target.checked;
  renderList();
  renderLayers();
};
let playTimer = null;
$("play").onclick = () => {
  if (!state.data || $("hour").disabled) return;
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
    $("play").textContent = "▶";
    return;
  }
  $("play").textContent = "❚❚";
  playTimer = setInterval(() => {
    const slider = $("hour");
    const next = +slider.value + 0.05;
    slider.value = next > +slider.max ? 0 : next;
    slider.oninput();
  }, 40);
};
$("closeDetail").onclick = () => document.body.classList.remove("detail-open");

// ---------- 주 / 월 / 학기 / 1년 ----------
const MT_SITE = SITES.find((s) => s.id === "bohyeon_obs");
const todayYmd = () => ymd(new Date(Date.now() - 6 * 3600e3));

function pickDate(d) {
  // 예보 범위 안이면 주 보기로 가서 그 밤을 열고, 아니면 월 보기로
  if (nightsAvailable().includes(d)) {
    setView("week");
    setNight(d);
    selectSite("bohyeon_obs", false);
  } else {
    state.month = d.slice(0, 7);
    setView("month");
  }
}

function renderView() {
  const v = state.view;
  if (v === "month")
    renderMonth($("view-month"), state.data, MT_SITE, state.month, todayYmd(), pickDate, (dm) => {
      const [y, m] = state.month.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dm, 1));
      state.month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      renderView();
    });
  if (v === "sem") renderSemester($("view-sem"), state.data, MT_SITE, todayYmd(), pickDate);
  if (v === "year")
    renderYear($("view-year"), state.data, MT_SITE, todayYmd(), (ym) => {
      state.month = ym;
      setView("month");
    });
}

function setView(v) {
  state.view = v;
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === v);
    b.setAttribute("aria-selected", String(b.dataset.view === v));
  });
  ["week", "month", "sem", "year"].forEach((k) => ($(`view-${k}`).hidden = k !== v));
  renderView();
}
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));

// ---------- 시작 ----------
loadDiorama();
(async () => {
  try {
    state.data = await loadForecast();
  } catch (e) {
    // Keep the map, sites and Moon usable when the weather service is unavailable.
    const first = parseLocal(ymd(new Date(Date.now() - 6 * 3600e3)) + "T18:00").getTime();
    const times = Array.from({ length: 37 }, (_, i) => new Date(first + (i + 9) * 3600e3).toISOString().slice(0, 16));
    state.data = { source: "astronomy", times, sites: {} };
    console.warn("예보 연결 실패", e.message);
  }
  const gen = new Date(state.data.generated);
  const srcCount = new Set(Object.values(state.data.sites).flatMap((s) => Object.keys(s.models))).size;
  $("status").textContent = state.data.source === "astronomy" ? "예보 연결 없음 · 지도와 밤하늘 이용 가능" : `예보 ${srcCount}개 소스 · ${gen.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 기준${state.data.source === "live" ? " (실시간 Open-Meteo)" : state.data.source === "stale" ? " (오래된 예보, 자동 갱신 멈춤)" : ""}`;
  renderModelSelect();
  state.month = todayYmd().slice(0, 7);
  const params = new URLSearchParams(location.search);
  const day = params.get("day"), site = params.get("site");
  setNight(nightsAvailable().includes(day) ? day : nightsAvailable()[0]);
  if (SITES.some(({ id }) => id === site)) selectSite(site, false);
  else if (map) selectSite("bohyeon_obs", false); // 동아리 MT는 항상 영천
  else { state.selected = "bohyeon_obs"; renderList(); }
  // 휴대폰에선 상세 패널이 메인 화면을 가리므로 처음엔 닫아 둠
  if (!site && window.matchMedia("(max-width: 760px)").matches) document.body.classList.remove("detail-open");
  window.__app = state; // 디버깅용
  window.__map = map;
})();
