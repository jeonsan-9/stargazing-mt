import { SITES } from "./sites.js";
import { renderSiteInfo } from "./site-info.js";
import { observeTarget, observingTargets, searchObservingTargets } from "./targets.js";
import { ymd } from "./score.js";
import { drawNightSky, nightSky } from "./diorama/night.js";
import { cameraFrame, drawCameraFrame } from "./diorama/optics.js?v=20261122d";
import { drawSkyMap } from "./diorama/sky-map.js";

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" });
const directions = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const presets = { full: [36, 24], aps: [23.5, 15.6], mft: [17.3, 13] };
let choices, target, sky, skyKey, apparentSize, skyPoints = [], skyHits = [], editingSession;

function readSaved(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

const gearKey = "aaa.observe.gear.v1";
const sessionsKey = "aaa.observe.sessions.v1";
let gear = readSaved(gearKey);
let sessions = readSaved(sessionsKey);

function saveLocal(key, value, messageId) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    $(messageId).textContent = "브라우저 저장 공간을 사용할 수 없습니다.";
    return false;
  }
}

$("site").replaceChildren(...SITES.map((site) => new Option(site.name, site.id)));
$("site").value = SITES.some(({ id }) => id === query.get("site")) ? query.get("site") : "bohyeon_obs";
const requestedDay = query.get("day");
if (/^\d{4}-\d\d-\d\d$/.test(requestedDay ?? "")) $("night").value = requestedDay;
if (!$("night").value || !$("night").validity.valid) $("night").value = ymd(new Date());
const requestedTime = new Date(query.get("t") || "");
const offset = Math.round((requestedTime - new Date(`${$("night").value}T18:00:00+09:00`)) / 300000);
if (offset >= 0 && offset <= 144) $("scrub").value = offset;

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
  renderSiteInfo($("site-notes"), $("site").value);
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
        const { alt, az } = observeTarget(target, sample.time, site);
        sample.target = alt;
        sample.targetAz = az;
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
  const query = new URLSearchParams({ site: $("site").value, day: $("night").value });
  if (time) query.set("t", time.toISOString());
  $("site-sky-link").href = `./sky.html?${query}`;
  $("scrub").disabled = !time;
  $("at-time").textContent = time ? `${clock.format(time)} KST` : "–";
  $("scrub").setAttribute("aria-valuetext", $("at-time").textContent);
  if (sky && time) drawNightSky($("altitude"), sky, time);
  const pos = target && time ? observeTarget(target, time, selectedSite()) : null;
  skyPoints = time ? observingTargets.map((item) => ({ ...item, ...observeTarget(item, time, selectedSite()) })) : [];
  $("alt").textContent = pos ? `${Math.round(pos.alt)}°${pos.alt < 0 ? " · 지평선 아래" : ""}` : "–";
  $("az").textContent = pos ? `${directions[Math.round(pos.az / 45) % 8]} ${Math.round(pos.az) % 360}°` : "–";
  $("separation").textContent = pos?.moonSeparation != null ? `${Math.round(pos.moonSeparation)}°` : "–";
  apparentSize = pos?.size;
  $("session-context").textContent = target && time ? `${$("night").value} 밤 · ${clock.format(time)} KST · ${selectedSite().name} · ${target.name}` : "관측지, 날짜와 대상을 선택하세요.";
  $("session-plan").disabled = $("session-complete").disabled = !time || !target;
  updateFraming();
}

function currentEquipment() {
  const custom = $("sensor").value === "custom";
  const [width, height] = custom ? [$("sensor-width").valueAsNumber, $("sensor-height").valueAsNumber] : presets[$("sensor").value];
  const focal = $("focal").valueAsNumber;
  if (!$("focal").validity.valid || (custom && [$("sensor-width"), $("sensor-height")].some((field) => !field.validity.valid))) return null;
  if (![width, height, focal].every((value) => Number.isFinite(value) && value > 0)) return null;
  return { width, height, focal, angle: $("angle").valueAsNumber, sensor: $("sensor").value };
}

function restoreEquipment(equipment) {
  if (!equipment) return;
  $("sensor").value = Object.hasOwn(presets, equipment.sensor) ? equipment.sensor : "custom";
  $("sensor-width").value = equipment.width;
  $("sensor-height").value = equipment.height;
  $("focal").value = equipment.focal;
  $("angle").value = equipment.angle;
  updateFraming();
}

