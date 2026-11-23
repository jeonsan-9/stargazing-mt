// 관측 점수 계산. SunCalc(전역)를 사용합니다.
//
// 시간별 점수 = 100 × 어둠 × 구름 × 달 × 습도 × 바람 × 미세먼지 × 시정 × 강수
// 밤 점수   = 그 밤 가장 좋은 연속 3시간의 평균 (관측 세션 기준)
// 기준은 starswithme.com 의 시간별 지수 방식(달 지면 점수가 크게 오름, 구름/바람/미세먼지/습도/시야)을 참고했고,
// 수치는 모두 무료 소스(Open-Meteo, MET Norway, 7Timer, 기상청)로 직접 계산합니다.

/* global SunCalc */

export const KST = "+09:00";
const DEG = 180 / Math.PI;

export function parseLocal(str) {
  return new Date(`${str}:00${KST}`);
}

export function ymd(date) {
  const k = new Date(date.getTime() + 9 * 3600e3);
  return k.toISOString().slice(0, 10);
}

export function addDays(ymdStr, n) {
  const d = new Date(`${ymdStr}T12:00:00${KST}`);
  d.setTime(d.getTime() + n * 86400e3);
  return ymd(d);
}

export function darkWindow(ymdStr, lat, lon) {
  const t0 = SunCalc.getTimes(new Date(`${ymdStr}T12:00:00${KST}`), lat, lon);
  const t1 = SunCalc.getTimes(new Date(`${addDays(ymdStr, 1)}T12:00:00${KST}`), lat, lon);
  return { dusk: t0.night, dawn: t1.nightEnd, sunset: t0.sunset, sunrise: t1.sunrise };
}

