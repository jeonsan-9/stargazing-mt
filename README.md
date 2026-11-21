# 별보러 MT

동아리 관측 MT 날짜와 장소를 고르는 3D 지도입니다. 여러 기상 모델의 구름 예보를 종합해 관측지마다 밤 점수를 매기고, 한반도 지형 위에 점수 기둥과 구름층을 띄웁니다.

## 무엇을 보여주나

- **관측할 밤**: 앞으로 7일 밤마다 동아리 관측지 중 최고 점수와 달 밝기
- **관측지 점수 (0~100)**: 천문박명 사이 각 시각의 `(1 - 모델 구름 중간값) × 달빛 감점 × 습도 감점` 평균
- **모델 일치도**: 모델끼리 구름량이 평균 20%p 미만 차이면 높음, 40%p 미만 보통, 그 이상 낮음
- **구름층**: 시간 슬라이더와 모델 선택(ECMWF, GFS, ICON, JMA)으로 Windy처럼 구름 분포를 봄
- **관측지 상세**: 고도, 천문박명, 월령과 달 뜨고 지는 시각, 7Timer 시상/투명도, 모델별 구름량

## 예보 소스

| 소스 | 키 |
| --- | --- |
| Open-Meteo: ECMWF, GFS, ICON, JMA, UKMO, CMA, Météo-France | 불필요 |
| MET Norway Locationforecast | 불필요 |
| 7Timer ASTRO (구름, 시상, 투명도) | 불필요 |
| 기상청 단기예보 (하늘상태, 강수, 습도, 바람) | 필요 |

## 구조

- `index.html`, `css/`, `js/`: 정적 웹 페이지 (MapLibre GL + deck.gl + SunCalc)
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

- 의성 달빛공원, 군위 화산마을 좌표는 임시값입니다 (`verified: false`)
- 기상청 하늘상태는 맑음/구름많음/흐림 3단계라 25/70/95%로 바꿔 씁니다
- 구름 지도 격자는 0.5° (약 50km) 간격입니다
