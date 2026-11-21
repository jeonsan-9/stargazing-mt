// 별자리 선: 각 선분은 Hipparcos 번호 쌍. stars.json(HIP, RA°, Dec°, 등급, B-V)에 있는 별만 쓴다.
// 한국에서 잘 보이는 대표 별자리만 골랐다. 선 모양은 흔히 쓰는 그림을 따른다.
const chain = (...ids) => ids.slice(1).map((id, i) => [ids[i], id]);

export const constellations = [
  { name: "오리온자리", lines: [...chain(27989, 25336), ...chain(26727, 26311, 25930), [27989, 26727], [25336, 25930], [26727, 27366], [25930, 24436], [26207, 27989], [26207, 25336]] },
  { name: "북두칠성", lines: [...chain(54061, 53910, 58001, 59774, 54061), ...chain(59774, 62956, 65378, 67301)] },
  { name: "작은곰자리", lines: [...chain(11767, 85822, 82080, 77055, 72607, 75097, 79822, 77055)] },
  { name: "카시오페이아자리", lines: chain(746, 3179, 4427, 6686, 8886) },
  { name: "백조자리", lines: [...chain(102098, 100453, 95947), ...chain(102488, 100453, 97165)] },
  { name: "거문고자리", lines: [[91262, 91971], ...chain(91971, 92420, 93194, 92791, 91971)] },
  { name: "독수리자리", lines: chain(97278, 97649, 98036) },
  { name: "황소자리", lines: [...chain(20205, 20455, 20889, 25428), ...chain(20205, 20894, 21421, 26451)] },
  { name: "쌍둥이자리", lines: [...chain(36850, 32246, 30343), ...chain(37826, 35550, 34088, 31681), [36850, 37826]] },
  { name: "큰개자리", lines: [...chain(30324, 32349, 34444, 33579), [34444, 35904]] },
  { name: "작은개자리", lines: [[37279, 36188]] },
  { name: "사자자리", lines: [...chain(49669, 49583, 50583, 50335, 48455, 47908), ...chain(50583, 54872, 57632, 54879, 49669)] },
  { name: "페가수스자리", lines: [...chain(113963, 113881, 677, 1067, 113963), ...chain(107315, 109427, 112029, 113963)] },
  { name: "안드로메다자리", lines: chain(677, 3092, 5447, 9640) },
  { name: "페르세우스자리", lines: [...chain(14328, 15863, 17358, 18532, 18246), [15863, 14576]] },
  { name: "마차부자리", lines: chain(24608, 28360, 28380, 25428, 23015, 24608) },
  { name: "목동자리", lines: [...chain(69673, 72105, 74666, 73555, 71075, 69673), [69673, 67927]] },
  { name: "전갈자리", lines: [...chain(78820, 78401, 78265), ...chain(78401, 80112, 80763, 81266, 82396, 82514, 82729, 84143, 86228, 86670, 85927, 85696)] },
  { name: "궁수자리", lines: [...chain(90185, 89931, 88635), [89931, 90496], [90496, 92041], [92041, 89931], [90185, 93506], ...chain(93506, 92041, 92855, 93864, 93506)] },
];

// 별자리 선 끝점의 고도·방위. stars: [HIP, RA°, Dec°, ...] 배열, toAltAz(raHours, decDeg) => {alt, az}
export function figureSegments(stars, toAltAz) {
  const byId = new Map(stars.map((star) => [star[0], star]));
  const position = new Map();
  const at = (id) => {
    if (!position.has(id)) {
      const star = byId.get(id);
      position.set(id, star ? toAltAz(star[1] / 15, star[2]) : null);
    }
    return position.get(id);
  };
  return constellations.map(({ name, lines }) => ({ name, lines: lines.map(([a, b]) => [at(a), at(b)]).filter(([p, q]) => p && q) }));
}

// 고도·방위가 가장 가까운 별자리 선의 별. maxDistance(°) 안에 없으면 null.
export function nearestFigure(figures, alt, az, maxDistance = 14) {
  const RAD = Math.PI / 180;
  const distance = (p) => Math.acos(Math.min(1, Math.sin(p.alt * RAD) * Math.sin(alt * RAD)
    + Math.cos(p.alt * RAD) * Math.cos(alt * RAD) * Math.cos((p.az - az) * RAD))) / RAD;
  let best = null;
  for (const { name, lines } of figures) for (const pair of lines) for (const p of pair) {
    const d = distance(p);
    if (d < maxDistance && (!best || d < best.distance)) best = { name, distance: d };
  }
  return best;
}
