/* global SunCalc */
import { SITES } from "./sites.js";
import { altAz, observeTarget, observingTargets } from "./targets.js";
import { addDays, ymd } from "./score.js";
import { moonLighting } from "./diorama/moon.js";

const $ = (id) => document.getElementById(id);
const canvas = $("view"), ctx = canvas.getContext("2d");
const params = new URLSearchParams(location.search);
const RAD = Math.PI / 180;
const directions = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const bearings = (az) => ((az % 360) + 360) % 360;
const direction = (az) => directions[Math.round(bearings(az) / 45) % 8];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" });
const names = {11767: "북극성", 91262: "베가", 69673: "아르크투루스", 32349: "시리우스", 27989: "베텔게우스",
  24436: "리겔", 97649: "알타이르", 102098: "데네브", 80763: "안타레스", 24608: "카펠라", 21421: "알데바란",
  37279: "프로키온", 113368: "포말하우트", 49669: "레굴루스", 65474: "스피카", 37826: "폴룩스"};
const planets = observingTargets.filter(({ kind, id }) => kind === "행성" && id !== "uranus" && id !== "neptune");
let azimuth = 180, tilt = 20, focal, width, height, frame, scene, pointer;
let catalog = [], horizons = {};

$("site").replaceChildren(...SITES.map(({ id, name }) => new Option(name, id)));
$("site").value = SITES.some(({ id }) => id === params.get("site")) ? params.get("site") : "bohyeon_obs";
const requested = new Date(params.get("t") || "");
const initial = Number.isFinite(+requested) ? requested : new Date();
const todayNight = ymd(new Date(+initial - 6 * 3600e3));
$("night").value = params.get("day") ?? todayNight;
if (!$("night").validity.valid) $("night").value = todayNight;
const startTime = () => new Date(`${$("night").value}T18:00:00+09:00`);
const minuteOffset = Math.round((initial - startTime()) / 300000);
if (minuteOffset >= 0 && minuteOffset <= 144) $("minute").value = minuteOffset;

function ridgeAt(ridge, az) {
  if (!ridge) return 0;
  const bearing = bearings(az), index = Math.floor(bearing), f = bearing - index;
  return (1 - f) * ridge[index] + f * ridge[(index + 1) % 360];
}

function updateTime() {
  if (!$("night").validity.valid) {
    $("status").textContent = "관측 날짜를 선택하세요.";
    return;
  }
  const site = SITES.find(({ id }) => id === $("site").value);
  const time = new Date(+startTime() + $("minute").valueAsNumber * 300000);
  const { ridge, elevation } = horizons[site.id] ?? {};
  const moonPosition = SunCalc.getMoonPosition(time, site.lat, site.lon);
  const moon = { alt: moonPosition.altitude / RAD, az: bearings(moonPosition.azimuth / RAD + 180) };
  const sunlight = SunCalc.getPosition(time, site.lat, site.lon).altitude / RAD;
  const phase = SunCalc.getMoonIllumination(time);
  const moonPhase = moonLighting(moonPosition, phase);
  const stars = catalog.map(([id, ra, dec, mag, bv]) => ({ name: names[id], mag, bv, ...altAz(ra / 15, dec, time, site.lat, site.lon) }));
  const marker = planets.map((planet) => ({ name: planet.name, ...observeTarget(planet, time, site) }));
  scene = { ridge, moon, moonPhase, phase, sunlight, stars, marker };
  $("site-name").textContent = site.name;
  $("site-elevation").textContent = elevation == null ? site.region : `${site.region} · 해발 약 ${elevation.toLocaleString("ko-KR")}m`;
  $("time").textContent = `${clock.format(time)} KST${ymd(time) !== $("night").value ? " · 다음 날" : ""}`;
  $("minute").setAttribute("aria-valuetext", $("time").textContent);
  const obstruction = moon.alt < 0 ? " · 지평선 아래" : moon.alt <= ridgeAt(ridge, moon.az) ? " · 산 너머" : "";
  $("status").textContent = `달 · ${moonPhase.name} ${Math.round(phase.fraction * 100)}% · ${direction(moon.az)} ${Math.round(moon.az) % 360}° · 고도 ${Math.round(moon.alt)}°${obstruction}`;
  const link = new URLSearchParams({ site: site.id, day: $("night").value });
  const from = params.get("from");
  const plannerParams = new URLSearchParams(link);
  plannerParams.set("t", time.toISOString());
  $("plan").href = `./observe.html?${plannerParams}`;
  if (from === "wide") link.set("t", time.toISOString());
  if (from === "terrain") link.set("map", "terrain");
  $("back").href = `./${from === "wide" ? "diorama" : "index"}.html?${link}`;
  requestDraw();
}

