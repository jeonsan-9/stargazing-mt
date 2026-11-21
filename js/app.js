/* global maplibregl, deck, SunCalc */
import { SITES, DEPARTURE } from "./sites.js";
import { MODELS, GRID_MODELS, modelLabel } from "./models.js";
import { loadForecast } from "./data.js";
import { renderMonth, renderSemester, renderYear, moonIcon } from "./longrange.js";
import { scoreNight, scoreColor, moonInfo, darkWindow, parseLocal, ymd, addDays, nightIndices } from "./score.js";

const EXAG = 3; // 지형 과장 배율 (한반도 산은 낮아서 3배로 키워야 높낮이가 보임)
const CLOUD_ALT = 2500; // 구름층 고도 (m, 과장 전)

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
const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [128.95, 36.12],
  zoom: 8.6,
  pitch: 62,
  bearing: -20,
  maxPitch: 75,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
map.addControl(overlay);

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
      map.setPaintProperty(id, "text-color", id === "place_state" ? "#5d6a90" : "#9fabcf");
      map.setPaintProperty(id, "text-halo-color", "rgba(6,9,20,0.85)");
      map.setPaintProperty(id, "text-halo-width", 1.4);
      continue;
    }
    if (HIDE.test(id)) {
      map.setLayoutProperty(id, "visibility", "none");
      continue;
    }
    if (id === "background") map.setPaintProperty(id, "background-color", "#0b1124");
    else if (id === "water") map.setPaintProperty(id, "fill-color", "#04060f");
    else if (id === "waterway") map.setPaintProperty(id, "line-color", "#0a1022");
    else if (id === "landcover" || id === "landuse" || id === "park_national_park") map.setPaintProperty(id, "fill-opacity", 0.0);
    else if (id.startsWith("boundary_state")) {
      map.setPaintProperty(id, "line-color", "#2c3a66");
      map.setPaintProperty(id, "line-opacity", 0.7);
    } else if (id.startsWith("boundary_country")) map.setPaintProperty(id, "line-color", "#3a4a80");
    else if (/^(road|bridge)_(mot|trunk)/.test(id)) {
      map.setPaintProperty(id, "line-color", id.includes("case") ? "rgba(0,0,0,0)" : "#26315a");
      map.setPaintProperty(id, "line-opacity", 0.55);
    }
  }
}

map.on("load", () => {
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
        "hillshade-shadow-color": "#000000",
        "hillshade-highlight-color": "#b8c8f0",
        "hillshade-accent-color": "#1b2440",
        "hillshade-illumination-direction": 315,
      },
    },
    firstSymbol
  );
  map.setSky({
    "sky-color": "#0b1020",
    "horizon-color": "#22305a",
    "fog-color": "#0b1020",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.4,
  });
  apply3D();
  updateLighting();
});

