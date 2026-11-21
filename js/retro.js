// 지난 MT 돌아보기: 실제 과거 기록(ERA5 재분석)으로 그날 밤을 채점하고
// 같은 학기의 다른 금·토 밤과 비교
/* global SunCalc */
import { factor } from "./score.js";
import { PAST_MTS, academic, shift } from "./calendar.js";

const KST = "+09:00";
const DEG = 180 / Math.PI;
const WD = ["일", "월", "화", "수", "목", "금", "토"];

async function archive(lat, lon, start, end) {
  const u =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${start}&end_date=${end}&hourly=cloud_cover,precipitation,relative_humidity_2m&timezone=Asia%2FSeoul`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`archive ${r.status}`);
  return r.json();
}

function localKey(t) {
  return new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 13) + ":00";
}

// 한 밤: 12시~다음날 06시 비, 18시~06시 시간별 점수 → 가장 좋은 3시간 평균
function judge(H, idx, ymd, lat, lon) {
  const noon = new Date(`${ymd}T12:00:00${KST}`);
  let rain = 0;
  let any = false;
  const hs = [];
  const clouds = [];
  for (let h = 0; h <= 18; h++) {
    const t = new Date(noon.getTime() + h * 3600e3);
    const i = idx[localKey(t)];
    if (i == null) continue;
    any = true;
    if (h < 18) rain += H.precipitation[i] ?? 0;
    if (h < 6) continue;
    const sun = SunCalc.getPosition(t, lat, lon).altitude * DEG;
    const ma = SunCalc.getMoonPosition(t, lat, lon).altitude * DEG;
    const il = SunCalc.getMoonIllumination(t).fraction;
    const c = H.cloud_cover[i];
    const d = factor.dark(sun);
    if (d > 0 && c != null) hs.push(100 * d * factor.cloud(c) * factor.moon(ma, il) * factor.rh(H.relative_humidity_2m[i]) * factor.precip(H.precipitation[i]));
    if (h >= 9 && h <= 15 && c != null) clouds.push(c);
  }
  if (!any || hs.length < 3) return null;
  let best = 0;
  for (let k = 0; k + 3 <= hs.length; k++) best = Math.max(best, (hs[k] + hs[k + 1] + hs[k + 2]) / 3);
  const mid = new Date(noon.getTime() + 12 * 3600e3);
  return {
    ymd,
    score: Math.round(best),
    rain: Math.round(rain * 10) / 10,
    cloud: clouds.length ? Math.round(clouds.reduce((a, b) => a + b, 0) / clouds.length) : null,
    moon: Math.round(SunCalc.getMoonIllumination(mid).fraction * 100),
  };
}

const md = (ymd) => {
  const d = new Date(`${ymd}T12:00:00${KST}`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
};

export async function renderRetro(box, site) {
  box.innerHTML = `<p class="hint">지난 MT 날씨를 불러오는 중…</p>`;
  // 세 학기를 동시에 불러옴
  const rows = await Promise.all(PAST_MTS.map(async (mt) => {
    const [y, m] = mt.ymd.split("-").map(Number);
    const sem = academic(y, m <= 8 ? 1 : 2);
    // 재분석 자료는 며칠 늦게 올라오므로 사흘 전까지만
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const last = [sem.end, shift(today, -3)].sort()[0];
    const end = shift(last > mt.ymd ? last : mt.ymd, 1);
    try {
      const j = await archive(site.lat, site.lon, sem.start, end);
      const H = j.hourly;
      const idx = {};
      H.time.forEach((t, i) => (idx[t] = i));
      const nights = [];
      for (let d = sem.start; d <= last; d = shift(d, 1)) {
        const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
        if (wd !== 5 && wd !== 6 && d !== mt.ymd) continue;
        const r = judge(H, idx, d, site.lat, site.lon);
        if (r) nights.push(r);
      }
      const me = nights.find((n) => n.ymd === mt.ymd);
      const ranked = [...nights].sort((a, b) => b.score - a.score);
      return { mt, me, rank: me ? ranked.indexOf(me) + 1 : null, n: nights.length, best: ranked.slice(0, 2) };
    } catch (e) {
      return { mt, err: String(e) };
    }
  }));
  box.innerHTML = rows
    .map((r) => {
      if (r.err || !r.me) return `<div class="retro"><b>${r.mt.sem} · ${md(r.mt.ymd)}</b><small>기록을 불러오지 못했어요</small></div>`;
      const { me } = r;
      const verdict = me.score >= 70 ? "좋은 밤 🎉" : me.score >= 40 ? "그럭저럭" : me.rain >= 1 ? "비 ☔" : "흐림 ☁️";
      return `<div class="retro">
        <div class="rh"><b>${r.mt.sem} · ${md(me.ymd)}</b><span class="rv">${verdict}</span></div>
        <div class="rs"><span>비 <b>${me.rain}mm</b></span><span>밤 구름 <b>${me.cloud ?? "-"}%</b></span><span>달 <b>${me.moon}%</b></span><span>점수 <b>${me.score}</b></span></div>
        <small>그 학기 금·토 ${r.n}밤 중 <b>${r.rank}위</b>. 가장 좋았던 밤: ${r.best.map((b) => `${md(b.ymd)} ${b.score}점`).join(", ")}</small>
      </div>`;
    })
    .join("");
}
