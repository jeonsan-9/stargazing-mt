// 1년 / 학기 / 월 보기: 10년 기후 통계(맑은 밤 확률) + 월령으로 MT 날짜 추천
// 예보 범위 안의 날짜는 실제 예보 점수를 대신 씀

/* global SunCalc */
import { scoreNight, scoreColor, addDays, ymd } from "./score.js";
import { academic, conflict } from "./calendar.js";
import { renderRetro } from "./retro.js";

const KST = "+09:00";
const WD = ["일", "월", "화", "수", "목", "금", "토"];

export function moonIcon(phase, size = 14) {
  const r = 7;
  const k = Math.cos(phase * 2 * Math.PI);
  const waxing = phase < 0.5;
  const rx = Math.abs(k) * r;
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = k > 0 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  const path = `M ${r} 0 A ${r} ${r} 0 0 ${sweepOuter} ${r} ${2 * r} A ${rx} ${r} 0 0 ${sweepInner} ${r} 0 Z`;
  return `<svg class="nm" width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="#232a45"/><path d="${path}" fill="#f4e6b8"/></svg>`;
}

function dayOfYear(ymdStr) {
  const [, m, d] = ymdStr.split("-").map(Number);
  const ref = Date.UTC(2025, 0, 1);
  return Math.round((Date.UTC(2025, m - 1, m === 2 ? Math.min(d, 28) : d) - ref) / 86400e3);
}

// 그날 밤(20시~04시) 중 달빛이 없는 시간 비율
function moonDarkness(ymdStr, lat, lon) {
  let dark = 0;
  let n = 0;
  for (let h = 20; h <= 28; h++) {
    const t = new Date(`${ymdStr}T00:00:00${KST}`);
    t.setTime(t.getTime() + h * 3600e3);
    const alt = SunCalc.getMoonPosition(t, lat, lon).altitude;
    const ill = SunCalc.getMoonIllumination(t).fraction;
    if (alt <= 0 || ill < 0.12) dark++;
    else dark += 1 - Math.min(1, ill * Math.min(1, (alt * 180) / Math.PI / 25));
    n++;
  }
  return dark / n;
}

// 한 밤의 MT 점수. 예보가 있으면 예보, 없으면 통계
export function nightOutlook(data, site, ymdStr, statOnly = false) {
  const mid = new Date(`${addDays(ymdStr, 1)}T00:00:00${KST}`);
  const moon = SunCalc.getMoonIllumination(mid);
  const fc = scoreNight(data, site, ymdStr);
  if (!statOnly && fc && fc.score != null && fc.hours.filter((h) => h.n > 0).length >= 8) {
    return { ymd: ymdStr, score: fc.score, kind: "예보", moon, clear: null, dark: null };
  }
  const c = data.climate;
  if (!c) return { ymd: ymdStr, score: null, kind: "-", moon };
  const i = dayOfYear(ymdStr);
  const clear = c.doy_clear[i] ?? 0;
  const rain = c.doy_rain?.[i] ?? null;
  // 좋은 밤 = 10년 중 비가 안 오고(12시~다음날 06시) 밤하늘이 맑았던 비율
  const good = c.doy_good?.[i] ?? clear;
  const dark = moonDarkness(ymdStr, site.lat, site.lon);
  const score = Math.round(100 * good * (0.3 + 0.7 * dark));
  return { ymd: ymdStr, score, kind: "통계", moon, clear, rain, good, dark };
}

function dateOf(ymdStr) {
  return new Date(`${ymdStr}T12:00:00${KST}`);
}

// 예보는 점수, 통계는 "좋은 밤일 확률 %"로 구분해서 보여줌
function badge(score, kind = "예보") {
  const shown = score == null ? null : kind === "통계" ? Math.min(100, score * 1.8) : score; // 색 기준만 맞춤
  const [r, g, b] = scoreColor(shown);
  const txt = score == null ? "-" : kind === "통계" ? `${score}%` : score;
  return `<span class="ns${kind === "통계" ? " stat" : ""}" style="background:rgba(${r},${g},${b},.95)">${txt}</span>`;
}

// ---------- 학기 ----------
// MT는 몇 달 전에 정하므로 예보는 쓰지 않고 10년 기록(비·구름) + 월령만으로 순위를 매김
export function semesters(todayYmd) {
  const [y, m] = todayYmd.split("-").map(Number);
  const mk = (yy, half) => ({ ...academic(yy, half), name: `${yy}년 ${half}학기` });
  const list = m <= 6 ? [mk(y, 1), mk(y, 2)] : [mk(y, 2), mk(y + 1, 1)];
  return list.filter((s) => s.end >= todayYmd);
}

function odds(good) {
  if (good >= 0.42) return ["높음", "hi"];
  if (good >= 0.28) return ["보통", "mid"];
  return ["낮음", "lo"];
}

let retroHTML = null;
let retroJob = null;

