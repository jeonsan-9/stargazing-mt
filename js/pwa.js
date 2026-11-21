// 앱 설치(PWA), 오프라인 안내, 빨간 야간 모드
// 모든 페이지에서 <script type="module" src="js/pwa.js"> 로 불러옵니다.

const KEY = "aaa-night-red";
const root = document.documentElement;

function read(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function write(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {}
}

// ---------- 서비스 워커 ----------
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("오프라인 저장 꺼짐", e));
  });
  // 홈 화면에 설치한 경우 저장본을 지우지 않도록 요청 (브라우저가 판단)
  navigator.storage?.persist?.().catch(() => {});
}

// ---------- 빨간 야간 모드 ----------
const veil = document.createElement("div");
veil.id = "nightVeil";
veil.setAttribute("aria-hidden", "true");

const bar = document.createElement("div");
bar.id = "pwaBar";
bar.innerHTML = `
  <button type="button" id="nightBtn" aria-pressed="false" title="빨간 야간 모드 (N)">
    <span class="dot" aria-hidden="true"></span><span class="label">야간</span>
  </button>
  <button type="button" id="installBtn" hidden>앱 설치</button>
  <span id="netBadge" role="status" hidden>오프라인 · 저장본</span>
`;

const themeMeta = document.querySelector('meta[name="theme-color"]');
const dayTheme = themeMeta?.content || "#484756";

function setNight(on) {
  root.classList.toggle("night-red", on);
  const btn = bar.querySelector("#nightBtn");
  btn.setAttribute("aria-pressed", String(on));
  btn.querySelector(".label").textContent = on ? "야간 켬" : "야간";
  if (themeMeta) themeMeta.content = on ? "#000000" : dayTheme;
  write(KEY, on ? "1" : null);
}

// ---------- 설치 버튼 ----------
let deferred = null;
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  bar.querySelector("#installBtn").hidden = false;
});
window.addEventListener("appinstalled", () => {
  bar.querySelector("#installBtn").hidden = true;
});

function iosTip() {
  let tip = document.getElementById("iosTip");
  if (tip) { tip.remove(); return; }
  tip = document.createElement("div");
  tip.id = "iosTip";
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-label", "아이폰에 설치하는 방법");
  tip.innerHTML = `<b>아이폰에 설치</b><br>Safari 아래쪽 <span class="share">공유</span> 버튼 → <b>홈 화면에 추가</b><br><small>설치하면 산에서 신호가 약해도 마지막 예보와 하늘 지도를 볼 수 있어요.</small><button type="button" aria-label="닫기">닫기</button>`;
  tip.querySelector("button").onclick = () => tip.remove();
  document.body.append(tip);
}

// ---------- 오프라인 표시 ----------
function net() {
  bar.querySelector("#netBadge").hidden = navigator.onLine;
}

function mount() {
  const slot = document.querySelector("[data-pwa-slot]");
  if (slot) {
    bar.classList.add("inline");
    slot.replaceWith(bar);
  }
  document.body.append(veil);
  if (!slot) document.body.append(bar);
  bar.querySelector("#nightBtn").onclick = () => setNight(!root.classList.contains("night-red"));
  const install = bar.querySelector("#installBtn");
  install.onclick = async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      install.hidden = true;
    } else if (isIOS) {
      iosTip();
    }
  };
  if (isIOS && !standalone) install.hidden = false;
  setNight(read(KEY) === "1");
  net();
  addEventListener("online", net);
  addEventListener("offline", net);
  addEventListener("keydown", (e) => {
    if (e.key !== "n" && e.key !== "N") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    setNight(!root.classList.contains("night-red"));
  });
}

// 첫 화면이 그려지기 전에 야간 모드를 적용해 번쩍임을 막음
if (read(KEY) === "1") root.classList.add("night-red");
if (document.body) mount();
else document.addEventListener("DOMContentLoaded", mount, { once: true });
