import { SITES } from "./sites.js";
import { observeTarget, searchObservingTargets } from "./targets.js";
import { ymd } from "./score.js";
import { drawNightSky, nightSky } from "./diorama/night.js";
import { cameraFrame, drawCameraFrame } from "./diorama/optics.js";

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" });
const directions = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const presets = { full: [36, 24], aps: [23.5, 15.6], mft: [17.3, 13] };
let choices, target, sky, skyKey, apparentSize;

$("site").replaceChildren(...SITES.map((site) => new Option(site.name, site.id)));
$("site").value = SITES.some(({ id }) => id === query.get("site")) ? query.get("site") : "bohyeon_obs";
const requestedDay = query.get("day");
if (/^\d{4}-\d\d-\d\d$/.test(requestedDay ?? "")) $("night").value = requestedDay;
if (!$("night").value || !$("night").validity.valid) $("night").value = ymd(new Date());

function selectedSite() {
  return SITES.find(({ id }) => id === $("site").value);
}

function updateSearch(preferred = $("target").value || "M31") {
  choices = searchObservingTargets($("search").value);
  $("target").replaceChildren(...choices.map((item) =>
    new Option(item.id === "moon" || item.kind === "행성" ? item.name : `${item.id} · ${item.name}`, item.id)));
  if (choices.some(({ id }) => id === preferred)) $("target").value = preferred;
  $("target").disabled = choices.length === 0;
  $("search-status").textContent = choices.length ? `${choices.length}개 대상` : "검색 결과가 없습니다. 메시에 번호나 대상 이름을 바꿔보세요.";
  selectTarget();
}

function selectTarget() {
  const next = choices.find(({ id }) => id === $("target").value);
  if (target !== next) {
    $("major").value = "";
    $("minor").value = "";
    target = next;
    skyKey = undefined;
  }
  updateSky();
}

function updateSky() {
  const day = $("night").value;
  if (!$("night").validity.valid) {
    sky = undefined;
    $("best").textContent = "1800년부터 2050년 사이의 날짜를 선택하세요.";
    $("crossings").textContent = "";
    $("altitude").getContext("2d").clearRect(0, 0, $("altitude").width, $("altitude").height);
    updatePosition();
    return;
  }
  const site = selectedSite();
  const key = `${site.id}:${day}:${target?.id ?? ""}`;
  if (key !== skyKey || !sky) {
    sky = nightSky(day, site);
    skyKey = key;
    let highest;
    const crossings = [];
    if (target) {
      for (const [index, sample] of sky.samples.entries()) {
        sample.target = observeTarget(target, sample.time, site).alt;
        if (sample.sun <= -12 && sample.target > 0 && (!highest || sample.target > highest.target)) highest = sample;
        const previous = sky.samples[index - 1];
        if (previous && (previous.target < 0) !== (sample.target < 0)) {
          const ratio = -previous.target / (sample.target - previous.target);
          const time = new Date(+previous.time + ratio * (sample.time - previous.time));
          crossings.push(`${sample.target >= 0 ? "뜸" : "짐"} ${clock.format(time)}`);
        }
      }
    }
    $("best").textContent = highest ? `해 고도 −12° 이하인 시간 중 최고 고도 · ${clock.format(highest.time)} ${Math.round(highest.target)}°`
      : target ? "해 고도 −12° 이하인 시간에 지평선 위로 올라오지 않습니다." : "";
    $("crossings").textContent = crossings.length ? `지평선 통과 · ${crossings.join(" · ")}` : "";
  }
  updatePosition();
}

function updatePosition() {
  const time = sky?.samples[Number($("scrub").value)]?.time;
  $("scrub").disabled = !time;
  $("at-time").textContent = time ? `${clock.format(time)} KST` : "–";
  $("scrub").setAttribute("aria-valuetext", $("at-time").textContent);
  if (sky && time) drawNightSky($("altitude"), sky, time);
  const pos = target && time ? observeTarget(target, time, selectedSite()) : null;
  $("alt").textContent = pos ? `${Math.round(pos.alt)}°${pos.alt < 0 ? " · 지평선 아래" : ""}` : "–";
  $("az").textContent = pos ? `${directions[Math.round(pos.az / 45) % 8]} ${Math.round(pos.az) % 360}°` : "–";
  $("separation").textContent = pos?.moonSeparation != null ? `${Math.round(pos.moonSeparation)}°` : "–";
  apparentSize = pos?.size;
  updateFraming();
}

function updateFraming() {
  const customSensor = $("sensor").value === "custom";
  $("sensor-size").hidden = !customSensor;
  const sensor = customSensor ? [$("sensor-width").valueAsNumber, $("sensor-height").valueAsNumber] : presets[$("sensor").value];
  const angle = $("angle").valueAsNumber;
  $("rotation").textContent = `${angle}°`;
  const override = Boolean($("major").value || $("minor").value);
  const suppliedSize = [$("major").valueAsNumber, $("minor").valueAsNumber];
  const validSize = [$("major"), $("minor")].every((field) => field.value && field.validity.valid);
  const size = override ? (validSize ? suppliedSize : null) : apparentSize;
  const validSensor = !customSensor || [$("sensor-width"), $("sensor-height")].every((field) => field.validity.valid);
  const frame = validSensor && $("focal").validity.valid ? cameraFrame(...sensor, $("focal").valueAsNumber, angle, size) : null;
  drawCameraFrame($("framing"), frame);
  $("frame-result").textContent = frame ? `가로 ${frame.width.toFixed(2)}° × 세로 ${frame.height.toFixed(2)}°${frame.target ? (frame.fits ? " · 대상이 프레임 안에 들어옵니다" : " · 대상 일부가 프레임 밖입니다") : ""}`
    : "센서 크기와 초점거리에 0보다 큰 값을 입력하세요.";
  $("target-size").textContent = override && !validSize ? "장축과 단축을 모두 입력하세요."
    : size ? `대상 각크기 · 약 ${size[0].toFixed(2)}′ × ${size[1].toFixed(2)}′${target?.kind === "행성" && !override ? " (원반)" : ""}`
      : "각크기 자료가 없는 대상은 장축과 단축을 직접 입력할 수 있습니다.";
}

$("search").addEventListener("input", () => updateSearch());
$("target").addEventListener("change", selectTarget);
for (const id of ["site", "night"]) $(id).addEventListener("input", updateSky);
$("scrub").addEventListener("input", updatePosition);
for (const id of ["sensor", "sensor-width", "sensor-height", "focal", "angle", "major", "minor"]) $(id).addEventListener("input", updateFraming);
updateSearch(query.get("target") ?? "M31");