function apply3D() {
  if (!map.getSource("dem")) return;
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
      img.data[p] = 235;
      img.data[p + 1] = 240;
      img.data[p + 2] = 250;
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
  big.filter = "blur(10px)";
  big.drawImage(small, 0, 0, cloudCanvas.width, cloudCanvas.height);
  big.filter = "none";
  // 구름 질감: 미리 만든 잡음으로 가장자리를 뭉게뭉게하게
  big.globalCompositeOperation = "destination-in";
  big.drawImage(noiseCanvas(cloudCanvas.width, cloudCanvas.height), 0, 0);
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

// ---------- 달빛 조명 ----------
// 슬라이더 시각의 달 위치(방위, 고도)와 위상으로 지형 음영 방향과 밝기, 하늘색을 바꿈
const LIGHT_POINT = [36.0, 128.8];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c.join(",")})`;

function updateLighting() {
  if (!state.data || !map.getLayer("hillshade")) return;
  const t = currentTime();
  const [lat, lon] = LIGHT_POINT;
  const mp = SunCalc.getMoonPosition(t, lat, lon);
  const sp = SunCalc.getPosition(t, lat, lon);
  const ill = SunCalc.getMoonIllumination(t).fraction;
  const moonAlt = (mp.altitude * 180) / Math.PI;
  const sunAlt = (sp.altitude * 180) / Math.PI;
  const az = ((mp.azimuth * 180) / Math.PI + 180 + 360) % 360; // 북=0, 시계방향
  const moonLight = moonAlt > 0 ? ill * Math.min(1, (moonAlt + 2) / 30) : 0;
  const twilight = sunAlt > -18 ? Math.min(1, (sunAlt + 18) / 18) : 0;

  const dark = [34, 42, 66];
  const moonlit = [214, 224, 255];
  const dusk = [255, 190, 150];
  let hi = mix(dark, moonlit, moonLight);
  if (twilight > 0) hi = mix(hi, dusk, twilight * 0.6);
  map.setPaintProperty("hillshade", "hillshade-highlight-color", rgb(hi));
  map.setPaintProperty("hillshade", "hillshade-exaggeration", 0.55 + 0.45 * Math.max(moonLight, twilight));
  map.setPaintProperty("hillshade", "hillshade-illumination-anchor", "map");
  map.setPaintProperty(
    "hillshade",
    "hillshade-illumination-direction",
    moonLight > 0.02 ? az : ((sp.azimuth * 180) / Math.PI + 180 + 360) % 360
  );
  const skyBase = [11, 16, 32];
  const sky = mix(mix(skyBase, [40, 52, 88], moonLight), [70, 60, 90], twilight * 0.7);
  map.setSky({
    "sky-color": rgb(sky),
    "horizon-color": rgb(mix(sky, [120, 130, 170], 0.35 + 0.3 * moonLight)),
    "fog-color": rgb(sky),
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.4,
  });
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
  const layers = [];

  if (state.showCloud) {
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

  layers.push(
    new deck.ColumnLayer({
      id: "sites",
      data: visible,
      diskResolution: 32,
      radius: 1800,
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
          : [r.site.lon, r.site.lat, siteZ(r) + (state.is3D ? 300 + (r.score ?? 0) * 60 : 0)],
      getText: (r) => (r.departure ? "출발 · 계명대" : `${r.site.name} ${r.score ?? "-"}`),
      getSize: (r) => (r.site.primary || r.departure ? 14 : 12),
      getColor: (r) => (r.departure ? [150, 200, 255, 255] : r.site.primary ? [255, 255, 255, 255] : [200, 205, 215, 230]),
      getPixelOffset: [0, -14],
      background: true,
      getBackgroundColor: [10, 14, 25, 190],
      backgroundPadding: [5, 3],
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

function renderNights() {
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
    const v = +slider.value;
    const k = Math.min(Math.floor(v), idx.length - 1);
    state.hourIdx = idx[k];
    state.nextIdx = idx[Math.min(k + 1, idx.length - 1)];
    state.hourFrac = k + 1 < idx.length ? v - k : 0;
    updateHourLabel();
    updateLighting();
    renderLayers();
  };
  slider.oninput();
}

function currentTime() {
  return new Date(parseLocal(state.data.times[state.hourIdx]).getTime() + state.hourFrac * 3600e3);
}

function updateHourLabel() {
  const t = currentTime();
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
      h.textContent = r.site.primary ? "영천 · 동아리 MT 장소" : "비교용 (영천이 흐릴 때 대안)";
      list.appendChild(h);
      lastPrimary = r.site.primary;
    }
    const el = document.createElement("button");
    el.className = "site" + (state.selected === r.site.id ? " active" : "");
    el.innerHTML = `
      <span class="score" style="background:rgba(${scoreColor(r.score).slice(0, 3).join(",")},.92)">${r.score ?? "-"}</span>
      <span class="sname">${r.site.name}${r.site.verified ? "" : ' <em title="좌표 확인 필요">위치 확인 필요</em>'}<small>${r.score == null ? "예보 없음" : `최적 ${fmtHour(r.windowStart)}~${fmtHour(r.windowEnd)} · 좋은 시간 ${r.goodHours}h · 모델 일치 ${r.agreement}`}</small></span>`;
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
  return cell(Math.round(v), "c", `background:rgba(225,232,245,${a.toFixed(2)});color:${v > 55 ? "#0b1020" : "#e6edf3"}`);
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
    .map((h) => cell("", "dk", `background:rgba(10,14,30,${(1 - h.f.dark * 0.9).toFixed(2)});`, `태양 고도 ${Math.round(h.sunAlt)}°`))
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
      ${row("기온", hrs.map((h) => (h.temp == null ? cell("·", "na") : cell(Math.round(h.temp)))).join(""), "°C")}
    </tbody>
  </table></div>`;
}