function toFrame(equipment, size) {
  return equipment ? cameraFrame(equipment.width, equipment.height, equipment.focal, equipment.angle, size) : null;
}

function frameSize(frame) {
  const fit = frame.target ? (frame.fits ? " · 대상이 프레임 안에 들어옵니다" : " · 대상 일부가 프레임 밖입니다") : "";
  return `가로 ${frame.width.toFixed(2)}° × 세로 ${frame.height.toFixed(2)}°${fit}`;
}

function updateFraming() {
  $("sensor-size").hidden = $("sensor").value !== "custom";
  $("rotation").textContent = `${$("angle").value}°`;
  const override = Boolean($("major").value || $("minor").value);
  const suppliedSize = [$("major").valueAsNumber, $("minor").valueAsNumber];
  const validSize = [$("major"), $("minor")].every((field) => field.value && field.validity.valid);
  const size = override ? (validSize ? suppliedSize : null) : apparentSize;
  const saved = gear.find(({ name }) => name === $("gear-select").value);
  const frame = toFrame(currentEquipment(), size);
  const comparison = toFrame(saved, size);
  drawCameraFrame($("framing"), frame, comparison);
  skyHits = drawSkyMap($("sky-map"), skyPoints, sky?.samples ?? [], target?.id, frame, comparison);
  $("frame-legend-compare").hidden = !comparison;
  $("gear-result").textContent = comparison ? `${saved.name} · ${saved.focal} mm · ${frameSize(comparison)}` : "";
  $("gear-load").disabled = $("gear-remove").disabled = !saved;
  $("frame-result").textContent = frame ? frameSize(frame)
    : "센서 크기와 초점거리에 0보다 큰 값을 입력하세요.";
  $("target-size").textContent = override && !validSize ? "장축과 단축을 모두 입력하세요."
    : size ? `대상 각크기 · 약 ${size[0].toFixed(2)}′ × ${size[1].toFixed(2)}′${target?.kind === "행성" && !override ? " (원반)" : ""}`
      : "각크기 자료가 없는 대상은 장축과 단축을 직접 입력할 수 있습니다.";
}

function renderGear(name = "") {
  $("gear-select").replaceChildren(new Option("비교 안 함", ""), ...gear.map(({ name }) => new Option(name, name)));
  $("gear-select").value = name;
  updateFraming();
}

function setEditing(record) {
  editingSession = record?.id;
  $("session-note").value = record?.note ?? "";
  $("session-new").hidden = !record;
  $("session-plan").textContent = record ? "계획 업데이트" : "계획 저장";
}

