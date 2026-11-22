/* global SunCalc */
// 은하수 중심(궁수자리 A* 방향)이 어두운 하늘에서 보이는 시간.
import { altAz } from "./targets.js";
import { parseLocal } from "./score.js";

const CORE = { ra: 17.761, dec: -29.008 };
const DEG = 180 / Math.PI;
const STEP = 10 * 60_000;
const directions = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" });
const dayFmt = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" });

// 저녁 18시부터 다음 날 6시까지, 해 −18° 이하이고 중심 고도 minAlt 이상인 구간
export function coreWindow(day, { lat, lon }, minAlt = 10) {
  const start = +parseLocal(`${day}T18:00`);
  let from, to, peak, moonUp = 0, dark = 0;
  for (let t = start; t <= start + 12 * 3_600_000; t += STEP) {
    const time = new Date(t);
    if (SunCalc.getPosition(time, lat, lon).altitude * DEG > -18) continue;
    const { alt, az } = altAz(CORE.ra, CORE.dec, time, lat, lon);
    if (alt < minAlt) continue;
    from ??= time;
    to = time;
    dark += 1;
    if (!peak || alt > peak.alt) peak = { time, alt, az };
    if (SunCalc.getMoonPosition(time, lat, lon).altitude > 0) moonUp += 1;
  }
  if (!from) return null;
  const illum = SunCalc.getMoonIllumination(peak.time).fraction;
  return { from, to, peak, minutes: dark * 10, moonShare: moonUp / dark, illum };
}

function nextWindow(day, site) {
  const base = parseLocal(`${day}T12:00`);
  for (let i = 1; i <= 366; i += 1) {
    const d = new Date(+base + i * 86_400_000);
    const next = new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
    const w = coreWindow(next, site, 15);
    if (w && w.minutes >= 30) return { day: next, window: w };
  }
  return null;
}

export function coreSummary(day, site) {
  const w = coreWindow(day, site);
  if (!w) {
    const next = nextWindow(day, site);
    return { visible: false, text: "오늘 밤에는 은하수 중심이 어두운 하늘에 떠오르지 않습니다.",
      next: next ? `가장 가까운 날 · ${dayFmt.format(new Date(`${next.day}T12:00:00+09:00`))} ${clock.format(next.window.from)}부터` : "", nextDay: next?.day };
  }
  const dir = directions[Math.round(w.peak.az / 45) % 8];
  const moon = w.moonShare === 0 || w.illum < 0.15 ? "달 방해 없음"
    : w.moonShare >= 0.6 && w.illum > 0.4 ? `달빛 강함 (달 ${Math.round(w.illum * 100)}%)` : `일부 시간 달빛 (달 ${Math.round(w.illum * 100)}%)`;
  return {
    visible: true,
    text: `${clock.format(w.from)}–${clock.format(new Date(+w.to + STEP))} · 최고 ${Math.round(w.peak.alt)}° ${dir}쪽 (${clock.format(w.peak.time)})`,
    next: `${Math.round(w.minutes / 6) / 10}시간 · ${moon}`,
    moonGood: moon === "달 방해 없음",
  };
}
