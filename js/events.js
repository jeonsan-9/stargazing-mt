// 천문 현상 달력: 유성우 극대, 행성 충·최대이각, 월식
// 모두 계산이나 공개 목록으로 만들며 서버가 필요 없습니다.
// MT 날짜를 몇 달 전에 정할 때 "그날 무슨 일이 있고 달은 어떤가"를 함께 보려는 용도입니다.

/* global SunCalc */
import { SHOWERS, PLANETS, planetRaDec, elongation, altAz } from "./targets.js";

const KST = "+09:00";
const DAY = 86400e3;
const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => new Date(+d + 9 * 3600e3).toISOString().slice(0, 10);
const at = (ymd, hh = 0) => new Date(`${ymd}T${pad(hh)}:00:00${KST}`);

// 한국에서 보이는 월식 (NASA 월식 목록 기준, 한국 시각으로 밤인 것만)
// 날짜는 그 월식이 일어나는 '밤'의 저녁 날짜입니다.
const LUNAR_ECLIPSES = [
  { ymd: "2026-03-03", title: "개기월식", note: "초저녁 동쪽 하늘. 20시대에 달이 붉게 물들어요" },
  { ymd: "2028-12-31", title: "개기월식", note: "한밤 높은 하늘. 새해 첫날로 넘어가며 진행돼요" },
];

// 그 밤(저녁 날짜 ymd)의 자정 무렵 달 밝기와, 해 진 뒤~해 뜨기 전 달이 떠 있는 비율
export function moonOfNight(ymd, lat, lon) {
  const mid = new Date(+at(ymd, 0) + DAY); // 다음 날 0시
  const fraction = SunCalc.getMoonIllumination(mid).fraction;
  let up = 0;
  for (let h = 20; h <= 28; h++) {
    const t = new Date(+at(ymd, 0) + h * 3600e3);
    if (SunCalc.getMoonPosition(t, lat, lon).altitude > 0) up++;
  }
  return { fraction, upShare: up / 9 };
}

function moonVerdict({ fraction, upShare }) {
  const glare = fraction * upShare;
  if (glare < 0.15) return ["달빛 방해 거의 없음", "good"];
  if (glare < 0.45) return ["달이 밤 일부를 밝힘", "mid"];
  return ["달이 밝아 어두운 대상은 불리", "bad"];
}

function showerEvents(year, site) {
  return SHOWERS.filter(([, , , , zhr]) => zhr >= 15).map(([name, m, d, , zhr, ra, dec]) => {
    // 극대가 새벽이면 전날 밤이 관측하는 밤. 복사점이 가장 높은 새벽 3~4시 기준으로 전날 저녁 날짜를 씀
    const peak = `${year}-${pad(m)}-${pad(d)}`;
    const night = ymdOf(+at(peak, 12) - DAY);
    const t = new Date(+at(night, 0) + 27.5 * 3600e3);
    const { alt } = altAz(ra, dec, t, site.lat, site.lon);
    return {
      ymd: night,
      kind: "유성우",
      icon: "☄️",
      title: `${name} 극대`,
      note: `시간당 최대 약 ${zhr}개(이상적인 하늘 기준) · 새벽 3시 복사점 고도 ${Math.round(alt)}°`,
      weight: zhr >= 80 ? 3 : 2,
    };
  });
}

// 하루 간격으로 이각을 훑어 최댓값(외행성 = 충, 금성 = 최대이각)을 찾음
function planetEvents(from, to) {
  const out = [];
  const ids = { mars: "화성", jupiter: "목성", saturn: "토성", venus: "금성" };
  for (const [id, name] of Object.entries(ids)) {
    const p = PLANETS.find((x) => x.id === id);
    let prev2 = null, prev = null;
    for (let t = +at(from, 12) - 2 * DAY; t <= +at(to, 12) + DAY; t += DAY) {
      const e = elongation(id, new Date(t));
      if (prev2 != null && prev != null && prev > prev2 && prev >= e) {
        const day = new Date(t - DAY);
        const ymd = ymdOf(day);
        if (ymd >= from && ymd <= to) {
          if (id === "venus") {
            if (prev > 40) {
              const evening = isEvening(p, day);
              out.push({ ymd, kind: "행성", icon: "🪐", title: `금성 ${evening ? "동방" : "서방"} 최대이각`, note: `${evening ? "초저녁 서쪽" : "새벽 동쪽"} 하늘에서 가장 높이 · 해에서 ${Math.round(prev)}°`, weight: 1 });
            }
          } else if (prev > 170) {
            const { mag } = planetRaDec(p, day);
            out.push({ ymd, kind: "행성", icon: "🪐", title: `${name} 충`, note: `밤새 보이고 가장 밝음(${mag.toFixed(1)}등급) · 망원경 관측 최적기`, weight: id === "mars" ? 3 : 2 });
          }
        }
      }
      prev2 = prev;
      prev = e;
    }
  }
  return out;
}

// 금성이 저녁별인지: 해 진 직후(해 고도 -6°) 금성이 지평선 위에 있으면 저녁
function isEvening(p, day) {
  const lat = 36, lon = 128.8;
  const set = SunCalc.getTimes(day, lat, lon).dusk;
  const { ra, dec } = planetRaDec(p, set);
  return altAz(ra, dec, set, lat, lon).alt > 5;
}

const cache = new Map();

// from~to(저녁 날짜, 포함) 사이 천문 현상. 각 항목에 그 밤의 달 정보를 붙임
export function astroEvents(from, to, site) {
  const key = `${from}|${to}|${site.id}`;
  if (cache.has(key)) return cache.get(key);
  const years = [];
  for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) years.push(y);
  const list = [
    ...years.flatMap((y) => showerEvents(y, site)),
    ...planetEvents(from, to),
    ...LUNAR_ECLIPSES.map((e) => ({ ...e, kind: "월식", icon: "🌕", weight: 3 })),
  ]
    .filter((e) => e.ymd >= from && e.ymd <= to)
    .map((e) => {
      const moon = moonOfNight(e.ymd, site.lat, site.lon);
      const [moonText, moonClass] = e.kind === "월식" || e.kind === "행성" ? ["달과 무관", "neutral"] : moonVerdict(moon);
      return { ...e, moon, moonText, moonClass };
    })
    .sort((a, b) => a.ymd.localeCompare(b.ymd));
  cache.set(key, list);
  return list;
}

// 날짜(저녁) → 그 밤 또는 하루 차이 안의 현상
export function eventsNear(events, ymd, days = 1) {
  const t = +at(ymd, 12);
  return events.filter((e) => Math.abs(+at(e.ymd, 12) - t) <= days * DAY);
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];

export function eventsHTML(events, { empty = "이 기간에는 큰 천문 현상이 없어요." } = {}) {
  if (!events.length) return `<p class="hint">${empty}</p>`;
  return `<ul class="events">${events
    .map((e) => {
      const d = at(e.ymd, 12);
      const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WD[d.getUTCDay()]})`;
      return `<li class="ev ${e.moonClass}" data-ymd="${e.ymd}" tabindex="0" role="button">
        <span class="ev-ic" aria-hidden="true">${e.icon}</span>
        <span class="ev-tx"><b>${md} 밤 · ${e.title}</b><small>${e.note}</small></span>
        <span class="ev-moon">${e.kind === "유성우" ? `달 ${Math.round(e.moon.fraction * 100)}% · ` : ""}${e.moonText}</span>
      </li>`;
    })
    .join("")}</ul>`;
}
