// 앱 설치(PWA), 오프라인 안내, 빨간 야간 모드, 공통 메뉴와 신고
// 모든 페이지에서 <script type="module" src="js/pwa.js"> 로 불러옵니다.
import { SITES } from "./sites.js";

const REPO = "jeonsan-9/stargazing-mt";
const PAGES = [
  ["index.html", "🗺️", "예보 지도", "이번 주·학기 관측 점수"],
  ["observe.html", "🔭", "관측 계획", "대상, 화각, 노출, 은하수"],
  ["sky.html", "🌌", "현장 하늘", "관측지에서 본 하늘, 폰으로 보기"],
  ["diorama.html", "🏔️", "디오라마", "한반도 입체 지도"],
];
const REPORTS = [
  ["site", "관측지 정보가 틀려요", "위치, 주차, 화장실, 가는 길 등"],
  ["closed", "폐쇄·출입 제한", "문이 잠겼거나 야간 출입 금지"],
  ["bug", "버그·화면 오류", "안 눌리거나 이상하게 보여요"],
  ["idea", "기능 제안", "이런 게 있으면 좋겠어요"],
];

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
  <button type="button" id="menuBtn" aria-haspopup="dialog" aria-controls="aaaSheet" title="메뉴 (M)"><span aria-hidden="true">☰</span> 메뉴</button>
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

// ---------- 공통 메뉴 시트와 신고 ----------
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const here = (location.pathname.split("/").pop() || "index.html");
const sheet = document.createElement("div");
sheet.id = "aaaSheet";
sheet.hidden = true;
let lastFocus;

function currentSite() {
  const fromPage = document.querySelector("select#site")?.value;
  return fromPage || new URLSearchParams(location.search).get("site") || "";
}

function pageHref(file) {
  // 페이지 안에 같은 곳으로 가는 링크가 있으면 그 링크(관측지·시각이 담김)를 그대로 씀
  const own = [...document.querySelectorAll("a[href]")].find((a) => !a.closest("#aaaSheet")
    && new URL(a.href, location.href).pathname.endsWith(`/${file}`) && !new URL(a.href, location.href).searchParams.has("map"));
  if (own) return own.getAttribute("href");
  const q = new URLSearchParams();
  const site = currentSite();
  if (site) q.set("site", site);
  return `./${file}${q.toString() ? `?${q}` : ""}`;
}

function menuHTML() {
  return `
    <div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
      <div class="sheet-head"><h2 id="sheetTitle">메뉴</h2><button type="button" class="sheet-x" aria-label="닫기">✕</button></div>
      <nav class="sheet-pages" aria-label="페이지">
        ${PAGES.map(([file, icon, name, sub]) => `<a href="${esc(pageHref(file))}"${file === here ? ' aria-current="page"' : ""}>
          <span class="ic" aria-hidden="true">${icon}</span><b>${name}</b><small>${sub}</small></a>`).join("")}
      </nav>
      <div class="sheet-row">
        <button type="button" data-act="night">${root.classList.contains("night-red") ? "🔴 야간 모드 끄기" : "🔴 빨간 야간 모드"}</button>
        ${bar.querySelector("#installBtn").hidden ? "" : '<button type="button" data-act="install">📲 앱으로 설치</button>'}
        <button type="button" data-act="report">📮 신고·제안하기</button>
      </div>
      <p class="sheet-foot">단축키 · N 야간 모드 · M 메뉴</p>
    </div>`;
}

function reportHTML({ kind, site = currentSite() } = {}) {
  const preset = REPORTS.findIndex(([id]) => id === kind);
  return `
    <form class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
      <div class="sheet-head"><h2 id="sheetTitle">신고·제안하기</h2><button type="button" class="sheet-x" aria-label="닫기">✕</button></div>
      <fieldset class="report-kinds"><legend>무엇을 알려 주실 건가요?</legend>
        ${REPORTS.map(([id, name, sub], i) => `<label><input type="radio" name="kind" value="${id}"${i === (preset >= 0 ? preset : here === "index.html" || here === "diorama.html" ? 0 : 2) ? " checked" : ""}>
          <span><b>${name}</b><small>${sub}</small></span></label>`).join("")}
      </fieldset>
      <label class="report-field">관측지<select name="site"><option value="">관측지와 관계없음</option>
        ${SITES.map(({ id, name, region }) => `<option value="${esc(id)}"${id === site ? " selected" : ""}>${esc(name)} · ${esc(region)}</option>`).join("")}</select></label>
      <label class="report-field">내용<textarea name="text" rows="4" maxlength="1200" required placeholder="예: 주차장 입구가 22시에 잠깁니다. (2026년 11월 확인)"></textarea></label>
      <p class="sheet-note">GitHub 이슈로 올라갑니다. 다음 화면에서 <b>Submit</b>을 눌러야 접수돼요. 페이지 주소와 브라우저 종류가 함께 적히고, 이름·연락처는 넣지 마세요.</p>
      <div class="sheet-row">
        <button type="submit" class="primary">GitHub에서 신고 열기</button>
        <button type="button" data-act="copy">내용 복사 (계정 없을 때)</button>
      </div>
      <p class="sheet-status" role="status"></p>
    </form>`;
}

