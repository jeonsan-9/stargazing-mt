/* global maplibregl, deck */
import { SITES, DEPARTURE } from "./sites.js";
import { MODELS, GRID_MODELS, modelLabel } from "./models.js";
import { loadForecast } from "./data.js";
import { scoreNight, scoreColor, moonInfo, darkWindow, parseLocal, ymd, addDays } from "./score.js";

const EXAG = 3; // 지형 과장 배율 (한반도 산은 낮아서 3배로 키워야 높낮이가 보임)
const CLOUD_ALT = 2500; // 구름층 고도 (m, 과장 전)

const state = {
  data: null,
  night: null, // YYYY-MM-DD (저녁 날짜)
  hourIdx: 0, // data.times 인덱스
  cloudModel: "ecmwf_ifs025",
  showCloud: true,
  is3D: true,
  showExtra: true,
  selected: null,
  results: [],
};

const $ = (id) => document.getElementById(id);
const fmtTime = (d) =>
  d && !isNaN(d) ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }) : "-";
const WD = ["일", "월", "화", "수", "목", "금", "토"];

// ---------- 지도 ----------
const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [128.75, 35.95],
  zoom: 8,
  pitch: 62,
  bearing: -20,
  maxPitch: 75,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
map.addControl(overlay);

map.on("load", () => {
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
        "hillshade-exaggeration": 0.85,
        "hillshade-shadow-color": "#000000",
        "hillshade-highlight-color": "#6f86b8",
        "hillshade-accent-color": "#1b2440",
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

function cloudImage() {
  const g = state.data?.grid;
  const field = g?.models?.[state.cloudModel]?.[state.hourIdx];
  if (!field) return null;
  const key = `${state.cloudModel}:${state.hourIdx}`;
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
  cloudCanvas.width = nLon * 24;
  cloudCanvas.height = nLat * 24;
  const big = cloudCanvas.getContext("2d");
  big.imageSmoothingEnabled = true;
  big.imageSmoothingQuality = "high";
  big.drawImage(small, 0, 0, cloudCanvas.width, cloudCanvas.height);
  cloudKey = key;
  cloudCache.set(key, cloudCanvas);
  return cloudCanvas;
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
    const image = cloudImage();
    if (image) {
      layers.push(
        new deck.BitmapLayer({
          id: "cloud-" + cloudKey,
          image,
          bounds: cloudBounds(state.is3D ? CLOUD_ALT * EXAG : 0),
          opacity: 0.9,
          parameters: { depthTest: false },
        })
      );
    }
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
  const times = state.data.times;
  const start = parseLocal(`${state.night}T18:00`);
  const end = parseLocal(`${addDays(state.night, 1)}T06:00`);
  const idx = [];
  times.forEach((t, i) => {
    const d = parseLocal(t);
    if (d >= start && d <= end) idx.push(i);
  });
  return idx;
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
    const moon = moonInfo(n, 36, 128.7);
    const btn = document.createElement("button");
    btn.className = "night" + (n === state.night ? " active" : "");
    btn.innerHTML = `<span class="nd">${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})</span>
      <span class="ns" style="background:rgba(${scoreColor(best).slice(0, 3).join(",")},.9)">${best}</span>
      <span class="nm">달 ${Math.round(moon.fraction * 100)}%</span>`;
    btn.onclick = () => setNight(n);
    box.appendChild(btn);
  }
}

function renderHourSlider() {
  const idx = nightHourIndices();
  const slider = $("hour");
  slider.min = 0;
  slider.max = Math.max(0, idx.length - 1);
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
    state.hourIdx = idx[+slider.value];
    updateHourLabel();
    renderLayers();
  };
  updateHourLabel();
}

function updateHourLabel() {
  const t = parseLocal(state.data.times[state.hourIdx]);
  const has = !!state.data.grid?.models?.[state.cloudModel]?.[state.hourIdx];
  const md = t.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
  $("hourLabel").textContent = `${md} ${fmtTime(t)}${has ? "" : " (구름 자료 없음)"}`;
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
      h.textContent = r.site.primary ? "동아리 관측지" : "비교용 후보";
      list.appendChild(h);
      lastPrimary = r.site.primary;
    }
    const el = document.createElement("button");
    el.className = "site" + (state.selected === r.site.id ? " active" : "");
    el.innerHTML = `
      <span class="score" style="background:rgba(${scoreColor(r.score).slice(0, 3).join(",")},.92)">${r.score ?? "-"}</span>
      <span class="sname">${r.site.name}${r.site.verified ? "" : ' <em title="좌표 확인 필요">위치 확인 필요</em>'}<small>${r.site.region} · 구름 ${r.cloud ?? "-"}% · 모델 일치 ${r.agreement ?? "-"}</small></span>`;
    el.onclick = () => selectSite(r.site.id, true);
    list.appendChild(el);
  }
}

function renderDetail() {
  const box = $("detail");
  const r = state.results.find((x) => x.site.id === state.selected);
  if (!r) {
    box.innerHTML = `<p class="hint">관측지를 누르면 모델별 예보와 그날 밤 달 정보가 보입니다.</p>`;
    return;
  }
  const moon = moonInfo(state.night, r.site.lat, r.site.lon);
  const dw = darkWindow(state.night, r.site.lat, r.site.lon);
  const elev = state.data.sites[r.site.id]?.elevation;
  const bars = Object.entries(r.models)
    .sort((a, b) => a[1] - b[1])
    .map(
      ([m, v]) => `<div class="bar"><span class="bl">${modelLabel(m)}</span>
        <span class="bt"><span style="width:${v}%;background:${MODELS[m]?.color ?? "#888"}"></span></span>
        <span class="bv">${v}%</span></div>`
    )
    .join("");
  const seeing = state.data.sites[r.site.id]?.astro;
  let seeingRow = "";
  if (seeing?.seeing) {
    const vals = r.hours.map((h) => seeing.seeing[h.i]).filter((v) => v != null);
    const tr = r.hours.map((h) => seeing.transparency?.[h.i]).filter((v) => v != null);
    if (vals.length)
      seeingRow = `<div class="kv"><span>시상 / 투명도 (7Timer, 1 좋음~8 나쁨)</span><b>${avg(vals)} / ${avg(tr)}</b></div>`;
  }
  box.innerHTML = `
    <h3>${r.site.name} <span class="score" style="background:rgba(${scoreColor(r.score).slice(0, 3).join(",")},.92)">${r.score ?? "-"}</span></h3>
    <div class="kv"><span>고도</span><b>${elev != null ? Math.round(elev) + " m" : "-"}</b></div>
    <div class="kv"><span>천문박명 (완전히 어두운 시간)</span><b>${fmtTime(dw.dusk)} ~ ${fmtTime(dw.dawn)}</b></div>
    <div class="kv"><span>달</span><b>${moon.phaseName} · 밝기 ${Math.round(moon.fraction * 100)}%</b></div>
    <div class="kv"><span>달 뜸 / 짐</span><b>${fmtTime(moon.rise)} / ${fmtTime(moon.set)}</b></div>
    ${seeingRow}
    <h4>밤 시간 평균 구름량 (모델별)</h4>
    ${bars || '<p class="hint">이 밤의 예보 자료가 없습니다.</p>'}
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
    slider.value = (+slider.value + 1) % (+slider.max + 1);
    slider.oninput();
  }, 700);
};
$("closeDetail").onclick = () => document.body.classList.remove("detail-open");

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
  setNight(nightsAvailable()[0]);
  window.__app = state; // 디버깅용
  window.__map = map;
})();
