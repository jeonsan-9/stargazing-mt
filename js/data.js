// 예보 데이터 불러오기.
// 1순위: GitHub Actions가 3시간마다 만드는 data/forecast.json (기상청, MET Norway, 7Timer 포함)
// 2순위: 그 파일이 없으면 브라우저에서 Open-Meteo를 직접 호출 (Open-Meteo 모델만)

import { SITES, GRID, gridAxes } from "./sites.js";
import { OPEN_METEO_MODELS, GRID_MODELS } from "./models.js";

const OM_URL = "https://api.open-meteo.com/v1/forecast";

export async function loadForecast() {
  try {
    const res = await fetch("data/forecast.json", { cache: "no-cache" });
    if (res.ok) {
      const data = await res.json();
      if (data?.times?.length) {
        data.source = "precomputed";
        return data;
      }
    }
  } catch (e) {
    console.warn("forecast.json 없음, Open-Meteo 직접 호출", e);
  }
  return loadLive();
}

// Open-Meteo 다중 지점 응답에서 변수 값 꺼내기 (모델이 하나면 접미사가 붙지 않음)
function pick(hourly, variable, model) {
  return hourly[`${variable}_${model}`] ?? hourly[variable] ?? null;
}

function toArray(json) {
  return Array.isArray(json) ? json : [json];
}

async function omFetch(params) {
  const url = OM_URL + "?" + new URLSearchParams(params).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return toArray(await res.json());
}

async function loadLive() {
  const siteResp = await omFetch({
    latitude: SITES.map((s) => s.lat).join(","),
    longitude: SITES.map((s) => s.lon).join(","),
    hourly: "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,wind_speed_10m,visibility,temperature_2m,precipitation",
    models: OPEN_METEO_MODELS.join(","),
    forecast_days: 7,
    timezone: "Asia/Seoul",
    wind_speed_unit: "ms",
  });

  const times = siteResp[0].hourly.time;
  const sites = {};
  SITES.forEach((s, i) => {
    const h = siteResp[i].hourly;
    const models = {};
    for (const m of OPEN_METEO_MODELS) {
      const cloud = pick(h, "cloud_cover", m);
      if (!cloud || cloud.every((v) => v == null)) continue;
      models[m] = {
        cloud,
        low: pick(h, "cloud_cover_low", m),
        mid: pick(h, "cloud_cover_mid", m),
        high: pick(h, "cloud_cover_high", m),
        rh: pick(h, "relative_humidity_2m", m),
        wind: pick(h, "wind_speed_10m", m),
        vis: pick(h, "visibility", m),
        temp: pick(h, "temperature_2m", m),
        precip: pick(h, "precipitation", m),
      };
    }
    sites[s.id] = { elevation: siteResp[i].elevation, models };
  });

  const { lats, lons } = gridAxes(GRID);
  const pts = [];
  for (const la of lats) for (const lo of lons) pts.push([la, lo]);
  const gridResp = await omFetch({
    latitude: pts.map((p) => p[0]).join(","),
    longitude: pts.map((p) => p[1]).join(","),
    hourly: "cloud_cover",
    models: GRID_MODELS.join(","),
    forecast_days: 7,
    timezone: "Asia/Seoul",
  });
  const gridModels = {};
  for (const m of GRID_MODELS) {
    const perTime = times.map((_, t) =>
      gridResp.map((r) => {
        const arr = pick(r.hourly, "cloud_cover", m);
        return arr ? arr[t] : null;
      })
    );
    if (perTime.some((row) => row.some((v) => v != null))) gridModels[m] = perTime;
  }

  return {
    source: "live",
    generated: new Date().toISOString(),
    timezone: "Asia/Seoul",
    times,
    sites,
    grid: { lats, lons, models: gridModels },
  };
}
