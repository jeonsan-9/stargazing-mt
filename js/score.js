// 관측 점수 계산. SunCalc(전역)를 사용합니다.
// 점수 = 밤 시간(천문박명 사이) 각 시각의 (1 - 구름 중간값) × 달빛 감점 × 습도 감점의 평균 × 100

/* global SunCalc */

export const KST = "+09:00";

export function parseLocal(str) {
  // Open-Meteo "2026-11-21T18:00" (Asia/Seoul) -> Date
  return new Date(`${str}:00${KST}`);
}

export function ymd(date) {
  // KST 기준 YYYY-MM-DD
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
  const mid = new Date(`${addDays(ymdStr, 1)}T00:00:00${KST}`);
  const ill = SunCalc.getMoonIllumination(mid);
  const times = SunCalc.getMoonTimes(new Date(`${ymdStr}T12:00:00${KST}`), lat, lon);
  const timesNext = SunCalc.getMoonTimes(new Date(`${addDays(ymdStr, 1)}T00:00:00${KST}`), lat, lon);
  return {
    fraction: ill.fraction,
    phase: ill.phase,
    phaseName: phaseName(ill.phase),
    rise: times.rise && times.rise > new Date(`${ymdStr}T12:00:00${KST}`) ? times.rise : timesNext.rise,
    set: times.set && times.set > new Date(`${ymdStr}T12:00:00${KST}`) ? times.set : timesNext.set,
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

function rhFactor(rh) {
  if (rh == null) return 1;
  if (rh >= 95) return 0.7;
  if (rh >= 85) return 0.9;
  return 1;
}

// 한 관측지의 하룻밤 점수
export function scoreNight(data, site, ymdStr) {
  const siteData = data.sites[site.id];
  if (!siteData) return null;
  const { dusk, dawn } = darkWindow(ymdStr, site.lat, site.lon);
  const modelKeys = Object.keys(siteData.models);
  const hours = [];

  data.times.forEach((tStr, i) => {
    const t = parseLocal(tStr);
    if (t < dusk || t > dawn) return;
    const clouds = modelKeys.map((m) => siteData.models[m].cloud?.[i]).filter((v) => v != null);
    if (!clouds.length) return;
    const rhs = modelKeys.map((m) => siteData.models[m].rh?.[i]).filter((v) => v != null);
    const med = median(clouds);
    const spread = Math.max(...clouds) - Math.min(...clouds);
    const moon = SunCalc.getMoonPosition(t, site.lat, site.lon);
    const moonUp = moon.altitude > 0;
    const ill = SunCalc.getMoonIllumination(t).fraction;
    const moonPenalty = moonUp ? ill : 0;
    const s = (1 - med / 100) * (1 - 0.6 * moonPenalty) * rhFactor(median(rhs));
    hours.push({ i, t, cloud: med, spread, moonUp, score: s, n: clouds.length });
  });

  if (!hours.length) return { site, hours, score: null, models: {}, dusk, dawn };

  const score = Math.round((hours.reduce((a, h) => a + h.score, 0) / hours.length) * 100);
  const cloud = Math.round(hours.reduce((a, h) => a + h.cloud, 0) / hours.length);
  const spread = hours.reduce((a, h) => a + h.spread, 0) / hours.length;
  const agreement = spread < 20 ? "높음" : spread < 40 ? "보통" : "낮음";

  const models = {};
  for (const m of modelKeys) {
    const vals = hours.map((h) => siteData.models[m].cloud?.[h.i]).filter((v) => v != null);
    if (vals.length) models[m] = Math.round(vals.reduce((a, v) => a + v, 0) / vals.length);
  }
  return { site, hours, score, cloud, spread, agreement, models, dusk, dawn };
}

export function scoreColor(score, alpha = 230) {
  if (score == null) return [120, 120, 120, alpha];
  // 0 빨강 -> 50 노랑 -> 100 초록
  const s = Math.max(0, Math.min(100, score)) / 100;
  const r = s < 0.5 ? 240 : Math.round(240 - (s - 0.5) * 2 * 180);
  const g = s < 0.5 ? Math.round(70 + s * 2 * 150) : 220;
  const b = 80;
  return [r, g, b, alpha];
}
