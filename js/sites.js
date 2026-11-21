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
  // 전국 관측 후보
  { id: "uiseong", name: "의성 달빛공원", region: "경북 의성", lat: 36.310421, lon: 128.802676, primary: false, verified: true },
  { id: "gajisan", name: "가지산", region: "울산 울주", lat: 35.6203, lon: 129.0029, primary: false, verified: true },
  { id: "yeongyang", name: "영양 별생태체험관", region: "경북 영양", lat: 36.8307, lon: 129.2701, primary: false, verified: true },
  { id: "hwasan", name: "군위 화산마을", region: "대구 군위", lat: 36.098544, lon: 128.784520, primary: false, verified: true },
  { id: "juwang", name: "청송 주왕산", region: "경북 청송", lat: 36.3567, lon: 129.1506, primary: false, verified: true },
  { id: "gamak", name: "거창 감악산", region: "경남 거창", lat: 35.5956, lon: 127.9281, primary: false, verified: true },
  { id: "dangpo", name: "연천 당포성", region: "경기 연천", lat: 38.023503, lon: 126.985418, primary: false, verified: true },
  { id: "anbandegi", name: "안반데기 주차장", region: "강원 강릉", lat: 37.625946, lon: 128.739347, primary: false, verified: true },
  { id: "yukbaek", name: "육백마지기", region: "강원 평창", lat: 37.4068, lon: 128.5116, primary: false, verified: true },
  { id: "byeolmaro", name: "별마로천문대", region: "강원 영월", lat: 37.198366, lon: 128.486777, primary: false, verified: true },
  { id: "jwagusan", name: "좌구산천문대", region: "충북 증평", lat: 36.703703, lon: 127.653096, primary: false, verified: true },
  { id: "kkotji", name: "꽃지해변", region: "충남 태안", lat: 36.496938, lon: 126.335161, primary: false, verified: true },
  { id: "bandi", name: "반디별천문과학관", region: "전북 무주", lat: 36.0129, lon: 127.7604, primary: false, verified: true },
  { id: "namyeol", name: "남열해돋이해변", region: "전남 고흥", lat: 34.5806, lon: 127.4869, primary: false, verified: true },
  { id: "jeju1100", name: "1100고지 휴게소", region: "제주 서귀포", lat: 33.357832, lon: 126.462805, primary: false, verified: true },
  { id: "yecheon", name: "예천천문우주센터", region: "경북 예천", lat: 36.7013, lon: 128.5046, primary: false, verified: true },
  { id: "manhang", name: "만항재", region: "강원 정선", lat: 37.14849, lon: 128.89931, primary: false, verified: true },
  { id: "yanggu", name: "국토정중앙천문대", region: "강원 양구", lat: 38.06893, lon: 128.02977, primary: false, verified: true },
  { id: "hwacheon", name: "조경철천문대", region: "강원 화천", lat: 38.11866, lon: 127.43404, primary: false, verified: true },
  { id: "songam", name: "송암스페이스센터", region: "경기 양주", lat: 37.73572, lon: 126.94276, primary: false, verified: true },
  { id: "chungju", name: "충주고구려천문과학관", region: "충북 충주", lat: 37.04027, lon: 127.84833, primary: false, verified: true },
  { id: "cheongyang", name: "칠갑산천문대 스타파크", region: "충남 청양", lat: 36.43373, lon: 126.88993, primary: false, verified: true },
  { id: "miryang", name: "밀양아리랑우주천문대", region: "경남 밀양", lat: 35.5026, lon: 128.7611, primary: false, verified: true },
  { id: "gimhae", name: "김해천문대", region: "경남 김해", lat: 35.25317, lon: 128.88748, primary: false, verified: true },
  { id: "gokseong", name: "곡성섬진강천문대", region: "전남 곡성", lat: 35.22756, lon: 127.36994, primary: false, verified: true },
  { id: "suncheon", name: "순천만천문대", region: "전남 순천", lat: 34.88578, lon: 127.50928, primary: false, verified: true },
  { id: "jangheung", name: "정남진천문과학관", region: "전남 장흥", lat: 34.65801, lon: 126.92583, primary: false, verified: true },
  { id: "goheung", name: "고흥우주천문과학관", region: "전남 고흥", lat: 34.55253, lon: 127.12505, primary: false, verified: true },
  { id: "seogwipo", name: "서귀포천문과학문화관", region: "제주 서귀포", lat: 33.28883, lon: 126.46039, primary: false, verified: true },
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
