# AAA 징크스 타파기

계명대학교 천체관측 동아리 AAA가 전국 31개 관측 후보의 날씨와 밤하늘을 비교하는 지도입니다. 영천 보현산 두 지점은 동아리 MT 거점입니다.

## 무엇을 보여주나

- **관측할 밤**: 앞으로 7일 밤마다 동아리 관측지 중 최고 점수와 달 밝기
- **관측지 점수 (0~100)**: 어둠, 구름, 달, 습도, 바람, 미세먼지, 시정, 강수를 함께 반영합니다. 밤 점수는 연속 3시간의 최고 평균입니다.
- **모델 일치도**: 모델끼리 구름량이 평균 20%p 미만 차이면 높음, 40%p 미만 보통, 그 이상 낮음
- **구름층**: 시간 슬라이더와 모델 선택(ECMWF, GFS, ICON, JMA)으로 Windy처럼 구름 분포를 봄
- **관측지 상세**는 고도, 천문박명, 달 뜨고 지는 시각, 7Timer 시상·투명도, 모델별 구름량을 보여줍니다. 각 관측지에는 출입·예약·지형에 관한 특이사항만 표시합니다.
- **3D 디오라마**에서는 예보 구름, 관측지별 점수, 실제 방위와 고도를 따르는 달을 봅니다. 거리와 크기는 모형에 맞춰 조정했습니다. 밤에는 달 원반 위치에서 퍼지는 부드러운 조명이 산과 나무의 그림자를 만듭니다. **지도 크게 보기**를 누르면 디오라마가 화면을 채웁니다. **일반 지도**에서 기존 지도를 열 수 있습니다.
- **이곳에서 하늘 보기**는 선택한 관측지의 지상 시점으로 이동합니다. 방위를 돌리거나 시간을 바꿔 DEM으로 계산한 능선 위의 달과 별을 볼 수 있습니다. 날씨와 주변 시설에 따른 가림은 예보·관측지 상세에서 확인합니다. 한국에서 잘 보이는 대표 별자리 19개의 선과 이름을 켜고 끌 수 있습니다.
- **관측 도구** `observe.html`에서 관측지·날짜·시간을 선택하면 하늘 지도와 대상 경로가 갱신됩니다. 달·행성·대표 메시에/NGC 대상을 이름이나 적경·적위 좌표(예: `5h35m -5°23′`)로 검색하고, 뜨고 지는 시각과 남중을 확인하고, 하늘 지도에서 별자리 선과 대상 근처의 별자리를 볼 수 있습니다. 카메라 센서와 스마트 망원경(Seestar S50·S30, DWARF 3) 프리셋으로 센서와 초점거리에 따른 화각을 비교할 수 있습니다. 장비와 관측 계획·완료 기록은 현재 브라우저에 저장되며, 기록은 CSV로 내려받을 수 있습니다. [OpenNGC 각크기 자료](https://github.com/mattiaverga/OpenNGC)
- **메시에 마라톤** (`observe.html` 아래쪽): 고른 관측지·날짜에서 메시에 110개를 각각 몇 시부터 몇 시까지 볼 수 있는지 계산해 서쪽에서 먼저 지는 순서로 보여 줍니다. 본 천체를 체크하면 이 브라우저에 쌓입니다. 메시에 좌표·등급·크기는 [d3-celestial](https://github.com/ofrohn/d3-celestial) `data/messier.json` (Olaf Frohn, BSD-3-Clause)을 썼습니다.

## 예보 소스

| 소스 | 키 |
| --- | --- |
| Open-Meteo: ECMWF, GFS, ICON, JMA, UKMO, CMA, Météo-France | 불필요 |
| MET Norway Locationforecast | 불필요 |
| 7Timer ASTRO (구름, 시상, 투명도) | 불필요 |
| 기상청 단기예보 (하늘상태, 강수, 습도, 바람) | 필요 |

## 구조

- `index.html`, `css/`, `js/`: 정적 웹 페이지 (MapLibre GL + deck.gl + SunCalc)
- `diorama.html`, `js/diorama/`, `models/`: Three.js 디오라마와 Draco GLB 모델
- `sky.html`, `js/sky.js`: 관측지 파노라마. 별 데이터는 [d3-celestial](https://github.com/ofrohn/d3-celestial/blob/master/data/stars.6.json), 산 능선은 Copernicus WorldDEM-90으로 계산합니다. 원본 DEM 타일이 있으면 `python scripts/prepare_horizon.py 타일폴더`로 능선을 다시 계산할 수 있습니다.
- `js/sites.js`: 관측지 목록. 여기만 고치면 수집 스크립트도 따라감
- `scripts/fetch_forecast.py`: 모든 소스를 모아 `data/forecast.json` 생성 (표준 라이브러리만 사용)
- `.github/workflows/forecast.yml`: 3시간마다 수집하고 GitHub Pages에 배포

`data/forecast.json`이 없으면 페이지가 브라우저에서 Open-Meteo를 직접 호출합니다 (기상청, MET Norway, 7Timer 제외).

## 처음 설정

1. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정
2. 기상청 키를 저장소 **Settings → Secrets and variables → Actions**에 등록 (둘 중 하나)
   - `KMA_AUTH_KEY`: [기상청 API허브](https://apihub.kma.go.kr/) 인증키
   - `KMA_SERVICE_KEY`: [공공데이터포털](https://www.data.go.kr/) "기상청_단기예보 조회서비스" 일반 인증키(Decoding)
3. **Actions → 예보 갱신 및 배포 → Run workflow**로 첫 배포

## 로컬에서 보기

```bash
python3 scripts/fetch_forecast.py        # data/forecast.json 생성 (기상청 키는 환경변수로)
python3 -m http.server 8000              # http://localhost:8000
```

## 알려진 한계

- 군위 화산마을 핀은 한국관광공사 TourAPI의 화산산성 전망대 좌표를 사용합니다. 주왕산은 공원 일대의 예보 기준점입니다.
- 기상청 하늘상태는 맑음/구름많음/흐림 3단계라 25/70/95%로 바꿔 씁니다
- 구름 지도 격자는 0.5° (약 50km) 간격입니다. 디오라마의 구름 형태와 고도는 시각화용이며 강수와 안개는 3D 효과로 표시하지 않습니다.

### 도시 불빛

지도에서 ‘도시 불빛’을 켜면 서울·대구·부산 같은 도심의 광원이 꿀빛으로 겹칩니다. 3D에서는 해가 질수록 불빛이 드러나고 일반 지도에서는 같은 자료를 시간과 관계없이 비교할 수 있습니다. 중심부는 2024년 연간 위성 야간복사휘도, 주변의 옅은 번짐은 그 분포를 부드럽게 퍼뜨린 시각 효과입니다. 현장 하늘에서는 각 지점 주변 65km 안의 광원을 방위별로 모아 지평선에 옅은 빛을 그립니다. 밝기는 정성적으로 비교할 수 있습니다.

자료는 NASA Black Marble VJ146A4의 눈 없는 기간 전 관측각 합성값을 사용합니다. GeoTIFF 변환 및 배포는 Jurij Stare / lightpollutionmap.info, 한국 영역 가공은 `scripts/prepare_lights.py`입니다. [NASA 자료 설명](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VJ146A4) · [GeoTIFF 배포처](https://www.lightpollutionmap.info/help.html)