function reportPayload(form) {
  const data = new FormData(form);
  const kind = REPORTS.find(([id]) => id === data.get("kind")) ?? REPORTS[2];
  const site = SITES.find(({ id }) => id === data.get("site"));
  const text = String(data.get("text") || "").trim();
  const title = `[${kind[1]}] ${site ? `${site.name} · ` : ""}${text.split("\n")[0].slice(0, 50)}`;
  const body = [
    `### 종류\n${kind[1]}`,
    site ? `### 관측지\n${site.name} (${site.region}) · \`${site.id}\` · ${site.lat}, ${site.lon}` : "",
    `### 내용\n${text}`,
    `### 환경\n- 페이지: ${location.href.split("#")[0]}\n- 브라우저: ${navigator.userAgent}\n- 화면: ${innerWidth}×${innerHeight}${standalone ? " · 설치한 앱" : ""}${root.classList.contains("night-red") ? " · 야간 모드" : ""}`,
  ].filter(Boolean).join("\n\n");
  return { title, body, label: { site: "site-info", closed: "site-info", bug: "bug", idea: "enhancement" }[kind[0]] };
}

function openSheet(kind = "menu", options) {
  lastFocus = document.activeElement;
  sheet.innerHTML = `<div class="sheet-backdrop"></div>${kind === "report" ? reportHTML(options) : menuHTML()}`;
  sheet.hidden = false;
  document.documentElement.classList.add("sheet-open");
  sheet.querySelector(".sheet-backdrop").onclick = closeSheet;
  sheet.querySelector(".sheet-x").onclick = closeSheet;
  sheet.querySelector('[data-act="night"]')?.addEventListener("click", () => { setNight(!root.classList.contains("night-red")); closeSheet(); });
  sheet.querySelector('[data-act="install"]')?.addEventListener("click", () => { closeSheet(); bar.querySelector("#installBtn").click(); });
  sheet.querySelector('[data-act="report"]')?.addEventListener("click", () => openSheet("report"));
  const form = sheet.querySelector("form");
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const { title, body, label } = reportPayload(form);
      const url = `https://github.com/${REPO}/issues/new?${new URLSearchParams({ title, body, labels: label })}`;
      window.open(url, "_blank", "noopener");
      form.querySelector(".sheet-status").textContent = "GitHub 창이 열렸어요. 로그인 후 Submit new issue를 누르면 끝!";
    };
    form.querySelector('[data-act="copy"]').onclick = async () => {
      if (!form.reportValidity()) return;
      const { title, body } = reportPayload(form);
      const status = form.querySelector(".sheet-status");
      try {
        await navigator.clipboard.writeText(`${title}\n\n${body}`);
        status.textContent = "복사했어요. 동아리 단톡방이나 관리자에게 붙여 넣어 보내 주세요.";
      } catch {
        status.textContent = "복사가 막혔어요. 내용을 길게 눌러 직접 복사해 주세요.";
      }
    };
  }
  (sheet.querySelector('[aria-current="page"]') ?? sheet.querySelector("input:checked, textarea, a, button"))?.focus();
}

function closeSheet() {
  sheet.hidden = true;
  sheet.innerHTML = "";
  document.documentElement.classList.remove("sheet-open");
  lastFocus?.focus?.();
}

sheet.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.stopPropagation(); closeSheet(); return; }
  if (e.key !== "Tab") return;
  // 시트 안에서만 초점이 돌게
  const items = [...sheet.querySelectorAll("a, button, input, select, textarea")].filter((el) => !el.disabled && el.offsetParent);
  const [first, last] = [items[0], items.at(-1)];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

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
  document.body.append(sheet, veil);
  bar.querySelector("#menuBtn").onclick = () => openSheet();
  if (location.hash === "#report") openSheet("report");
  // 페이지 어디서든 data-report 버튼으로 신고 시트를 엶 (예: 관측지 상세의 "정보 고치기")
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest?.("[data-report]");
    if (!trigger) return;
    e.preventDefault();
    openSheet("report", { kind: trigger.dataset.report, site: trigger.dataset.reportSite || undefined });
  });
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
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === "n" || e.key === "N") setNight(!root.classList.contains("night-red"));
    else if ((e.key === "m" || e.key === "M") && sheet.hidden) openSheet();
  });
}

// 첫 화면이 그려지기 전에 야간 모드를 적용해 번쩍임을 막음
if (read(KEY) === "1") root.classList.add("night-red");
if (document.body) mount();
else document.addEventListener("DOMContentLoaded", mount, { once: true });
