const RAD = Math.PI / 180;

function project(alt, az, x, y, radius) {
  const distance = radius * (1 - alt / 90);
  return [x + Math.sin(az * RAD) * distance, y - Math.cos(az * RAD) * distance];
}

function traceFrame(ctx, { alt, az }, frame, x, y, radius, color) {
  const a = alt * RAD, b = az * RAD;
  const center = [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
  const east = [Math.cos(b), 0, -Math.sin(b)];
  const up = [-Math.sin(a) * Math.sin(b), Math.cos(a), -Math.sin(a) * Math.cos(b)];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const cos = Math.cos(frame.rotation), sin = -Math.sin(frame.rotation);
  ctx.beginPath();
  for (const [index, start] of corners.entries()) {
    const end = corners[(index + 1) % corners.length];
    for (let step = 0; step < 12; step++) {
      const t = step / 12;
      const u = (start[0] + t * (end[0] - start[0])) * frame.halfWidth;
      const v = (start[1] + t * (end[1] - start[1])) * frame.halfHeight;
      const look = center.map((c, i) => c + east[i] * (u * cos - v * sin) + up[i] * (u * sin + v * cos));
      const elevation = Math.atan2(look[1], Math.hypot(look[0], look[2])) / RAD;
      const bearing = Math.atan2(look[0], look[2]) / RAD;
      const point = project(elevation, bearing, x, y, radius);
      if (index === 0 && step === 0) ctx.moveTo(...point);
      else ctx.lineTo(...point);
    }
  }
  ctx.closePath();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = color;
  ctx.stroke();
}

export function drawSkyMap(canvas, points, track, selected, frame, comparison) {
  const ctx = canvas.getContext("2d");
  const x = canvas.width / 2, y = canvas.height / 2;
  const radius = Math.min(x, y) - 38;
  const hits = [];
  ctx.fillStyle = "#211f38";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "17px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#615a7c";
  ctx.lineWidth = 1;
  for (const alt of [0, 30, 60]) {
    ctx.beginPath();
    ctx.arc(x, y, radius * (1 - alt / 90), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x - radius, y); ctx.lineTo(x + radius, y);
  ctx.moveTo(x, y - radius); ctx.lineTo(x, y + radius);
  ctx.stroke();
  ctx.fillStyle = "#e4d4f2";
  for (const [index, label] of ["북", "동", "남", "서"].entries()) {
    ctx.fillText(label, ...project(-10, index * 90, x, y, radius));
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  let visible = false;
  for (const { target: alt, targetAz: az } of track) {
    if (alt < 0 || !Number.isFinite(az)) {
      visible = false;
      continue;
    }
    const point = project(alt, az, x, y, radius);
    if (visible) ctx.lineTo(...point);
    else ctx.moveTo(...point);
    visible = true;
  }
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "#a4e0ca";
  ctx.stroke();
  ctx.setLineDash([]);
  const aim = points.find(({ id, alt }) => id === selected && alt >= 0);
  if (aim && comparison) traceFrame(ctx, aim, comparison, x, y, radius, "#c9a3f1");
  if (aim && frame) traceFrame(ctx, aim, frame, x, y, radius, "#ffd99e");
  for (const { id, name, alt, az, kind } of points) {
    if (alt < 0) continue;
    const [sx, sy] = project(alt, az, x, y, radius);
    const chosen = id === selected;
    ctx.fillStyle = id === "moon" ? "#ffeac0" : chosen ? "#a4e0ca" : "#c8c3e3";
    ctx.beginPath();
    ctx.arc(sx, sy, chosen || id === "moon" ? 5 : 2.7, 0, Math.PI * 2);
    ctx.fill();
    if (chosen || id === "moon" || kind === "행성") {
      ctx.textAlign = sx > x + 40 ? "right" : "left";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(name, sx + (sx > x + 40 ? -8 : 8), sy - 9);
    }
    hits.push({ id, x: sx, y: sy });
  }
  ctx.restore();
  return hits;
}
