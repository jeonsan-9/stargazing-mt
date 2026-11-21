// 메시에 마라톤: 고른 관측지와 날짜에서 110개를 언제 볼 수 있는지 계산하고, 본 것을 체크한다.
import { MESSIER } from "./messier.js";
import { altAz } from "./targets.js";

const doneKey = "aaa.observe.messier.v1";
const MIN_ALT = 15;
const clock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" });
const $ = (id) => document.getElementById(id);

function readDone() {
  try {
    const saved = JSON.parse(localStorage.getItem(doneKey));
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}

let done = readDone(), windows = [], windowKey, state;

function saveDone() {
  try { localStorage.setItem(doneKey, JSON.stringify([...done])); } catch { /* 저장 불가: 화면 체크만 유지 */ }
}

// 해가 -12° 아래이고 대상이 15° 이상인 첫·마지막 시각
function nightWindows(samples, site) {
  const dark = samples.filter(({ sun }) => sun <= -12);
  return MESSIER.map(([number, ra, dec, mag, kind, , , name]) => {
    let start, end, peak = -90;
    for (const { time } of dark) {
      const { alt } = altAz(ra, dec, time, site.lat, site.lon);
      peak = Math.max(peak, alt);
      if (alt >= MIN_ALT) { start ??= time; end = time; }
    }
    return { number, ra, dec, mag, kind, name, start, end, peak };
  });
}

export function updateMarathon(samples, site, day, time) {
  if (!samples?.length || !site) return;
  const key = `${site.id}:${day}`;
  if (key !== windowKey) { windows = nightWindows(samples, site); windowKey = key; }
  state = { site, time };
  render();
}

function render() {
  if (!state) return;
  const { site, time } = state;
  const rows = windows.map((item) => ({ ...item, now: time ? altAz(item.ra, item.dec, time, site.lat, site.lon).alt : null }));
  const visible = rows.filter(({ start }) => start).length;
  $("marathon-progress").value = done.size;
  $("marathon-count").textContent = `본 것 ${done.size} / 110 · 오늘 밤 볼 수 있는 것 ${visible}개`;
  const sort = $("marathon-sort").value;
  const order = {
    // 일찍 지는 서쪽 대상부터. 밤새 못 보는 대상은 맨 뒤.
    night: (a, b) => (a.end ?? Infinity) - (b.end ?? Infinity) || a.number - b.number,
    number: (a, b) => a.number - b.number,
    high: (a, b) => (b.now ?? -90) - (a.now ?? -90),
  }[sort];
  const list = rows.filter(({ number }) => !$("marathon-left").checked || !done.has(number)).sort(order);
  $("marathon-list").replaceChildren(...list.map((item) => {
    const li = document.createElement("li");
    li.className = item.start ? "" : "unseen";
    const check = Object.assign(document.createElement("input"), { type: "checkbox", checked: done.has(item.number) });
    check.dataset.number = item.number;
    check.setAttribute("aria-label", `M${item.number} 봤음`);
    const pick = Object.assign(document.createElement("button"), { type: "button", className: "plain" });
    pick.dataset.pick = `M${item.number}`;
    pick.innerHTML = `<b>M${item.number}</b>${item.name ? ` ${item.name}` : ""}`;
    const meta = document.createElement("span");
    const when = item.start ? `${clock.format(item.start)}–${clock.format(item.end)}` : `오늘 밤 최고 ${Math.round(item.peak)}°`;
    const now = item.now != null ? ` · 지금 ${Math.round(item.now)}°` : "";
    meta.textContent = `${item.kind} · ${item.mag}등급 · ${when}${now}`;
    li.append(check, pick, meta);
    return li;
  }));
}

export function initMarathon(onPick) {
  $("marathon-sort").addEventListener("change", render);
  $("marathon-left").addEventListener("change", render);
  $("marathon-list").addEventListener("change", ({ target }) => {
    const number = Number(target.dataset.number);
    if (!number) return;
    if (target.checked) done.add(number); else done.delete(number);
    saveDone();
    render();
  });
  $("marathon-list").addEventListener("click", ({ target }) => {
    const id = target.closest("[data-pick]")?.dataset.pick;
    if (id) onPick(id);
  });
  $("marathon-reset").addEventListener("click", () => {
    if (!done.size || !confirm("체크한 메시에 기록을 모두 지울까요?")) return;
    done = new Set();
    saveDone();
    render();
  });
}
