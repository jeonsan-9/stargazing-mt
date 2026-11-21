// 예보 소스 이름표. key는 data/forecast.json 과 Open-Meteo 응답에서 쓰는 이름입니다.
export const MODELS = {
  kma: { label: "기상청", color: "#ff7b72" },
  ecmwf_ifs025: { label: "ECMWF", color: "#79c0ff" },
  gfs_seamless: { label: "GFS (미국)", color: "#d2a8ff" },
  icon_seamless: { label: "ICON (독일)", color: "#7ee787" },
  jma_seamless: { label: "JMA (일본)", color: "#ffa657" },
  ukmo_seamless: { label: "UKMO (영국)", color: "#f2cc60" },
  cma_grapes_global: { label: "CMA (중국)", color: "#ff9bce" },
  meteofrance_seamless: { label: "Météo-France", color: "#a5d6ff" },
  metno: { label: "MET Norway", color: "#56d4dd" },
  "7timer": { label: "7Timer", color: "#c9d1d9" },
};

// Open-Meteo에서 직접 받는 모델들
export const OPEN_METEO_MODELS = [
  "ecmwf_ifs025",
  "gfs_seamless",
  "icon_seamless",
  "jma_seamless",
  "ukmo_seamless",
  "cma_grapes_global",
  "meteofrance_seamless",
];

// 구름 지도에 쓸 수 있는 모델
export const GRID_MODELS = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless", "jma_seamless"];

export function modelLabel(key) {
  return MODELS[key]?.label ?? key;
}
