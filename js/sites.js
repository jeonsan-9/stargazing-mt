// 관측지 목록. verified:false 인 곳은 좌표를 아직 확인하지 못한 임시 위치입니다.
// 좌표 출처: OpenStreetMap Nominatim 및 한국관광공사 TourAPI (화산산성 전망대)

export const DEPARTURE = {
  id: "kmu",
  name: "계명대학교",
  lat: 35.8567,
  lon: 128.4849,
};

export const SITES = [
  // 동아리 MT 장소 (영천)
    { id: "bohyeon_obs", name: "보현산 천문대", region: "경북 영천", lat: 36.1641, lon: 128.9767, primary: true, verified: true },
  { id: "bohyeon_sci", name: "보현산 천문과학관", region: "경북 영천", lat: 36.1403, lon: 128.9967, primary: true, verified: true },
    // 비교용 (영천이 흐릴 때 대안)
  { id: "uiseong", name: "의성 달빛공원", region: "경북 의성", lat: 36.310421, lon: 128.802676, primary: false, verified: true },
  { id: "gajisan", name: "가지산", region: "울산 울주", lat: 35.6203, lon: 129.0029, primary: false, verified: true },
  { id: "yeongyang", name: "영양 별생태체험관", region: "경북 영양", lat: 36.8307, lon: 129.2701, primary: false, verified: true },
  { id: "hwasan", name: "군위 화산마을", region: "대구 군위", lat: 36.098544, lon: 128.784520, primary: false, verified: true },
  { id: "juwang", name: "청송 주왕산", region: "경북 청송", lat: 36.3567, lon: 129.1506, primary: false, verified: true },
  { id: "gamak", name: "거창 감악산", region: "경남 거창", lat: 35.5956, lon: 127.9281, primary: false, verified: true },
];

// 구름 지도 격자 (한반도 남쪽, 0.5° 간격)
export const GRID = {
  south: 33.0,
  north: 38.5,
  west: 124.5,
  east: 130.0,
  step: 0.5,
};

export function gridAxes(g = GRID) {
  const lats = [];
  const lons = [];
  for (let la = g.north; la >= g.south - 1e-9; la -= g.step) lats.push(+la.toFixed(3));
  for (let lo = g.west; lo <= g.east + 1e-9; lo += g.step) lons.push(+lo.toFixed(3));
  return { lats, lons };
}
