// 字體大小調校：A− / A+，100%–400%，存 localStorage
const KEY = "ccw-font-scale";
const MIN = 1, MAX = 4, STEP = 0.25;
const isPhone = matchMedia("(pointer: coarse), (max-width: 820px), (max-height: 560px)").matches;
const DEF = isPhone ? 1.75 : 1;
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
function mount() {
  const tools = document.querySelector(".map-tools");
  if (!tools || document.getElementById("fs-ctl")) return;
  const box = document.createElement("div");
  box.id = "fs-ctl";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "字體大小");
  box.innerHTML = '<button type="button" id="fs-dn" aria-label="字細啲">字−</button><span id="fs-val"></span><button type="button" id="fs-up" aria-label="字大啲">字＋</button>';
  tools.prepend(box);
  box.querySelector("#fs-dn").onclick = () => set(s - STEP);
  box.querySelector("#fs-up").onclick = () => set(s + STEP);
  apply();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
