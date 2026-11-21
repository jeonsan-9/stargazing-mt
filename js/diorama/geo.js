// 위경도 ↔ 디오라마 좌표 변환
// 약속: Y가 위, 1 unit = 1 km, 북쪽 = -Z, 동쪽 = +X (블렌더 +Y북쪽을 glTF로 내보내면 이렇게 됨)
// 원점은 LON0, LAT0. 모델이 이 약속을 정확히 따르지 않아도
// 관측지 빈 오브젝트(site_<id>)가 2개 이상 있으면 그 위치로 자동 보정함.

export const LON0 = 127.8;
export const LAT0 = 35.9;
const KX = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110.57;
const RAD = Math.PI / 180;
const E2 = 0.00669437999014; // WGS84

// 약속대로의 km 좌표
export function lonLatToKm(lon, lat) {
  // Local transverse Mercator series, matching the DEM and light textures.
  const phi = lat * RAD, mid = (lat + LAT0) * RAD / 2;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const n = 6378.137 / Math.sqrt(1 - E2 * sin * sin);
  const m = 6378.137 * (1 - E2) / (1 - E2 * Math.sin(mid) ** 2) ** 1.5;
  const a = (lon - LON0) * RAD * cos;
  return { x: n * (a + (1 - tan * tan + E2 * cos * cos / (1 - E2)) * a ** 3 / 6),
    z: -(m * (lat - LAT0) * RAD + n * tan * a * a / 2) };
}

// 보정: 모델 좌표 = s·R(θ)·km + t (XZ 평면 닮음 변환)
let cal = { s: 1, c: 1, n: 0, tx: 0, tz: 0 };

export function project(lon, lat) {
  const { x, z } = lonLatToKm(lon, lat);
  return {
    x: cal.s * (cal.c * x - cal.n * z) + cal.tx,
    z: cal.s * (cal.n * x + cal.c * z) + cal.tz,
  };
}

export function unproject(mx, mz) {
  const x0 = mx - cal.tx;
  const z0 = mz - cal.tz;
  const x = (cal.c * x0 + cal.n * z0) / cal.s;
  const z = (-cal.n * x0 + cal.c * z0) / cal.s;
  let lon = x / KX + LON0, lat = -z / KZ + LAT0;
  for (let i = 0; i < 3; i++) {
    const estimate = lonLatToKm(lon, lat);
    lon += (x - estimate.x) / KX;
    lat -= (z - estimate.z) / KZ;
  }
  return { lon, lat };
}

// pairs: [{ km:{x,z}, model:{x,z} }] 2개 이상 → 최소제곱 닮음 변환
export function calibrate(pairs) {
  if (pairs.length < 2) return false;
  const n = pairs.length;
  let ax = 0, az = 0, bx = 0, bz = 0;
  for (const p of pairs) { ax += p.km.x; az += p.km.z; bx += p.model.x; bz += p.model.z; }
  ax /= n; az /= n; bx /= n; bz /= n;
  let sxx = 0, sxy = 0, ss = 0;
  for (const p of pairs) {
    const x = p.km.x - ax, z = p.km.z - az;
    const u = p.model.x - bx, v = p.model.z - bz;
    sxx += x * u + z * v;
    sxy += x * v - z * u;
    ss += x * x + z * z;
  }
  if (ss < 1e-9) return false;
  const a = sxx / ss, b = sxy / ss;
  const s = Math.hypot(a, b);
  cal = { s, c: a / s, n: b / s, tx: 0, tz: 0 };
  cal.tx = bx - s * (cal.c * ax - cal.n * az);
  cal.tz = bz - s * (cal.n * ax + cal.c * az);
  return true;
}

// 관측지가 없을 때: 섬 바운딩박스를 남한 범위에 맞춤 (회전 없음, 대략)
export const KOREA_BOX = { west: 124.6, east: 130.95, south: 33.1, north: 38.62 };
export function fitBox(box3) {
  const a = lonLatToKm(KOREA_BOX.west, KOREA_BOX.north);
  const b = lonLatToKm(KOREA_BOX.east, KOREA_BOX.south);
  const s = (box3.max.x - box3.min.x) / (b.x - a.x);
  cal = { s, c: 1, n: 0, tx: box3.min.x - s * a.x, tz: box3.min.z - s * a.z };
}

export function scale() {
  return cal.s;
}
