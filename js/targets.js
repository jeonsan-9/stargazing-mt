// 관측 대상 추천. LLM 없이 위치 계산만으로 고름
// 행성: JPL "Approximate Positions of the Planets" 케플러 요소 (1800~2050년 근사)
// 딥스카이: 동아리에서 많이 보는 메시에/NGC 대표 천체
// 유성우: IMO 기준 극대일과 복사점

/* global SunCalc */
import { addDays, darkWindow } from "./score.js";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const KST = "+09:00";

// ---------- 행성 ----------
// [a, e, I, L, 근일점 경도, 승교점 경도] 와 세기당 변화량
const ELEM = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};

const PLANETS = [
  { id: "venus", name: "금성", H: -4.4, w: 0.85, tip: "초저녁·새벽 낮은 하늘의 가장 밝은 별. 망원경으로 위상(초승달 모양)이 보여요" },
  { id: "jupiter", name: "목성", H: -9.4, w: 1, tip: "쌍안경으로도 갈릴레이 위성 4개, 망원경이면 줄무늬까지" },
  { id: "saturn", name: "토성", H: -8.9, w: 1, tip: "작은 망원경으로도 고리가 보이는 최고의 대상" },
  { id: "mars", name: "화성", H: -1.5, w: 0.75, tip: "붉은 점. 가까울 때는 극관과 어두운 무늬" },
  { id: "mercury", name: "수성", H: -0.6, w: 0.5, tip: "해 진 직후나 뜨기 직전 지평선 근처에서 잠깐" },
  { id: "uranus", name: "천왕성", H: -7.2, w: 0.4, tip: "망원경에서 청록색 작은 원반" },
  { id: "neptune", name: "해왕성", H: -6.9, w: 0.3, tip: "망원경 필요. 파란 별처럼 보여요" },
];