function renderSessions() {
  const list = $("session-list");
  list.replaceChildren();
  $("session-export").hidden = sessions.length === 0;
  for (const record of sessions) {
    const { id, day, site, name, time, note, status, equipment } = record;
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${status} · ${day} 밤 ${time} KST · ${SITES.find(({ id }) => id === site)?.name ?? site} · ${name}${equipment ? ` · ${equipment.focal} mm` : ""}`;
    item.append(title);
    if (note) {
      const text = document.createElement("p");
      text.className = "hint";
      text.textContent = note;
      item.append(text);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    for (const [action, label] of [["load", "불러오기"], ["remove", "삭제"]]) {
      const button = document.createElement("button");
      Object.assign(button, { type: "button", className: "plain", textContent: label });
      button.dataset[action] = id;
      actions.append(button);
    }
    item.append(actions);
    list.append(item);
  }
}

function saveSession(status) {
  const offset = $("scrub").valueAsNumber;
  const time = sky?.samples[offset]?.time;
  if (!target || !time) return;
  const record = {
    id: editingSession ?? crypto.randomUUID(), site: $("site").value, day: $("night").value,
    target: target.id, name: target.name, time: clock.format(time), offset,
    targetSize: [$("major").value, $("minor").value],
    equipment: currentEquipment(), note: $("session-note").value.trim(), status,
  };
  const next = [record, ...sessions.filter(({ id }) => id !== record.id)];
  if (!saveLocal(sessionsKey, next, "session-status")) return;
  sessions = next;
  setEditing(record);
  renderSessions();
  $("session-status").textContent = `${status}로 저장했습니다.`;
}

function exportSessions() {
  const cell = (value) => {
    const text = String(value ?? "");
    return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
  };
  const rows = [["상태", "관측일", "시각 (KST)", "관측지", "대상", "센서 가로 (mm)", "센서 세로 (mm)", "초점거리 (mm)", "회전 (°)", "메모"],
    ...sessions.map(({ status, day, time, site, name, equipment, note }) => [status, day, time,
      SITES.find(({ id }) => id === site)?.name ?? site, name, equipment?.width, equipment?.height, equipment?.focal, equipment?.angle, note])];
  const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map((row) => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "aaa-observations.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("search").addEventListener("input", () => updateSearch());
$("target").addEventListener("change", selectTarget);
for (const id of ["site", "night"]) $(id).addEventListener("input", updateSky);
$("scrub").addEventListener("input", updatePosition);
for (const id of ["sensor", "sensor-width", "sensor-height", "focal", "angle", "major", "minor"]) $(id).addEventListener("input", updateFraming);
$("sky-map").addEventListener("click", (event) => {
  const rect = $("sky-map").getBoundingClientRect();
  const x = (event.clientX - rect.left) * $("sky-map").width / rect.width;
  const y = (event.clientY - rect.top) * $("sky-map").height / rect.height;
  let nearest;
  let distance = 15;
  for (const point of skyHits) {
    const offset = Math.hypot(point.x - x, point.y - y);
    if (offset < distance) {
      nearest = point;
      distance = offset;
    }
  }
  if (!nearest) return;
  $("search").value = "";
  updateSearch(nearest.id);
});
$("gear-select").addEventListener("change", updateFraming);
$("gear-save").addEventListener("click", () => {
  const name = $("gear-name").value.trim();
  const equipment = currentEquipment();
  if (!name || !equipment) {
    $("gear-status").textContent = "장비 이름, 센서 크기와 초점거리를 확인하세요.";
    return;
  }
  const next = [...gear.filter((item) => item.name !== name), { ...equipment, name }];
  if (!saveLocal(gearKey, next, "gear-status")) return;
  gear = next;
  renderGear(name);
  $("gear-status").textContent = `${name} 장비를 저장했습니다.`;
});
$("gear-load").addEventListener("click", () => {
  const profile = gear.find(({ name }) => name === $("gear-select").value);
  if (!profile) return;
  $("gear-name").value = profile.name;
  restoreEquipment(profile);
  $("gear-status").textContent = `${profile.name} 장비를 불러왔습니다.`;
});
$("gear-remove").addEventListener("click", () => {
  const selected = $("gear-select").value;
  if (!selected || !confirm(`${selected} 장비를 삭제할까요?`)) return;
  const next = gear.filter(({ name }) => name !== selected);
  if (!saveLocal(gearKey, next, "gear-status")) return;
  gear = next;
  renderGear();
  $("gear-status").textContent = "장비를 삭제했습니다.";
});
$("session-plan").addEventListener("click", () => saveSession("계획"));
$("session-complete").addEventListener("click", () => saveSession("관측 완료"));
$("session-new").addEventListener("click", () => {
  setEditing();
  $("session-status").textContent = "새 기록을 작성합니다.";
});
$("session-list").addEventListener("click", ({ target: button }) => {
  const record = sessions.find(({ id }) => id === (button.dataset.load ?? button.dataset.remove));
  if (!record) return;
  if (button.dataset.load) {
    $("site").value = record.site;
    $("night").value = record.day;
    $("scrub").value = record.offset;
    $("search").value = "";
    $("major").value = "";
    $("minor").value = "";
    restoreEquipment(record.equipment);
    setEditing(record);
    updateSearch(record.target);
    const [major = "", minor = ""] = record.targetSize ?? [];
    $("major").value = major;
    $("minor").value = minor;
    updateFraming();
    $("session-status").textContent = "저장한 기록을 불러왔습니다.";
  } else if (confirm("이 관측 기록을 삭제할까요?")) {
    const next = sessions.filter(({ id }) => id !== record.id);
    if (!saveLocal(sessionsKey, next, "session-status")) return;
    sessions = next;
    if (record.id === editingSession) setEditing();
    renderSessions();
    $("session-status").textContent = "기록을 삭제했습니다.";
  }
});
$("session-export").addEventListener("click", exportSessions);
renderGear();
renderSessions();
updateSearch(query.get("target") ?? "M31");
