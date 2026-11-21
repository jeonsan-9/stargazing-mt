/* global SunCalc */
import { parseLocal } from "../score.js";

const FIVE_MINUTES = 5 * 60_000;
const TO_DEGREES = 180 / Math.PI;
const labels = ["18시", "21시", "0시", "3시", "6시"];

export function nightSky(day, { lat, lon }) {
  const start = +parseLocal(`${day}T18:00`);
  const samples = Array.from({ length: 145 }, (_, i) => {
    const time = new Date(start + i * FIVE_MINUTES);
    return {
      time,
      sun: SunCalc.getPosition(time, lat, lon).altitude * TO_DEGREES,
      moon: SunCalc.getMoonPosition(time, lat, lon).altitude * TO_DEGREES,
    };
  });
  const moonless = [];
  let open;
  for (const { time, sun, moon } of samples) {
    if (sun <= -18 && moon <= 0) open ??= time;
    else if (open) { moonless.push([open, time]); open = undefined; }
  }
  if (open && open < samples.at(-1).time) moonless.push([open, samples.at(-1).time]);
  return { start, end: +samples.at(-1).time, samples, moonless };
}

export function drawNightSky(canvas, sky, time) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const left = 52, right = w - 24, top = 22, bottom = h - 36;
  const x = (t) => left + ((t - sky.start) / (sky.end - sky.start)) * (right - left);
  const y = (altitude) => top + (90 - altitude) / 180 * (bottom - top);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#252640";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#373b58";
  for (const [from, to] of sky.moonless) ctx.fillRect(x(from), top, x(to) - x(from), bottom - top);
  ctx.font = "21px sans-serif";
  ctx.fillStyle = "#e3dcef";
  ctx.strokeStyle = "#777b96";
  ctx.lineWidth = 1;
  for (const altitude of [60, 0, -60]) {
    ctx.beginPath();
    ctx.moveTo(left, y(altitude));
    ctx.lineTo(right, y(altitude));
    ctx.stroke();
    ctx.fillText(`${altitude}°`, 5, y(altitude) + 6);
  }
  labels.forEach((label, i) => ctx.fillText(label, left - 15 + i * (right - left) / 4, h - 11));
  ctx.lineWidth = 4;
  const lines = [["sun", "#efa394"], ["moon", "#ffeac0"]];
  if (sky.samples[0].target != null) lines.push(["target", "#a4e0ca"]);
  for (const [body, color] of lines) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [i, sample] of sky.samples.entries()) {
      if (i === 0) ctx.moveTo(x(sample.time), y(sample[body]));
      else ctx.lineTo(x(sample.time), y(sample[body]));
    }
    ctx.stroke();
  }
  if (+time >= sky.start && +time <= sky.end) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#dcd9f4";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x(time), top);
    ctx.lineTo(x(time), bottom);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