function renderDetail() {
  const box = $("detail");
  const r = state.results.find((x) => x.site.id === state.selected);
  if (!r) {
    box.innerHTML = `<p class="hint">관측지를 누르면 시간별 예보표와 그날 밤 달 정보가 보입니다.</p>`;
    return;
  }
  const moon = moonInfo(state.night, r.site.lat, r.site.lon);
  const dw = darkWindow(state.night, r.site.lat, r.site.lon);
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
    <h3>${r.site.name} <span class="score" style="background:rgba(${cr},${cg},${cb},.92)">${r.score ?? "-"}</span></h3>
    <p class="lead">${
      r.score == null
        ? "이 밤의 예보 자료가 없습니다."
        : `가장 좋은 시간 <b>${fmtHour(r.windowStart)}~${fmtHour(r.windowEnd)}</b> · 70점 넘는 시간 <b>${r.goodHours}시간</b> · 최고 ${r.peak.score}점 (${fmtHour(r.peak.t)})`
    }</p>
    <div class="kv"><span>해발</span><b>${elev != null ? Math.round(elev) + " m" : "-"}</b></div>
    <div class="kv"><span>천문박명 (완전히 어두운 시간)</span><b>${fmtTime(dw.dusk)} ~ ${fmtTime(dw.dawn)}</b></div>
    <div class="kv"><span>달</span><b>${moon.phaseName} · ${Math.round(moon.fraction * 100)}% · 뜸 ${fmtTime(moon.rise)} / 짐 ${fmtTime(moon.set)}</b></div>
    <h4>시간별 예보</h4>
    ${hourTable(r)}
    <h4>모델별 구름량 (가장 좋은 3시간 평균)</h4>
    ${bars || '<p class="hint">자료 없음</p>'}
    <p class="hint">모델 일치도 ${r.agreement ?? "-"} (모델 간 평균 차이 ${r.spread != null ? Math.round(r.spread) : "-"}%p)</p>`;
}

function avg(a) {
  return (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
}

function selectSite(id, fly) {
  state.selected = id;
  renderList();
  renderDetail();
  document.body.classList.add("detail-open");
  if (fly) {
    const s = SITES.find((x) => x.id === id);
    map.flyTo({ center: [s.lon, s.lat], zoom: 9.5, pitch: state.is3D ? 65 : 0, duration: 1200 });
  }
}

function setNight(n) {
  state.night = n;
  recompute();
  renderNights();
  renderHourSlider();
  renderList();
  renderDetail();
  renderLayers();
}

// ---------- 컨트롤 ----------
$("toggle3d").onclick = () => {
  state.is3D = !state.is3D;
  $("toggle3d").textContent = state.is3D ? "평면 보기" : "3D 보기";
  apply3D();
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
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  ["week", "month", "sem", "year"].forEach((k) => ($(`view-${k}`).hidden = k !== v));
  renderView();
}
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));

// ---------- 시작 ----------
(async () => {
  try {
    state.data = await loadForecast();
  } catch (e) {
    $("status").textContent = "예보를 불러오지 못했습니다: " + e.message;
    console.error(e);
    return;
  }
  const gen = new Date(state.data.generated);
  const srcCount = new Set(Object.values(state.data.sites).flatMap((s) => Object.keys(s.models))).size;
  $("status").textContent = `예보 ${srcCount}개 소스 · ${gen.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 기준${state.data.source === "live" ? " (실시간 Open-Meteo)" : ""}`;
  renderModelSelect();
  state.month = todayYmd().slice(0, 7);
  setNight(nightsAvailable()[0]);
  selectSite("bohyeon_obs", false); // 동아리 MT는 항상 영천
  window.__app = state; // 디버깅용
  window.__map = map;
})();