export function renderSemester(box, data, site, todayYmd, onPick) {
  const html = semesters(todayYmd)
    .map((sem) => {
      const nights = [];
      for (let d = sem.start; d <= sem.end; d = addDays(d, 1)) {
        const wd = dateOf(d).getUTCDay();
        if ((wd === 5 || wd === 6) && d > todayYmd) {
          const n = nightOutlook(data, site, d, true);
          n.blocked = conflict(d, sem);
          nights.push(n);
        }
      }
      if (!nights.length) return "";
      // 같은 주말의 금·토는 더 좋은 밤 하나만
      const byWeekend = new Map();
      for (const n of nights.filter((x) => !x.blocked)) {
        const key = dateOf(n.ymd).getUTCDay() === 6 ? addDays(n.ymd, -1) : n.ymd;
        if (!byWeekend.has(key) || (n.score ?? -1) > (byWeekend.get(key).score ?? -1)) byWeekend.set(key, n);
      }
      const top = [...byWeekend.values()].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 5);
      const strip = nights
        .map((n) => {
          const [r, g, b] = scoreColor(n.score * 1.8);
          const d = dateOf(n.ymd);
          const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WD[d.getUTCDay()]})`;
          return n.blocked
            ? `<button class="strip-cell x" data-ymd="${n.ymd}" title="${label} · ${n.blocked}"></button>`
            : `<button class="strip-cell${top.includes(n) ? " top" : ""}" data-ymd="${n.ymd}" title="${label} · 좋은 밤 ${n.score}%${n.rain != null ? ` · 비 ${Math.round(n.rain * 100)}%` : ""}" style="background:rgba(${r},${g},${b},.9)"></button>`;
        })
        .join("");
      const list = top
        .map((n, k) => {
          const d = dateOf(n.ymd);
          const good = n.good ?? n.clear ?? 0;
          const [o, oc] = odds(good);
          const why = `${n.rain != null ? `비 올 확률 ${Math.round(n.rain * 100)}% · ` : ""}이 시기(±1주) 맑고 비 없던 밤 ${Math.round(good * 100)}% · 달 없는 시간 ${Math.round(n.dark * 100)}%`;
          return `<button class="pick" data-ymd="${n.ymd}">
            <span class="rank">${k + 1}</span>
            <span class="pd"><b>${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WD[d.getUTCDay()]}) 밤 <i class="odds ${oc}">성공 확률 ${o}</i></b><small>${why}</small></span>
            ${moonIcon(n.moon.phase, 16)}${badge(n.score, "통계")}</button>`;
        })
        .join("");
      const avoid = sem.avoid
        .map(([a, b, why]) => `<span class="chip">${why} ${a.slice(5).replace("-", "/")}~${b.slice(5).replace("-", "/")}</span>`)
        .join("");
      return `<section class="sem"><h3>${sem.name} MT 날짜 미리 정하기</h3>
        <p class="lead">예보 없이 영천의 10년 기록(비·구름)과 달만으로 매긴 순위예요. 시험기간과 연휴는 뺐어요.</p>
        <div class="strip">${strip}</div>
        <div class="strip-legend"><span>${(sem.start > todayYmd ? sem.start : todayYmd).slice(5).replace("-", "/")}</span><span>금·토 밤 · 빗금 = 제외</span><span>${sem.end.slice(5).replace("-", "/")}</span></div>
        ${list}
        <div class="chips">${avoid}${sem.guessed ? '<span class="chip soft">학사일정 추정치</span>' : ""}</div></section>`;
    })
    .join("");
  box.innerHTML =
    html +
    `<section class="sem"><h3>지난 MT 돌아보기</h3><div id="retroBox">${retroHTML ?? ""}</div></section>` +
    note(data);
  box.querySelectorAll("[data-ymd]").forEach((el) => (el.onclick = () => onPick(el.dataset.ymd)));
  if (retroHTML == null && !retroJob) {
    // 한 번만 불러오고, 그 사이 화면이 다시 그려져도 지금 있는 상자에 넣음
    const tmp = document.createElement("div");
    retroJob = renderRetro(tmp, site).then(() => {
      retroHTML = tmp.innerHTML;
      const rb = document.getElementById("retroBox");
      if (rb) rb.innerHTML = retroHTML;
    });
  }
}

// ---------- 월 ----------
export function renderMonth(box, data, site, ym, todayYmd, onPick, onMove) {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  let cells = "";
  for (let k = 0; k < lead; k++) cells += `<span class="cal-empty"></span>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const n = nightOutlook(data, site, ds);
    const past = ds < todayYmd;
    const [r, g, b] = scoreColor(n.kind === "통계" ? n.score * 1.8 : n.score);
    cells += `<button class="cal${past ? " past" : ""}${n.kind === "예보" ? " fc" : ""}${ds === todayYmd ? " today" : ""}" data-ymd="${ds}"
      title="${m}/${d} 밤 · ${n.kind === "통계" ? `좋은 밤 ${n.score}%${n.rain != null ? ` · 비 올 확률 ${Math.round(n.rain * 100)}%` : ""}` : `${n.score}점 (예보)`}" style="--c:rgba(${r},${g},${b},.9)">
      <span class="cd">${d}</span>${n.rain != null && n.rain >= 0.35 && !past ? '<span class="cr" title="비 잦은 시기">☂</span>' : ""}${moonIcon(n.moon.phase, 12)}<span class="cs">${n.score ?? ""}${n.kind === "통계" ? "<small>%</small>" : ""}</span></button>`;
  }
  const mm = data.climate?.by_month?.[m - 1];
  box.innerHTML = `
    <div class="cal-head"><button data-move="-1" aria-label="이전 달">‹</button><b>${y}년 ${m}월</b><button data-move="1" aria-label="다음 달">›</button></div>
    ${mm ? `<p class="lead">영천 ${m}월 · 비 온 날 평균 <b>${mm.rain_days ?? "-"}일</b> (비 올 확률 ${mm.rain != null ? Math.round(mm.rain * 100) : "-"}%) · 맑은 밤 ${Math.round(mm.clear * 100)}% · 평균 밤 구름 ${Math.round(mm.cloud)}%</p>` : ""}
    <div class="cal-grid">${WD.map((w) => `<span class="cal-wd">${w}</span>`).join("")}${cells}</div>
    <div class="cal-legend"><span><i class="fc-dot"></i>테두리 = 모델 예보</span><span>☂ = 10년 중 비 잦은 날</span><span>나머지 = 10년 통계 + 월령</span></div>
    ${note(data)}`;
  box.querySelectorAll("[data-ymd]").forEach((el) => (el.onclick = () => onPick(el.dataset.ymd)));
  box.querySelectorAll("[data-move]").forEach((el) => (el.onclick = () => onMove(+el.dataset.move)));
}

