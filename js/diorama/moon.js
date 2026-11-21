const quarters = ["삭", "상현달", "보름달", "하현달"];
const betweenQuarters = ["초승달", "차는 볼록달", "기우는 볼록달", "그믐달"];

export function moonLighting(position, illumination) {
  // SunCalc's position angle is counterclockwise from the zenith after the parallactic correction.
  const limb = illumination.angle - position.parallacticAngle;
  const z = 2 * illumination.fraction - 1;
  const side = Math.sqrt(Math.max(0, 1 - z * z));
  const quarter = Math.round(illumination.phase * 4);
  const nearQuarter = Math.abs(illumination.phase - quarter / 4) <= 0.015;
  return {
    x: -Math.sin(limb) * side,
    y: -Math.cos(limb) * side,
    z,
    name: nearQuarter ? quarters[quarter % 4] : betweenQuarters[Math.floor(illumination.phase * 4) % 4],
  };
}