function drawMoon(x, y, radius, light) {
  const glow = ctx.createRadialGradient(x, y, radius / 3, x, y, radius * 4.7);
  glow.addColorStop(0, "#e8cac450");
  glow.addColorStop(1, "#a598cf00");
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius * 4.7, y - radius * 4.7, radius * 9.4, radius * 9.4);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(light.y, light.x));
  ctx.fillStyle = "#463e5d";
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff0c8";
  ctx.beginPath(); ctx.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);
  for (let i = 1; i <= 25; i++) {
    const v = 1 - i / 12.5;
    ctx.lineTo(-light.z * radius * Math.sqrt(Math.max(0, 1 - v * v)), radius * v);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function draw() {
  frame = undefined;
  if (!scene || !focal) return;
  const { ridge, moon, moonPhase, phase, sunlight, stars, marker } = scene;
  const sin = Math.sin(tilt * RAD), cos = Math.cos(tilt * RAD);
  const project = (alt, az) => {
    const a = alt * RAD, diff = (az - azimuth) * RAD;
    const near = Math.cos(diff) * Math.cos(a), vertical = Math.sin(a);
    const depth = near * cos + vertical * sin;
    if (depth <= 0.04) return null;
    return [width / 2 + focal * Math.sin(diff) * Math.cos(a) / depth,
      height / 2 - focal * (vertical * cos - near * sin) / depth];
  };
  const night = clamp((-sunlight - 2) / 16, 0, 1);
  const moonGlow = moon.alt > ridgeAt(ridge, moon.az) ? phase.fraction : 0;
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, `hsl(${224 + 11 * night} 52% ${57 - 44 * night}%)`);
  sky.addColorStop(0.52, `hsl(${230 + 10 * night} 36% ${60 - 37 * night + moonGlow * 3}%)`);
  sky.addColorStop(1, `hsl(${24 + 248 * night} 26% ${71 - 44 * night + moonGlow * 7}%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const labels = [];
  for (const { alt, az, name, mag, bv } of stars) {
    if (night <= 0.15 || alt <= Math.max(0, ridgeAt(ridge, az))) continue;
    const point = project(alt, az);
    if (!point) continue;
    const [x, y] = point;
    if (x < -4 || x > width + 4 || y < -4 || y > height + 4) continue;
    const warm = Number(bv);
    const bright = clamp((6.4 - mag) / 6, 0.09, 1);
    const opacity = bright * night * (1 - moonGlow * (mag > 3 ? 0.38 : 0.12)) * clamp(0.46 + alt / 40, 0.46, 1);
    ctx.fillStyle = warm > 0.95 ? `rgba(255,219,169,${opacity})` : `rgba(214,231,255,${opacity})`;
    ctx.beginPath(); ctx.arc(x, y, 0.4 + 1.55 * bright, 0, Math.PI * 2); ctx.fill();
    if (name && night > 0.8) labels.push([name, x + 6, y - 7]);
  }
  for (const item of marker) {
    if (sunlight > -5 || item.alt <= ridgeAt(ridge, item.az)) continue;
    const point = project(item.alt, item.az);
    if (!point) continue;
    ctx.fillStyle = "#ffdfb1";
    ctx.beginPath(); ctx.arc(...point, 2.7, 0, Math.PI * 2); ctx.fill();
    labels.push([item.name, point[0] + 7, point[1] - 7]);
  }
  const onScreenMoon = project(moon.alt, moon.az);
  if (onScreenMoon && moon.alt > ridgeAt(ridge, moon.az)) {
    const r = clamp(focal * 0.016, 5, 15);
    drawMoon(...onScreenMoon, r, moonPhase);
    labels.push(["달", onScreenMoon[0] + r + 7, onScreenMoon[1]]);
  }
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillStyle = "#eedff0";
  for (const [label, x, y] of labels) ctx.fillText(label, x, y);

  const silhouettes = [];
  for (let d = -100; d <= 100; d += 1) {
    const az = azimuth + d;
    const point = project(ridgeAt(ridge, az), az);
    if (point) silhouettes.push([clamp(point[0], -width, width * 2), clamp(point[1], -height, height * 3)]);
  }
  const land = ctx.createLinearGradient(0, height * 0.56, 0, height);
  land.addColorStop(0, `hsl(${237 - 67 * (1 - night)} 28% ${31 - 9 * night}%)`);
  land.addColorStop(1, "#111522");
  if (silhouettes.length) {
    ctx.beginPath(); ctx.moveTo(...silhouettes[0]);
    for (const point of silhouettes.slice(1)) ctx.lineTo(...point);
    ctx.lineTo(width * 2, height * 3); ctx.lineTo(-width, height * 3); ctx.closePath();
    ctx.fillStyle = land; ctx.fill();
    ctx.strokeStyle = night > 0.5 ? "#bfb7e346" : "#f6e2b441";
    ctx.lineWidth = 1.4; ctx.stroke();
    ctx.save(); ctx.clip();
    for (const [i, color] of ["#443c6540", "#171c36a3"].entries()) {
      ctx.beginPath();
      let first = true;
      for (let d = -84; d <= 84; d += 7) {
        const az = azimuth + d;
        const base = ridgeAt(ridge, az);
        const low = base - 3.5 - i * 5.6 - 3.2 * Math.abs(Math.sin((az + i * 48) * RAD * 4));
        const point = project(low, az);
        if (!point) continue;
        if (first) ctx.moveTo(...point);
        else ctx.lineTo(...point);
        first = false;
      }
      if (first) continue;
      ctx.lineTo(width * 2, height * 3); ctx.lineTo(-width, height * 3); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    }
    ctx.restore();
  }
  ctx.fillStyle = "#f5dfbb";
  ctx.textAlign = "center";
  for (let az = 0; az < 360; az += 45) {
    const point = project(Math.max(0, ridgeAt(ridge, az)) + 2.7, az);
    if (point) ctx.fillText(direction(az), ...point);
  }
  ctx.textAlign = "start";
  $("bearing").textContent = `${direction(azimuth)} ${Math.round(bearings(azimuth)) % 360}° · 고도 ${Math.round(tilt)}°`;
}

function requestDraw() {
  if (frame == null) frame = requestAnimationFrame(draw);
}

function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  focal = Math.min(height * 0.85, width * 0.78);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  requestDraw();
}

function look(az, alt) {
  azimuth = bearings(az);
  tilt = clamp(alt, -12, 88);
  requestDraw();
}

canvas.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary) return;
  pointer = [event.clientX, event.clientY];
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointer || !event.isPrimary) return;
  const [x, y] = pointer;
  look(azimuth - (event.clientX - x) / focal / RAD, tilt + (event.clientY - y) / focal / RAD);
  pointer = [event.clientX, event.clientY];
});
canvas.addEventListener("lostpointercapture", () => { pointer = undefined; });
canvas.addEventListener("keydown", (event) => {
  const steps = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
  const step = steps[event.key];
  if (!step) return;
  event.preventDefault();
  look(azimuth + step[0], tilt + step[1]);
});
for (const button of document.querySelectorAll("[data-bearing]")) button.addEventListener("click", () => look(+button.dataset.bearing, 20));
$("look-moon").addEventListener("click", () => {
  if (scene) look(scene.moon.az, Math.max(12, scene.moon.alt));
});
for (const id of ["site", "night", "minute"]) $(id).addEventListener("input", updateTime);
window.addEventListener("resize", resize);
resize();
updateTime();

function loadData(name) {
  return fetch(new URL(`./diorama/${name}.json`, import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(name);
    return response.json();
  });
}

const [starData, terrainData] = await Promise.allSettled([loadData("stars"), loadData("horizons")]);
if (starData.status === "fulfilled") catalog = starData.value;
if (terrainData.status === "fulfilled") horizons = terrainData.value;
updateTime();
if (starData.status === "rejected" || terrainData.status === "rejected") $("site-elevation").textContent += " · 일부 하늘 자료를 읽지 못했습니다.";