// ---------- 1년 ----------
export function renderYear(box, data, site, todayYmd, onPickMonth) {
  const c = data.climate;
  if (!c) {
    box.innerHTML = `<p class="hint">기후 통계를 아직 불러오지 못했어요.</p>`;
    return;
  }
  const [y, m0] = todayYmd.split("-").map(Number);
  let rows = "";
  for (let k = 0; k < 12; k++) {
    const mi = (m0 - 1 + k) % 12;
    const yy = y + Math.floor((m0 - 1 + k) / 12);
    const mon = c.by_month[mi];
    // 그 달의 달 없는 금·토 밤 수
    let darkWeekends = 0;
    let bestScore = 0;
    const days = new Date(Date.UTC(yy, mi + 1, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const ds = `${yy}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const wd = dateOf(ds).getUTCDay();
      if (wd !== 5 && wd !== 6) continue;
      const o = nightOutlook(data, site, ds, true);
      bestScore = Math.max(bestScore, o.score ?? 0);
      if (o.dark != null && o.dark > 0.8) darkWeekends++;
    }
    const sem = mi >= 2 && mi <= 5 ? "1학기" : mi >= 8 && mi <= 11 ? "2학기" : "방학";
    const pct = Math.round((mon.good ?? mon.clear) * 100);
    const rainPct = mon.rain != null ? Math.round(mon.rain * 100) : null;
    const [r, g, b] = scoreColor(pct * 1.8);
    rows += `<button class="yr${sem === "방학" ? " off" : ""}" data-ym="${yy}-${String(mi + 1).padStart(2, "0")}">
      <span class="ym">${mi + 1}월<small>${sem}</small></span>
      <span class="ybar"><span style="width:${pct}%;background:rgba(${r},${g},${b},.9)"></span></span>
      <span class="yp">${pct}%</span>
      <span class="yd rain${rainPct != null && rainPct >= 35 ? " wet" : ""}" title="비 온 날 평균 ${mon.rain_days ?? "-"}일">${rainPct != null ? rainPct + "%" : "-"}</span>
      <span class="yd" title="달 없는 금·토 밤">${darkWeekends}회</span>
      ${badge(bestScore, "통계")}</button>`;
  }
  box.innerHTML = `
    <p class="lead">영천 보현산의 ${c.years[0]}~${c.years[1]}년 기록으로 낸 <b>좋은 밤 확률</b>(비 안 오고 밤하늘 맑음)입니다. 오른쪽은 비 올 확률, 달 없는 금·토 밤 수, 그 달 최고 MT 점수.</p>
    <div class="yr-head"><span></span><span>좋은 밤 확률</span><span></span><span>비</span><span>그믐 주말</span><span>최고</span></div>
    ${rows}${note(data)}`;
  box.querySelectorAll("[data-ym]").forEach((el) => (el.onclick = () => onPickMonth(el.dataset.ym)));
}

function note(data) {
  const c = data.climate;
  return c
    ? `<p class="hint">숫자만 있는 칸은 7일 안쪽 실제 예보 점수(0~100), %가 붙은 칸은 10년 통계로 낸 "좋은 밤일 확률"(비 안 오고 맑은 밤일 확률 × 달빛 없는 정도)이에요. 맑은 밤 = 21시~03시 평균 구름 ${c.clear_limit}% 미만, 비 온 날 = 12시~다음날 06시 강수 ${c.rain_limit ?? 1}mm 이상.</p>`
    : "";
}

export { ymd };
