// 휴대폰에서 예보 패널을 아래에서 끌어올리는 시트로, 지도 설정은 ⚙ 안으로 접어 지도가 넓게 보이게 함.
const root = document.documentElement;
const panel = document.getElementById("panel");
const handle = document.getElementById("sheet-handle");
const controls = document.getElementById("controls");
const more = document.getElementById("controls-more");
const KEY = "aaa-sheet-open";
const mobile = matchMedia("(max-width: 760px)");

function read() { try { return localStorage.getItem(KEY); } catch { return null; } }
function write(v) { try { localStorage.setItem(KEY, v); } catch {} }

function setOpen(open, remember = true) {
  root.classList.toggle("sheet-peek", !open);
  handle.setAttribute("aria-expanded", String(open));
  handle.querySelector(".label").textContent = open ? "예보 접기" : "예보 펼치기";
  if (open) panel.scrollTop = 0;
  if (remember) write(open ? "1" : "0");
}

// 처음엔 접힌 채로(지도 먼저). 한 번 펼쳐 둔 사람은 펼친 채로 기억.
setOpen(read() === "1", false);
handle.addEventListener("click", () => setOpen(root.classList.contains("sheet-peek")));
// 접힌 상태에서 주·월·학기·1년 탭을 누르면 바로 펼침
document.getElementById("tabs").addEventListener("click", () => { if (mobile.matches) setOpen(true); });

// 손잡이를 위아래로 끌어서 열고 닫기
let startY;
handle.addEventListener("pointerdown", (e) => { startY = e.clientY; });
handle.addEventListener("pointerup", (e) => {
  if (startY == null) return;
  const dy = e.clientY - startY;
  startY = undefined;
  if (Math.abs(dy) < 24) return;
  e.preventDefault();
  setOpen(dy < 0);
  handle.dataset.dragged = "1";
});
handle.addEventListener("click", (e) => {
  if (handle.dataset.dragged) { delete handle.dataset.dragged; e.stopImmediatePropagation(); }
}, true);

more.addEventListener("click", () => {
  const open = !root.classList.contains("controls-more");
  root.classList.toggle("controls-more", open);
  more.setAttribute("aria-expanded", String(open));
});

// 아래 조작판 높이만큼 시트를 띄움
new ResizeObserver(() => {
  root.style.setProperty("--controls-h", `${Math.ceil(controls.getBoundingClientRect().height)}px`);
}).observe(controls);