function julian(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function helio(id, T) {
  const [e0, r] = ELEM[id];
  const [a, e, I, L, wbar, node] = e0.map((v, k) => v + r[k] * T);
  const w = wbar - node;
  let M = (((L - wbar) % 360) + 540) % 360 - 180;
  M *= RAD;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w * RAD), sw = Math.sin(w * RAD);
  const cO = Math.cos(node * RAD), sO = Math.sin(node * RAD);
  const cI = Math.cos(I * RAD), sI = Math.sin(I * RAD);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

function planetRaDec(p, date) {
  const T = (julian(date) - 2451545) / 36525;
  const P = helio(p.id, T);
  const E = helio("earth", T);
  const g = [P[0] - E[0], P[1] - E[1], P[2] - E[2]];
  const eps = 23.43928 * RAD;
  const x = g[0];
  const y = g[1] * Math.cos(eps) - g[2] * Math.sin(eps);
  const z = g[1] * Math.sin(eps) + g[2] * Math.cos(eps);
  const delta = Math.hypot(x, y, z);
  const rr = Math.hypot(...P);
  const re = Math.hypot(...E);
  // 위상각으로 간단한 밝기 보정
  const cosPh = (rr * rr + delta * delta - re * re) / (2 * rr * delta);
  const phase = Math.acos(Math.max(-1, Math.min(1, cosPh))) * DEG;
  const mag = p.H + 5 * Math.log10(rr * delta) + 0.02 * phase;
  return { ra: Math.atan2(y, x) * DEG / 15, dec: Math.asin(z / delta) * DEG, mag, dist: delta };
}

// ---------- 딥스카이 ----------
// [이름, 별칭, 적경(시), 적위(°), 등급, 종류, 가중치, 한 줄 팁]
const DSO = [
  ["M45", "플레이아데스", 3.79, 24.12, 1.6, "성단", 1, "맨눈으로 6~7개, 쌍안경이면 수십 개. 쌍안경 최고 대상"],
  ["M31", "안드로메다 은하", 0.712, 41.27, 3.4, "은하", 1, "어두운 곳에선 맨눈으로 희미한 얼룩. 250만 광년 밖"],
  ["M42", "오리온 대성운", 5.59, -5.39, 4.0, "성운", 1, "망원경으로 날개 모양 성운과 가운데 트라페지움"],
  ["NGC 869/884", "페르세우스 이중성단", 2.35, 57.13, 3.7, "성단", 0.9, "저배율 한 시야에 성단 두 개가 나란히"],
  ["M13", "헤르쿨레스 대구상성단", 16.695, 36.46, 5.8, "구상성단", 0.9, "망원경으로 별 수십만 개가 공처럼 뭉친 모습"],
  ["M44", "프레세페 (벌집)", 8.667, 19.67, 3.7, "성단", 0.8, "쌍안경으로 보기 좋은 큰 성단"],
  ["M8", "석호 성운", 18.06, -24.38, 6.0, "성운", 0.85, "여름 은하수 속 밝은 성운. 남쪽 하늘이 트인 곳에서"],
  ["M22", "궁수자리 구상성단", 18.607, -23.9, 5.1, "구상성단", 0.7, "남쪽 낮은 하늘의 밝은 구상성단"],
  ["M57", "고리 성운", 18.893, 33.03, 8.8, "행성상성운", 0.8, "작은 도넛 모양. 중배율 이상"],
  ["M27", "아령 성운", 19.993, 22.72, 7.5, "행성상성운", 0.8, "사과 심 모양의 밝은 행성상성운"],
  ["M51", "소용돌이 은하", 13.498, 47.2, 8.4, "은하", 0.75, "달 없는 밤에 나선팔이 어렴풋이"],
  ["M81·M82", "보데 은하와 시가 은하", 9.93, 69.4, 6.9, "은하", 0.75, "한 시야에 은하 두 개"],
  ["M33", "삼각형자리 은하", 1.564, 30.66, 5.7, "은하", 0.6, "크고 흐려서 아주 어두운 하늘이 필요"],
  ["M35", "쌍둥이자리 산개성단", 6.15, 24.33, 5.3, "성단", 0.6, "쌍안경으로도 잘 보이는 성단"],
  ["M37", "마차부자리 산개성단", 5.873, 32.55, 6.2, "성단", 0.6, "M36, M38과 함께 둘러보기 좋아요"],
  ["M3", "사냥개자리 구상성단", 13.703, 28.38, 6.2, "구상성단", 0.6, "봄 하늘의 밝은 구상성단"],
  ["M5", "뱀자리 구상성단", 15.31, 2.08, 5.6, "구상성단", 0.55, "M13 못지않게 밝은 구상성단"],
  ["M92", "헤르쿨레스 구상성단", 17.285, 43.14, 6.4, "구상성단", 0.5, "M13 옆의 작은 구상성단"],
  ["M15", "페가수스 구상성단", 21.5, 12.17, 6.2, "구상성단", 0.55, "가을 하늘의 구상성단"],
  ["M11", "들오리 성단", 18.851, -6.27, 6.3, "성단", 0.6, "별이 빽빽한 V자 성단"],
  ["M17", "오메가 성운", 18.346, -16.18, 6.0, "성운", 0.6, "백조(오메가) 모양의 밝은 성운"],
  ["M1", "게 성운", 5.575, 22.01, 8.4, "성운", 0.45, "1054년 초신성의 잔해. 흐린 얼룩"],
  ["M104", "솜브레로 은하", 12.666, -11.62, 8.0, "은하", 0.5, "모자처럼 생긴 옆모습 은하"],
  ["NGC 7000", "북아메리카 성운", 20.98, 44.33, 4.0, "성운", 0.45, "아주 크고 흐려서 쌍안경·사진 대상"],
  ["NGC 457", "부엉이 성단", 1.33, 58.29, 6.4, "성단", 0.45, "두 눈이 반짝이는 부엉이 모양"],
  ["알비레오", "백조자리 이중성", 19.512, 27.96, 3.1, "이중성", 0.7, "노랑과 파랑의 대비가 예쁜 이중성"],
  ["미자르·알코르", "북두칠성 이중성", 13.399, 54.93, 2.2, "이중성", 0.5, "맨눈 시력 테스트, 망원경이면 미자르도 둘로"],
  ["은하수 중심", "궁수자리 방향", 17.76, -29.0, 3, "은하수", 0.95, "여름 밤 남쪽 지평선 위. 달 없고 맑으면 맨눈으로"],
];

// ---------- 유성우 ----------
// [이름, 극대(월, 일), 활동 반경(일), ZHR, 복사점 적경(시), 적위(°)]
const SHOWERS = [
  ["사분의자리 유성우", 1, 3, 2, 110, 15.33, 49.5],
  ["거문고자리 유성우", 4, 22, 2, 18, 18.07, 34],
  ["물병자리 에타 유성우", 5, 6, 3, 50, 22.47, -1],
  ["페르세우스자리 유성우", 8, 12, 3, 100, 3.2, 58],
  ["용자리 유성우", 10, 8, 1, 10, 17.47, 54],
  ["오리온자리 유성우", 10, 21, 3, 20, 6.33, 16],
  ["사자자리 유성우", 11, 17, 2, 15, 10.27, 22],
  ["쌍둥이자리 유성우", 12, 14, 2, 150, 7.47, 32.5],
  ["작은곰자리 유성우", 12, 22, 1, 10, 14.47, 75.5],
];

const ICON = { 행성: "🪐", 성단: "✨", 구상성단: "🔆", 성운: "🌫️", 행성상성운: "💫", 은하: "🌀", 이중성: "⭐", 은하수: "🌌", 유성우: "☄️", 달: "🌙" };

// ---------- 좌표 변환 ----------
function altAz(raH, decD, date, lat, lon) {
  const d = julian(date) - 2451545;
  const lst = (((280.46061837 + 360.98564736629 * d + lon) % 360) + 360) % 360;
  const H = (lst - raH * 15) * RAD;
  const phi = lat * RAD;
  const dec = decD * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(-Math.sin(H) * Math.cos(dec), Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(H));
  return { alt: alt * DEG, az: ((az * DEG) + 360) % 360 };
}

function sep(a1, d1, a2, d2) {
  // 각거리 (도). a = 경도 성분(방위각), d = 위도 성분(고도)
  const c = Math.sin(d1 * RAD) * Math.sin(d2 * RAD) + Math.cos(d1 * RAD) * Math.cos(d2 * RAD) * Math.cos((a1 - a2) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
}

// Representative NGC IDs and major/minor axes (arcmin) from OpenNGC, Mattia Verga,
// https://github.com/mattiaverga/OpenNGC (CC BY-SA 4.0). Equal axes are used for
// clusters with a single catalog diameter. Pairs without a combined size stay unset.
const DSOSIZES = {
  M1: ["NGC 1952", 8, 4], M3: ["NGC 5272", 16.2, 16.2], M5: ["NGC 5904", 15, 15],
  M8: ["NGC 6523", 45, 30], M11: ["NGC 6705", 9, 9], M13: ["NGC 6205", 16.5, 16.5],
  M15: ["NGC 7078", 11.1, 11.1], M17: ["NGC 6618", 12.6], M22: ["NGC 6656", 12.6, 12.6],
  M27: ["NGC 6853", 6.7], M31: ["NGC 224", 177.83, 69.66], M33: ["NGC 598", 62.09, 36.73],
  M35: ["NGC 2168", 24, 24], M37: ["NGC 2099", 11.4, 11.4], M42: ["NGC 1976", 90, 60],
  M44: ["NGC 2632", 108.6, 108.6], M51: ["NGC 5194", 13.71, 11.67], M57: ["NGC 6720", 1.27],
  M92: ["NGC 6341", 14.4, 14.4], M104: ["NGC 4594", 8.45, 4.91],
  "NGC 7000": ["", 120, 30], "NGC 457": ["", 7.8, 7.8],
};

// Equatorial radii in km, NASA Planetary Fact Sheets.
const PLANET_RADII = { mercury: 2440.5, venus: 6051.8, mars: 3396.2, jupiter: 71492,
  saturn: 60268, uranus: 25559, neptune: 24764 };

export const observingTargets = [
  { id: "moon", name: "달", kind: "달", aliases: ["Moon"] },
  ...PLANETS.map(({ id, name }) => ({ id, name, kind: "행성", aliases: [id] })),
  { id: "M81", name: "보데 은하", ra: 9.92588, dec: 69.06531, kind: "은하", aliases: ["M81", "NGC 3031"], size: [21.63, 11.25] },
  { id: "M82", name: "시가 은하", ra: 9.93131, dec: 69.67939, kind: "은하", aliases: ["M82", "NGC 3034"], size: [10.99, 5.11] },
  { id: "NGC 869", name: "페르세우스 h 성단", ra: 2.31627, dec: 57.11725, kind: "성단", aliases: ["NGC 869"], size: [14.4, 14.4] },
  { id: "NGC 884", name: "페르세우스 χ 성단", ra: 2.37558, dec: 57.14411, kind: "성단", aliases: ["NGC 884"], size: [10.5, 10.5] },
  ...DSO.map(([id, name, ra, dec, , kind]) => {
    const [ngc, major, minor] = DSOSIZES[id] ?? [];
    const aliases = [id, ngc].filter(Boolean);
    return { id, name, ra, dec, kind, aliases, size: major && minor ? [major, minor] : null };
  }),
];

function catalogKey(value) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "")
    .replace(/^messier/, "m").replace(/^(m|ngc|ic)0+(?=\d)/, "$1");
}

