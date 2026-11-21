#!/usr/bin/env python3
"""여러 무료 예보 소스를 모아 data/forecast.json 을 만듭니다.

소스
- Open-Meteo: ECMWF, GFS, ICON, JMA, UKMO, CMA, Météo-France (키 불필요)
- MET Norway Locationforecast (키 불필요, User-Agent 필요)
- 7Timer ASTRO: 구름, 시상, 투명도 (키 불필요)
- 기상청 단기예보: 환경변수 KMA_AUTH_KEY(기상청 API허브) 또는 KMA_SERVICE_KEY(공공데이터포털)가 있을 때만

표준 라이브러리만 사용합니다. 실행: python3 scripts/fetch_forecast.py
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "forecast.json"
KST = timezone(timedelta(hours=9))
UA = "stargazing-mt/0.1 (+https://github.com/jeonsan-9/stargazing-mt)"

OPEN_METEO_MODELS = [
    "ecmwf_ifs025",
    "gfs_seamless",
    "icon_seamless",
    "jma_seamless",
    "ukmo_seamless",
    "cma_grapes_global",
    "meteofrance_seamless",
]
GRID_MODELS = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless", "jma_seamless"]
# 하층/중층/상층 구름 격자는 이 모델들만 (파일 크기 때문)
GRID_LAYER_MODELS = ["ecmwf_ifs025", "gfs_seamless"]
SITE_VARS = (
    "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,"
    "relative_humidity_2m,wind_speed_10m,visibility,temperature_2m"
)


def load_js_config():
    """js/sites.js 에서 관측지와 격자 설정을 읽어 한 곳에서만 관리합니다."""
    src = (ROOT / "js" / "sites.js").read_text(encoding="utf-8")
    sites = []
    for m in re.finditer(r"\{\s*id:\s*\"([^\"]+)\".*?lat:\s*([\d.]+),\s*lon:\s*([\d.]+)", src):
        if m.group(1) == "kmu":
            continue
        sites.append({"id": m.group(1), "lat": float(m.group(2)), "lon": float(m.group(3))})
    g = {}
    for key in ("south", "north", "west", "east", "step"):
        g[key] = float(re.search(rf"{key}:\s*([\d.]+)", src.split("GRID")[1]).group(1))
    return sites, g


def grid_axes(g):
    lats, lons = [], []
    la = g["north"]
    while la >= g["south"] - 1e-9:
        lats.append(round(la, 3))
        la -= g["step"]
    lo = g["west"]
    while lo <= g["east"] + 1e-9:
        lons.append(round(lo, 3))
        lo += g["step"]
    return lats, lons


SECRET_PARAMS = {"authKey", "serviceKey"}


def scrub(text):
    """오류 문구에서 키 값을 지움 (errors 는 공개되는 forecast.json 에 들어감)."""
    text = str(text)
    for name in ("KMA_AUTH_KEY", "KMA_SERVICE_KEY", "BAZE_API_KEY"):
        val = os.environ.get(name)
        if val:
            text = text.replace(val, "***").replace(urllib.parse.quote(val, safe=""), "***")
    return re.sub(r"(authKey|serviceKey)=[^&\s]+", r"\1=***", text)


def get_json(url, params=None, headers=None, retries=3):
    base = url
    if params:
        url = url + "?" + urllib.parse.urlencode(params, safe=",:")
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(scrub(f"{base} 실패: {last}"))


def pick(hourly, var, model):
    return hourly.get(f"{var}_{model}", hourly.get(var))


def as_list(x):
    return x if isinstance(x, list) else [x]


# ---------------- Open-Meteo ----------------
def fetch_open_meteo(sites):
    resp = as_list(
        get_json(
            "https://api.open-meteo.com/v1/forecast",
            {
                "latitude": ",".join(str(s["lat"]) for s in sites),
                "longitude": ",".join(str(s["lon"]) for s in sites),
                "hourly": SITE_VARS,
                "models": ",".join(OPEN_METEO_MODELS),
                "forecast_days": 7,
                "timezone": "Asia/Seoul",
                "wind_speed_unit": "ms",
            },
        )
    )
    times = resp[0]["hourly"]["time"]
    out = {}
    for s, r in zip(sites, resp):
        h = r["hourly"]
        models = {}
        for m in OPEN_METEO_MODELS:
            cloud = pick(h, "cloud_cover", m)
            if not cloud or all(v is None for v in cloud):
                continue
            models[m] = {
                "cloud": cloud,
                "low": pick(h, "cloud_cover_low", m),
                "mid": pick(h, "cloud_cover_mid", m),
                "high": pick(h, "cloud_cover_high", m),
                "rh": pick(h, "relative_humidity_2m", m),
                "wind": pick(h, "wind_speed_10m", m),
                "vis": pick(h, "visibility", m),
                "temp": pick(h, "temperature_2m", m),
            }
        out[s["id"]] = {"elevation": r.get("elevation"), "models": models}
    return times, out


def fetch_grid(lats, lons, times):
    pts = [(la, lo) for la in lats for lo in lons]
    resp = as_list(
        get_json(
            "https://api.open-meteo.com/v1/forecast",
            {
                "latitude": ",".join(str(p[0]) for p in pts),
                "longitude": ",".join(str(p[1]) for p in pts),
                "hourly": "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high",
                "models": ",".join(GRID_MODELS),
                "forecast_days": 7,
                "timezone": "Asia/Seoul",
            },
        )
    )
    def field(var, m):
        cols = [pick(r["hourly"], var, m) or [None] * len(times) for r in resp]
        per_time = [[c[t] if t < len(c) else None for c in cols] for t in range(len(times))]
        return per_time if any(v is not None for row in per_time for v in row) else None

    models = {}
    layers = {}
    for m in GRID_MODELS:
        total = field("cloud_cover", m)
        if total:
            models[m] = total
        if m in GRID_LAYER_MODELS:
            lay = {k: field(f"cloud_cover_{k}", m) for k in ("low", "mid", "high")}
            lay = {k: v for k, v in lay.items() if v}
            if lay:
                layers[m] = lay
    return {"lats": lats, "lons": lons, "models": models, "layers": layers}


# ---------------- 미세먼지 (Open-Meteo Air Quality, CAMS) ----------------
def fetch_air(sites, times):
    resp = as_list(
        get_json(
            "https://air-quality-api.open-meteo.com/v1/air-quality",
            {
                "latitude": ",".join(str(s["lat"]) for s in sites),
                "longitude": ",".join(str(s["lon"]) for s in sites),
                "hourly": "pm2_5,pm10",
                "forecast_days": 5,
                "timezone": "Asia/Seoul",
            },
        )
    )
    idx = index_of(times)
    out = {}
    for s, r in zip(sites, resp):
        h = r["hourly"]
        pm25 = [None] * len(times)
        pm10 = [None] * len(times)
        for k, t in enumerate(h["time"]):
            i = idx.get(t)
            if i is not None:
                pm25[i] = h["pm2_5"][k]
                pm10[i] = h["pm10"][k]
        out[s["id"]] = {"pm25": pm25, "pm10": pm10}
    return out


# ---------------- 시간축 맞추기 ----------------
def index_of(times):
    return {t: i for i, t in enumerate(times)}


def local_key(dt_utc):
    return dt_utc.astimezone(KST).strftime("%Y-%m-%dT%H:00")


# ---------------- MET Norway ----------------
def fetch_metno(site, times):
    data = get_json(
        "https://api.met.no/weatherapi/locationforecast/2.0/complete",
        {"lat": f"{site['lat']:.4f}", "lon": f"{site['lon']:.4f}"},
    )
    idx = index_of(times)
    cloud = [None] * len(times)
    rh = [None] * len(times)
    wind = [None] * len(times)
    low = [None] * len(times)
    mid = [None] * len(times)
    high = [None] * len(times)
    for ts in data["properties"]["timeseries"]:
        dt = datetime.fromisoformat(ts["time"].replace("Z", "+00:00"))
        i = idx.get(local_key(dt))
        if i is None:
            continue
        d = ts["data"]["instant"]["details"]
        cloud[i] = d.get("cloud_area_fraction")
        low[i] = d.get("cloud_area_fraction_low")
        mid[i] = d.get("cloud_area_fraction_medium")
        high[i] = d.get("cloud_area_fraction_high")
        rh[i] = d.get("relative_humidity")
        wind[i] = d.get("wind_speed")
    return {"cloud": cloud, "low": low, "mid": mid, "high": high, "rh": rh, "wind": wind}


# ---------------- 7Timer ----------------
SEVEN_CLOUD = {1: 3, 2: 12, 3: 25, 4: 37, 5: 50, 6: 62, 7: 75, 8: 87, 9: 97}


def fetch_7timer(site, times):
    data = get_json(
        "https://www.7timer.info/bin/astro.php",
        {"lon": f"{site['lon']:.3f}", "lat": f"{site['lat']:.3f}", "ac": 0, "unit": "metric", "output": "json"},
    )
    init = datetime.strptime(data["init"], "%Y%m%d%H").replace(tzinfo=timezone.utc)
    idx = index_of(times)
    cloud = [None] * len(times)
    seeing = [None] * len(times)
    transp = [None] * len(times)
    for p in data["dataseries"]:
        center = init + timedelta(hours=p["timepoint"])
        for off in (-1, 0, 1):  # 3시간 간격 자료를 앞뒤 1시간에도 채움
            i = idx.get(local_key(center + timedelta(hours=off)))
            if i is None:
                continue
            cloud[i] = SEVEN_CLOUD.get(p.get("cloudcover"))
            seeing[i] = p.get("seeing")
            transp[i] = p.get("transparency")
    return {"cloud": cloud}, {"seeing": seeing, "transparency": transp}


# ---------------- 기상청 단기예보 ----------------
def latlon_to_kma_grid(lat, lon):
    """기상청 동네예보 격자(LCC) 변환. 기상청 공개 변환식."""
    RE, GRID = 6371.00877, 5.0
    SLAT1, SLAT2, OLON, OLAT = 30.0, 60.0, 126.0, 38.0
    XO, YO = 43, 136
    DEGRAD = math.pi / 180.0
    re_ = RE / GRID
    slat1, slat2 = SLAT1 * DEGRAD, SLAT2 * DEGRAD
    olon, olat = OLON * DEGRAD, OLAT * DEGRAD
    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5)
    sf = math.pow(sf, sn) * math.cos(slat1) / sn
    ro = math.tan(math.pi * 0.25 + olat * 0.5)
    ro = re_ * sf / math.pow(ro, sn)
    ra = math.tan(math.pi * 0.25 + lat * DEGRAD * 0.5)
    ra = re_ * sf / math.pow(ra, sn)
    theta = lon * DEGRAD - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn
    nx = int(math.floor(ra * math.sin(theta) + XO + 0.5))
    ny = int(math.floor(ro - ra * math.cos(theta) + YO + 0.5))
    return nx, ny


def kma_base(now_kst):
    """가장 최근 발표 시각 (02, 05, 08, … 23시, 발표 후 15분 여유)."""
    t = now_kst - timedelta(minutes=15)
    for h in (23, 20, 17, 14, 11, 8, 5, 2):
        if t.hour >= h:
            return t.strftime("%Y%m%d"), f"{h:02d}00"
    y = t - timedelta(days=1)
    return y.strftime("%Y%m%d"), "2300"


# 하늘상태 SKY: 1 맑음(0~5할), 3 구름많음(6~8할), 4 흐림(9~10할) -> 구간 중간값 %
KMA_SKY = {"1": 25, "3": 70, "4": 95}


def fetch_kma(site, times):
    auth = os.environ.get("KMA_AUTH_KEY")
    service = os.environ.get("KMA_SERVICE_KEY")
    if not (auth or service):
        return None
    nx, ny = latlon_to_kma_grid(site["lat"], site["lon"])
    base_date, base_time = kma_base(datetime.now(KST))
    params = {
        "pageNo": 1,
        "numOfRows": 1500,
        "dataType": "JSON",
        "base_date": base_date,
        "base_time": base_time,
        "nx": nx,
        "ny": ny,
    }
    if auth:
        params["authKey"] = auth
        url = "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst"
    else:
        params["serviceKey"] = service
        url = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
    data = get_json(url, params)
    items = data.get("response", {}).get("body", {}).get("items", {}).get("item", [])
    if not items:
        header = data.get("response", {}).get("header", {})
        raise RuntimeError(scrub(f"기상청 응답에 자료 없음: {header.get('resultCode')} {header.get('resultMsg')}"))
    idx = index_of(times)
    cloud = [None] * len(times)
    rh = [None] * len(times)
    wind = [None] * len(times)
    for it in items:
        d, t = it["fcstDate"], it["fcstTime"]
        key = f"{d[:4]}-{d[4:6]}-{d[6:]}T{t[:2]}:00"
        i = idx.get(key)
        if i is None:
            continue
        cat, val = it["category"], it["fcstValue"]
        if cat == "SKY":
            cloud[i] = KMA_SKY.get(str(val))
        elif cat == "PTY" and str(val) != "0":
            cloud[i] = 100  # 비/눈이면 관측 불가로 처리
        elif cat == "REH":
            rh[i] = float(val)
        elif cat == "WSD":
            wind[i] = float(val)  # m/s
    # PTY가 SKY보다 먼저 나오면 덮어써지지 않도록 한 번 더 반영
    for it in items:
        if it["category"] == "PTY" and str(it["fcstValue"]) != "0":
            d, t = it["fcstDate"], it["fcstTime"]
            i = idx.get(f"{d[:4]}-{d[4:6]}-{d[6:]}T{t[:2]}:00")
            if i is not None:
                cloud[i] = 100
    return {"cloud": cloud, "rh": rh, "wind": wind}


def main():
    sites, g = load_js_config()
    print(f"관측지 {len(sites)}곳")
    times, out = fetch_open_meteo(sites)
    print(f"Open-Meteo 시간축 {len(times)}개, 모델 {sorted({m for s in out.values() for m in s['models']})}")

    errors = []
    for s in sites:
        for name, fn in (("metno", fetch_metno), ("7timer", fetch_7timer), ("kma", fetch_kma)):
            try:
                res = fn(s, times)
            except Exception as e:  # noqa: BLE001
                errors.append(scrub(f"{name} {s['id']}: {e}"))
                continue
            if res is None:
                continue
            if name == "7timer":
                model, astro = res
                out[s["id"]]["models"]["7timer"] = model
                out[s["id"]]["astro"] = astro
            else:
                out[s["id"]]["models"][name] = res
            time.sleep(0.3)

    try:
        air = fetch_air(sites, times)
        for sid, a in air.items():
            out[sid]["air"] = a
    except Exception as e:  # noqa: BLE001
        errors.append(scrub(f"air: {e}"))

    lats, lons = grid_axes(g)
    grid = fetch_grid(lats, lons, times)

    payload = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "timezone": "Asia/Seoul",
        "times": times,
        "sites": out,
        "grid": grid,
        "errors": errors,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"저장: {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    for e in errors:
        print("경고:", e, file=sys.stderr)


if __name__ == "__main__":
    main()