export function median(vals) {
  const v = vals.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function moonInfo(ymdStr, lat, lon) {
  const noon = new Date(`${ymdStr}T12:00:00${KST}`);
  const mid = new Date(`${addDays(ymdStr, 1)}T00:00:00${KST}`);
  const ill = SunCalc.getMoonIllumination(mid);
  const a = SunCalc.getMoonTimes(noon, lat, lon);
  const b = SunCalc.getMoonTimes(mid, lat, lon);
  const pickAfter = (x, y) => (x && x > noon ? x : y);
  return {
    fraction: ill.fraction,
    phase: ill.phase,
    phaseName: phaseName(ill.phase),
    rise: pickAfter(a.rise, b.rise),
    set: pickAfter(a.set, b.set),
  };
}

function phaseName(p) {
  if (p < 0.03 || p > 0.97) return "삭 (그믐)";
  if (p < 0.22) return "초승달";
  if (p < 0.28) return "상현달";
  if (p < 0.47) return "상현~보름";
  if (p < 0.53) return "보름달";
  if (p < 0.72) return "보름~하현";
  if (p < 0.78) return "하현달";
  return "그믐달";
}

// ---------- 요소별 감점 (1 = 감점 없음) ----------
export const factor = {
  dark(sunAltDeg) {
    if (sunAltDeg <= -18) return 1;
    if (sunAltDeg <= -12) return 0.7;
    if (sunAltDeg <= -6) return 0.35;
    return 0;
  },
  cloud(pct) {
    if (pct == null) return 1;
    return Math.pow(1 - Math.min(100, pct) / 100, 1.6);
  },
  moon(altDeg, illum) {
    if (altDeg <= 0) return 1;
    // 보름달이 높이 뜨면 하늘이 약 20배 밝아져 은하수·성운은 거의 안 보임 → 절반까지 깎음
    return 1 - 0.5 * illum * Math.min(1, (altDeg + 3) / 25);
  },
  rh(v) {
    if (v == null) return 1;
    if (v >= 95) return 0.75;
    if (v >= 90) return 0.85;
    if (v >= 80) return 0.93;
    return 1;
  },
  wind(ms) {
    if (ms == null) return 1;
    if (ms > 10) return 0.75;
    if (ms > 7) return 0.88;
    if (ms > 5) return 0.95;
    return 1;
  },
  pm25(v) {
    if (v == null) return 1;
    if (v > 75) return 0.7;
    if (v > 35) return 0.82;
    if (v > 15) return 0.93;
    return 1;
  },
  // 비가 오면 관측 불가에 가깝게
  precip(mm) {
    if (mm == null) return 1;
    if (mm >= 1) return 0.05;
    if (mm >= 0.3) return 0.25;
    if (mm >= 0.1) return 0.6;
    return 1;
  },
  vis(m) {
    if (m == null) return 1;
    if (m < 5000) return 0.8;
    if (m < 10000) return 0.9;
    return 1;
  },
};

// 하층/중층/상층을 합친 실효 구름량. 상층(권운)은 얇아서 조금 덜 가린다고 봄
export function effectiveCloud(total, low, mid, high) {
  if (low == null && mid == null && high == null) return total;
  const L = (low ?? 0) / 100;
  const M = (mid ?? 0) / 100;
  const H = (high ?? 0) / 100;
  const layered = 100 * (1 - (1 - L) * (1 - M) * (1 - 0.7 * H));
  return total == null ? layered : 0.5 * total + 0.5 * layered;
}

function medianOf(siteData, key, i) {
  return median(Object.values(siteData.models).map((m) => m[key]?.[i]));
}

// 한 시각의 점수와 요소들
export function scoreHour(data, site, i) {
  const siteData = data.sites[site.id];
  const t = parseLocal(data.times[i]);
  const sunAlt = SunCalc.getPosition(t, site.lat, site.lon).altitude * DEG;
  const moonAlt = SunCalc.getMoonPosition(t, site.lat, site.lon).altitude * DEG;
  const illum = SunCalc.getMoonIllumination(t).fraction;

  const totals = Object.values(siteData.models)
    .map((m) => m.cloud?.[i])
    .filter((v) => v != null);
  const total = median(totals);
  const low = medianOf(siteData, "low", i);
  const mid = medianOf(siteData, "mid", i);
  const high = medianOf(siteData, "high", i);
  const cloud = effectiveCloud(total, low, mid, high);
  const rh = medianOf(siteData, "rh", i);
  const wind = medianOf(siteData, "wind", i);
  const vis = medianOf(siteData, "vis", i);
  const temp = medianOf(siteData, "temp", i);
  const precip = medianOf(siteData, "precip", i);
  // 비는 중앙값만 보면 놓침: 모델 9개 중 4개가 비를 예보해도 중앙값은 0mm. 비를 예보한 모델 비율을 따로 셈
  const rains = Object.values(siteData.models).map((m) => m.precip?.[i]).filter((v) => v != null);
  const rainShare = rains.length >= 3 ? rains.filter((v) => v >= 0.1).length / rains.length : null;
  const pm25 = siteData.air?.pm25?.[i] ?? null;
  const pm10 = siteData.air?.pm10?.[i] ?? null;
  const seeing = siteData.astro?.seeing?.[i] ?? null;
  const transparency = siteData.astro?.transparency?.[i] ?? null;

  const f = {
    dark: factor.dark(sunAlt),
    cloud: factor.cloud(cloud),
    moon: factor.moon(moonAlt, illum),
    rh: factor.rh(rh),
    wind: factor.wind(wind),
    pm: factor.pm25(pm25),
    vis: factor.vis(vis),
    precip: Math.min(factor.precip(precip), rainShare != null && rainShare >= 0.3 ? 1 - 0.5 * rainShare : 1),
  };
  const product = Object.values(f).reduce((a, b) => a * b, 1);
  const score = totals.length ? Math.round(100 * product) : null;
  const spread = totals.length > 1 ? Math.max(...totals) - Math.min(...totals) : 0;

  return {
    i, t, score, f, sunAlt, moonAlt, illum,
    total, low, mid, high, cloud, rh, wind, vis, temp, precip, rainShare, rainN: rains.length, pm25, pm10, seeing, transparency,
    spread, n: totals.length,
  };
}

// 저녁 18시 ~ 다음날 06시 시각 인덱스
export function nightIndices(data, ymdStr) {
  const start = parseLocal(`${ymdStr}T18:00`);
  const end = parseLocal(`${addDays(ymdStr, 1)}T06:00`);
  const idx = [];
  data.times.forEach((t, i) => {
    const d = parseLocal(t);
    if (d >= start && d < end) idx.push(i);
  });
  return idx;
}

const WINDOW = 3; // 시간

// 한 관측지의 하룻밤 결과. 같은 예보에서는 답이 변하지 않으므로 한 번 계산한 밤은 기억해 둠
// (밤 버튼 7개 × 관측지 31곳을 화면을 그릴 때마다 다시 계산하지 않게)
const nightCache = new WeakMap();
export function scoreNight(data, site, ymdStr) {
  if (!data.sites[site.id]) return null;
  let cache = nightCache.get(data);
  if (!cache) nightCache.set(data, (cache = new Map()));
  const key = `${site.id}|${ymdStr}`;
  if (!cache.has(key)) cache.set(key, computeNight(data, site, ymdStr));
  return cache.get(key);
}

function computeNight(data, site, ymdStr) {
  const hours = nightIndices(data, ymdStr).map((i) => scoreHour(data, site, i));
  const dark = hours.filter((h) => h.f.dark > 0 && h.score != null);
  const { dusk, dawn } = darkWindow(ymdStr, site.lat, site.lon);
  if (!dark.length) return { site, hours, score: null, models: {}, dusk, dawn };

  // 가장 좋은 연속 3시간
  // 시간축에서 실제로 이어진 3시간만 (자료가 빠진 시각을 건너뛰어 묶지 않음)
  const span = Math.min(WINDOW, dark.length);
  let best = { avg: -1, from: 0 };
  for (let k = 0; k + span <= dark.length; k++) {
    const win = dark.slice(k, k + span);
    if (win.some((hour, i) => i > 0 && hour.t - win[i - 1].t !== 3600e3)) continue;
    const avg = win.reduce((a, h) => a + h.score, 0) / win.length;
    if (avg > best.avg) best = { avg, from: k };
  }
  if (best.avg < 0) return { site, hours, score: null, models: {}, dusk, dawn };
  const win = dark.slice(best.from, best.from + WINDOW);
  const peak = dark.reduce((a, h) => (h.score > a.score ? h : a), dark[0]);
  const goodHours = dark.filter((h) => h.score >= 70).length;
  const spread = win.reduce((a, h) => a + h.spread, 0) / win.length;
  const minModels = Math.min(...win.map((h) => h.n));
  const agreement = minModels < 2 ? "비교 불가" : spread < 20 ? "높음" : spread < 40 ? "보통" : "낮음";
  const cloud = Math.round(win.reduce((a, h) => a + (h.cloud ?? 0), 0) / win.length);
  // 이슬: 기온과 이슬점 차이가 작으면 렌즈·경통에 이슬이 맺힘
  const gaps = dark.map((h) => (h.temp == null ? null : h.temp - dewPoint(h.temp, h.rh))).filter((x) => x != null && Number.isFinite(x));
  const dewGap = gaps.length ? Math.min(...gaps) : null;
  const dew = dewGap == null ? null : dewGap < 2 ? "높음" : dewGap < 4 ? "주의" : "낮음";

  // 모델별 평균 구름 (가장 좋은 시간대 기준)
  const models = {};
  for (const [m, v] of Object.entries(data.sites[site.id].models)) {
    const vals = win.map((h) => v.cloud?.[h.i]).filter((x) => x != null);
    if (vals.length) models[m] = Math.round(vals.reduce((a, x) => a + x, 0) / vals.length);
  }

  // 가장 좋은 3시간 안에서 비를 예보한 모델이 가장 많았던 시각
  const rainHour = win.reduce((a, h) => ((h.rainShare ?? 0) > (a?.rainShare ?? 0) ? h : a), null);
  const rainModels = rainHour?.rainShare >= 0.3 ? { wet: Math.round(rainHour.rainShare * rainHour.rainN), of: rainHour.rainN } : null;

  return {
    site, hours, dusk, dawn, models, agreement, spread, cloud, goodHours, dew, dewGap, rainModels,
    score: Math.round(best.avg),
    windowStart: win[0].t,
    windowEnd: new Date(win[win.length - 1].t.getTime() + 3600e3),
    peak,
  };
}

// 점수를 한마디로
export function verdict(score) {
  if (score == null) return { word: "예보 없음", cls: "none" };
  if (score >= 80) return { word: "최고", cls: "best" };
  if (score >= 60) return { word: "좋음", cls: "good" };
  if (score >= 40) return { word: "애매", cls: "mid" };
  if (score >= 20) return { word: "나쁨", cls: "bad" };
  return { word: "쉬는 날", cls: "off" };
}

// Magnus 식 이슬점 (°C)
export function dewPoint(temp, rh) {
  if (temp == null || rh == null || rh <= 0) return null;
  const g = Math.log(rh / 100) + (17.62 * temp) / (243.12 + temp);
  return (243.12 * g) / (17.62 - g);
}

export function scoreColor(score, alpha = 230) {
  if (score == null) return [120, 120, 120, alpha];
  const s = Math.max(0, Math.min(100, score)) / 100;
  const r = s < 0.5 ? 240 : Math.round(240 - (s - 0.5) * 2 * 180);
  const g = s < 0.5 ? Math.round(70 + s * 2 * 150) : 220;
  return [r, g, 80, alpha];
}
