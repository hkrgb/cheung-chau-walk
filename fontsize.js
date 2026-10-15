// 字體大小調校：A− / A+，100%–400%，存 localStorage
const KEY = "ccw-font-scale-v2"; // 新 key：所有人由 150% 開始
const MIN = 1, MAX = 4, STEP = 0.25;
const isPhone = matchMedia("(pointer: coarse), (max-width: 820px), (max-height: 560px)").matches;
const DEF = 1.5;
let s = parseFloat(localStorage.getItem(KEY));
if (!(s >= MIN && s <= MAX)) s = DEF;
function apply() {
  document.documentElement.style.setProperty("--fs", String(s));
  document.documentElement.dataset.fs = "1";
  const lbl = document.getElementById("fs-val");
  if (lbl) lbl.textContent = Math.round(s * 100) + "%";
}
apply();
function set(v) { s = Math.min(MAX, Math.max(MIN, Math.round(v / STEP) * STEP)); localStorage.setItem(KEY, String(s)); apply(); }
function place() {
  const bar = document.getElementById("topbar"), tools = document.querySelector(".map-tools");
  if (!bar) return;
  const br = bar.getBoundingClientRect();
  const st = document.getElementById("stack");
  if (st) {
    st.style.removeProperty("--bar-pad");
    const r = st.getBoundingClientRect();
    const overlaps = r.width && r.left < br.right && r.top < br.bottom + 4;
    if (overlaps) st.style.setProperty("--bar-pad", Math.ceil(br.bottom - Math.max(r.top, 0) + 6) + "px");
  }
  if (tools) { tools.style.setProperty("left", br.left + "px", "important"); tools.style.setProperty("top", (br.bottom + 6) + "px", "important"); }
}
function mount() {
  const tools = document.querySelector(".map-tools");
  if (!tools || document.getElementById("topbar")) return;
  const bar = document.createElement("div");
  bar.id = "topbar";
  bar.innerHTML = '<button type="button" id="menu-btn" aria-label="選單" aria-expanded="false">☰</button>' +
    '<div id="fs-ctl" role="group" aria-label="字體大小"><button type="button" id="fs-dn" aria-label="字細啲">字−</button><span id="fs-val"></span><button type="button" id="fs-up" aria-label="字大啲">字＋</button></div>';
  document.body.appendChild(bar);
  const rf = document.createElement("button");
  rf.id = "reload-btn"; rf.type = "button"; rf.title = "重新載入"; rf.setAttribute("aria-label", "重新載入"); rf.textContent = "↻";
  rf.onclick = () => location.reload();
  document.body.appendChild(rf);
  bar.querySelector("#fs-dn").onclick = () => { set(s - STEP); place(); };
  bar.querySelector("#fs-up").onclick = () => { set(s + STEP); place(); };
  const mb = bar.querySelector("#menu-btn");
  const setOpen = (o) => { tools.classList.toggle("open", o); mb.setAttribute("aria-expanded", o ? "true" : "false"); if (o) place(); };
  mb.onclick = (e) => { e.stopPropagation(); setOpen(!tools.classList.contains("open")); };
  tools.addEventListener("click", (e) => { if (e.target.closest(".map-tools > button")) setTimeout(() => setOpen(false), 0); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".map-tools") && !e.target.closest("#topbar")) setOpen(false); });
  addEventListener("resize", place);
  const st = document.getElementById("stack");
  if (st && window.ResizeObserver) new ResizeObserver(place).observe(st);
  if (st) new MutationObserver(() => setTimeout(place, 350)).observe(st, { attributes: true });
  apply(); place(); setTimeout(place, 500);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
