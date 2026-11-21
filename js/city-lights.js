const key = "aaa-city-lights";
export function cityLightsEnabled() {
  try { return sessionStorage.getItem(key) !== "off"; } catch { return true; }
}
export function rememberCityLights(enabled) {
  try { sessionStorage.setItem(key, enabled ? "on" : "off"); } catch { /* Private browsing. */ }
}