export function searchObservingTargets(query) {
  const key = catalogKey(query);
  if (!key) return observingTargets;
  const matches = observingTargets.filter(({ name, aliases }) => [name, ...aliases]
    .some((value) => catalogKey(value).includes(key)));
  return matches.sort((a, b) => Number(b.aliases.some((alias) => catalogKey(alias) === key))
    - Number(a.aliases.some((alias) => catalogKey(alias) === key)));
}

export function observeTarget(target, time, { lat, lon }) {
  const moon = SunCalc.getMoonPosition(time, lat, lon);
  const moonAlt = moon.altitude * DEG;
  const moonAz = ((moon.azimuth * DEG) + 540) % 360;
  const angularSize = (radius, distance) => 120 * DEG * Math.asin(radius / distance);
  if (target.id === "moon") {
    const diameter = angularSize(1737.4, moon.distance);
    return { alt: moonAlt, az: moonAz, moonSeparation: null, size: [diameter, diameter] };
  }
  const planet = PLANETS.find((candidate) => candidate.id === target.id);
  const coords = planet ? planetRaDec(planet, time) : target;
  const { alt, az } = altAz(coords.ra, coords.dec, time, lat, lon);
  const diameter = planet ? angularSize(PLANET_RADII[planet.id], coords.dist * 149597870.7) : null;
  return { alt, az, moonSeparation: sep(az, alt, moonAz, moonAlt), size: diameter ? [diameter, diameter] : target.size };
}

