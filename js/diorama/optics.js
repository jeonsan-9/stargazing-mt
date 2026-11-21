const DEG = Math.PI / 180;

export function cameraFrame(sensorWidth, sensorHeight, focalLength, angle, targetSize) {
  if (![sensorWidth, sensorHeight, focalLength].every((n) => Number.isFinite(n) && n > 0)
      || !Number.isFinite(angle)) return null;
  const halfWidth = sensorWidth / (2 * focalLength);
  const halfHeight = sensorHeight / (2 * focalLength);
  const rotation = angle * DEG;
  const cx = Math.cos(rotation), sx = Math.sin(rotation);
  const target = targetSize?.length === 2 && targetSize.every((n) => Number.isFinite(n) && n > 0 && n < 10800)
    ? targetSize.map((arcmin) => Math.tan((arcmin / 120) * DEG)) : null;
  const fits = target && Math.hypot(target[0] * cx, target[1] * sx) <= halfWidth
    && Math.hypot(target[0] * sx, target[1] * cx) <= halfHeight;
  return { halfWidth, halfHeight, rotation, target, fits,
    width: 2 * Math.atan(halfWidth) / DEG, height: 2 * Math.atan(halfHeight) / DEG };
}

export function drawCameraFrame(canvas, frame) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.fillStyle = "#211f38";
  ctx.fillRect(0, 0, width, height);
  if (!frame) return;
  const { halfWidth, halfHeight, rotation, target } = frame;
  const cx = Math.abs(Math.cos(rotation)), sx = Math.abs(Math.sin(rotation));
  const boundX = Math.max(halfWidth * cx + halfHeight * sx, target?.[0] ?? 0);
  const boundY = Math.max(halfWidth * sx + halfHeight * cx, target?.[1] ?? 0);
  const scale = Math.min((width - 78) / (2 * boundX), (height - 58) / (2 * boundY));
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.strokeStyle = "#645b7b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-width / 2, 0); ctx.lineTo(width / 2, 0);
  ctx.moveTo(0, -height / 2); ctx.lineTo(0, height / 2);
  ctx.stroke();
  if (target) {
    ctx.fillStyle = "#94d2bb35";
    ctx.strokeStyle = "#a5dfca";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, target[0] * scale, target[1] * scale, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  ctx.rotate(rotation);
  ctx.strokeStyle = "#ffd99e";
  ctx.lineWidth = 3;
  ctx.strokeRect(-halfWidth * scale, -halfHeight * scale, 2 * halfWidth * scale, 2 * halfHeight * scale);
  ctx.restore();
}