const DIRS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const dirName = (az) => DIRS[Math.round(az / 45) % 8];
const hhmm = (d) => d.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

// 저녁 박명 ~ 새벽 박명을 20분 간격으로
function nightSamples(ymdStr, lat, lon) {
  const start = new Date(`${ymdStr}T18:00:00${KST}`);
  const out = [];
  for (let k = 0; k <= 36; k++) {
    const t = new Date(start.getTime() + k * 20 * 60e3);
    const sunAlt = SunCalc.getPosition(t, lat, lon).altitude * DEG;
    if (sunAlt > -8) continue;
    const mp = SunCalc.getMoonPosition(t, lat, lon);
    const ill = SunCalc.getMoonIllumination(t).fraction;
    out.push({ t, sunAlt, moonAlt: mp.altitude * DEG, moonAz: ((mp.azimuth * DEG) + 180 + 360) % 360, ill });
  }
  return out;
}

const altScore = (alt, min = 15) => Math.max(0, Math.min(1, (alt - min) / 35));

// 한 대상의 그날 밤 최적 시각과 점수
function bestOf(samples, posAt, opts) {
  let best = null;
  for (const s of samples) {
    if (s.sunAlt > opts.maxSun) continue;
    const { ra, dec } = posAt(s.t);
    const { alt, az } = altAz(ra, dec, s.t, opts.lat, opts.lon);
    if (alt < opts.minAlt) continue;
    let moonF = 1;
    if (s.moonAlt > 0 && opts.moonSens > 0) {
      const d = sep(az, alt, s.moonAz, s.moonAlt);
      const near = d < 25 ? 1 : d < 60 ? 0.6 : 0.35;
      moonF = 1 - opts.moonSens * s.ill * near * Math.min(1, (s.moonAlt + 3) / 25);
    }
    const sc = altScore(alt, opts.minAlt) * moonF;
    if (!best || sc > best.sc) best = { sc, alt, az, t: s.t, moonF };
  }
  return best;
}

export function recommendTargets(ymdStr, lat, lon) {
  const samples = nightSamples(ymdStr, lat, lon);
  if (!samples.length) return [];
  const list = [];
  const base = { lat, lon };

  // 유성우
  const [yy] = ymdStr.split("-").map(Number);
  for (const [name, m, d, win, zhr, ra, dec] of SHOWERS) {
    // 연말·연초를 넘나드는 경우(12/31에 1/3 극대 등) 앞뒤 해 중 가장 가까운 극대일
    const here = new Date(`${ymdStr}T12:00:00${KST}`);
    const diff = [yy - 1, yy, yy + 1]
      .map((y) => Math.round((here - new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00${KST}`)) / 86400e3))
      .reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
    // 극대일 밤 또는 그 전날 밤(새벽이 극대)이 가장 좋음
    if (diff < -win - 1 || diff > win) continue;
    const b = bestOf(samples, () => ({ ra, dec }), { ...base, maxSun: -15, minAlt: 10, moonSens: 0.9 });
    if (!b) continue;
    const closeness = 1 - Math.min(1, Math.abs(diff + 0.5) / (win + 1));
    const rate = Math.round(zhr * Math.sin(b.alt * RAD) * b.moonF * (0.35 + 0.65 * closeness));
    if (rate < 3) continue;
    list.push({
      kind: "유성우", name, sub: `시간당 약 ${rate}개 예상 (극대 ${m}/${d})`,
      when: b.t, alt: b.alt, az: b.az,
      score: 100 * Math.min(1, 0.4 + rate / 60) * b.moonF,
      tip: "복사점 쪽만 보지 말고 하늘 전체를 넓게. 눕는 의자와 담요 챙기기",
    });
  }

  // 행성
  const mid = new Date(`${addDays(ymdStr, 1)}T00:00:00${KST}`);
  for (const p of PLANETS) {
    const b = bestOf(samples, (t) => planetRaDec(p, t), { ...base, maxSun: -6, minAlt: 8, moonSens: 0 });
    if (!b) continue;
    const { mag } = planetRaDec(p, b.t);
    list.push({
      kind: "행성", name: p.name, sub: `${mag.toFixed(1)}등급`,
      when: b.t, alt: b.alt, az: b.az,
      score: 100 * b.sc * p.w + 6, tip: p.tip,
    });
  }

  // 달 자체 (반달 전후가 크레이터 관찰에 가장 좋음)
  const ill = SunCalc.getMoonIllumination(mid);
  const moonUp = samples.filter((s) => s.moonAlt > 15);
  if (ill.fraction > 0.15 && moonUp.length) {
    const top = moonUp.reduce((a, s) => (s.moonAlt > a.moonAlt ? s : a));
    const half = 1 - Math.abs(ill.fraction - 0.5) * 1.2;
    list.push({
      kind: "달", name: "달", sub: `${Math.round(ill.fraction * 100)}% 밝음`,
      when: top.t, alt: top.moonAlt, az: top.moonAz,
      score: 70 * half * altScore(top.moonAlt), tip: "밝고 어두운 경계선(명암 경계) 근처의 크레이터가 가장 입체적이에요",
    });
  }

  // 딥스카이
  for (const [id, alias, ra, dec, mag, kind, w, tip] of DSO) {
    const faint = mag > 6 ? 0.95 : mag > 4 ? 0.7 : 0.45;
    const b = bestOf(samples, () => ({ ra, dec }), { ...base, maxSun: -15, minAlt: kind === "은하수" ? 12 : 20, moonSens: faint });
    if (!b) continue;
    list.push({
      kind, name: alias, sub: `${id}${kind === "은하수" ? "" : ` · ${mag}등급`}`,
      when: b.t, alt: b.alt, az: b.az,
      score: 100 * b.sc * w, tip,
    });
  }

  return list.filter((x) => x.score > 12).sort((a, b) => b.score - a.score);
}

export function targetsHTML(ymdStr, lat, lon, limit = 8) {
  const list = recommendTargets(ymdStr, lat, lon).slice(0, limit);
  if (!list.length) return `<p class="hint">이 밤엔 추천할 대상을 찾지 못했어요.</p>`;
  const dw = darkWindow(ymdStr, lat, lon);
  return `<div class="targets">${list
    .map(
      (x) => `<div class="tg">
        <span class="ti" aria-hidden="true">${ICON[x.kind] ?? "⭐"}</span>
        <span class="tn"><b>${x.name}</b><small>${x.kind} · ${x.sub}</small><em>${x.tip}</em></span>
        <span class="tw"><b>${hhmm(x.when)}</b><small>${dirName(x.az)} ${Math.round(x.alt)}°</small></span>
      </div>`
    )
    .join("")}</div>
    <p class="hint">시각은 그 대상이 가장 잘 보이는 때(높이와 달빛 기준). 완전히 어두운 시간 ${hhmm(dw.dusk)}~${hhmm(dw.dawn)}.</p>`;
}
