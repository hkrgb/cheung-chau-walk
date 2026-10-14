/* 長洲足印：檢視頁
   index.html            → 預設載入 Firebase DEFAULT_MAP_ID（長洲足印）
   index.html?map=<id>   → 指定 Firestore 地圖
   內置 routes-data.js 已清空，路線以 Firebase 為單一來源。 */

import { BUILTIN_SITE } from "./routes-data.js";
import { initFerry } from "./ferry.js";
import { initServices, applyServices } from "./poi.js";
import { initSaved } from "./saved.js";
import {
  tiles, detectProxy, createMap, enableTerrain as addTerrain, routeCoords, setRouteLine,
  clearRouteLine, esc, safeColor
} from "./map-core.js";

const routesEl = document.getElementById("routes");
const detailEl = document.getElementById("detail");
const statusEl = document.getElementById("status");
const appEl = document.getElementById("app");
const sheetEl = document.getElementById("stack");
const sheetBody = document.getElementById("sheet-body");
const chipsEl = document.getElementById("chips");
const mstopsEl = document.getElementById("mstops");
const handleEl = document.getElementById("sheet-handle");
const mastEl = document.getElementById("mast");
const closeBtn = document.getElementById("detail-close");
const gateEl = document.getElementById("gate");

/* 與 styles.css 的手機斷點一致 */
const MOBILE_MQ = window.matchMedia("(max-width: 820px), (max-height: 520px) and (orientation: landscape) and (max-width: 1024px)");
const LANDSCAPE_MQ = window.matchMedia("(max-height: 520px) and (orientation: landscape) and (max-width: 1024px)");
const isMobile = () => MOBILE_MQ.matches;
const isLandscapeMobile = () => LANDSCAPE_MQ.matches;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const DEFAULT_MAP_ID = "cheung-chau-footprints";

let site = BUILTIN_SITE;
let HOME = site.home;
let ROUTES = site.routes;

let navControl = null;
let attribControl = null;
let sheetState = "collapsed";

let map;
let markers = [];
let activeRoute = null;
let activeStop = -1;
let styleReady = false;

function showStatus(message) {
  statusEl.hidden = !message;
  statusEl.textContent = message || "";
}

function formatCoord(stop) {
  return `約 ${stop.lat.toFixed(4)}°N，${stop.lng.toFixed(4)}°E`;
}

const shortDuration = (route) => String(route.duration || "").replace(/（.*）/, "");
const routeFacts = (route) => [route.area, route.duration, route.stops.length + " 站"].filter(Boolean).join(" · ");
const thumbHtml = (stop) => stop.photo ? `<img class="stop-thumb" src="${esc(stop.photo.src)}" alt="" loading="lazy" />` : "";

/* 刊頭：內置版本與老師地圖共用 */
function renderMast() {
  document.getElementById("mast-seal").textContent = site.seal;
  document.getElementById("mast-eyebrow").textContent = site.eyebrow;
  document.getElementById("mast-title").textContent = site.title;
  const lede = document.getElementById("mast-lede");
  lede.textContent = site.lede;
  lede.hidden = !site.lede;
  if (!site.builtin) document.title = site.title;
  document.getElementById("map").setAttribute("aria-label", site.title + " 地圖");
  const mq = document.getElementById("marquee");
  const mqText = String(site.marquee || "").trim();
  mq.hidden = !mqText;
  document.getElementById("marquee-text").textContent = mqText;
  mq.style.setProperty("--mq-dur", Math.max(12, mqText.length * 0.45) + "s");
}

function renderList() {
  routesEl.innerHTML = "";
  ROUTES.forEach((route) => {
    const color = safeColor(route.color);
    const card = document.createElement("article");
    card.className = "route" + (activeRoute && activeRoute.id === route.id ? " active" : "");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-main";
    button.setAttribute("aria-pressed", activeRoute && activeRoute.id === route.id ? "true" : "false");
    button.innerHTML = `
      ${route.theme ? `<p class="route-theme">${esc(route.theme)}</p>` : ""}
      <h2>${esc(route.name)}</h2>
      <p class="route-facts">${esc(routeFacts(route))}</p>
      ${route.blurb ? `<p class="route-blurb">${esc(route.blurb)}</p>` : ""}${route.credit ? `<p class="route-credit">${esc(route.credit)}</p>` : ""}
    `;
    button.addEventListener("click", () => selectRoute(route.id));
    card.appendChild(button);

    const list = document.createElement("ol");
    list.className = "stops";
    route.stops.forEach((stop, index) => {
      const item = document.createElement("li");
      const stopButton = document.createElement("button");
      stopButton.type = "button";
      stopButton.className = "stop-btn" + (activeRoute && activeRoute.id === route.id && activeStop === index ? " active" : "");
      stopButton.className += stop.photo ? " has-photo" : "";
      stopButton.innerHTML = `<span class="stop-no" style="background:${color}">${index + 1}</span><span class="stop-name">${esc(stop.name)}</span>${thumbHtml(stop)}`;
      stopButton.addEventListener("click", () => selectRoute(route.id, index));
      item.appendChild(stopButton);
      list.appendChild(item);
    });
    card.appendChild(list);
    routesEl.appendChild(card);
  });

  if (!ROUTES.length) {
    const empty = document.createElement("p");
    empty.className = "route-blurb";
    empty.textContent = "這張地圖暫時未有路線。";
    routesEl.appendChild(empty);
  }

  renderMobile();

  const note = document.createElement("p");
  note.className = "fine";
  note.textContent = site.fineNote;
  routesEl.appendChild(note);
}

/* 手機：橫向路線膠囊 + 目前路線的站點列表 */
function renderMobile() {
  document.getElementById("mast-route").textContent = activeRoute
    ? [activeRoute.name, activeRoute.stops.length + " 站", shortDuration(activeRoute)].filter(Boolean).join(" · ")
    : (ROUTES.length ? "選一條路線開始" : "這張地圖暫時未有路線");

  chipsEl.innerHTML = "";
  ROUTES.forEach((route) => {
    const color = safeColor(route.color);
    const chip = document.createElement("button");
    chip.type = "button";
    const on = activeRoute && activeRoute.id === route.id;
    chip.className = "chip" + (on ? " active" : "");
    chip.setAttribute("aria-pressed", on ? "true" : "false");
    chip.style.setProperty("--chip", color);
    const facts = [shortDuration(route), route.stops.length + " 站"].filter(Boolean).join(" · ");
    chip.innerHTML = `<span class="chip-dot" style="background:${color}"></span><span class="chip-name">${esc(route.name)}</span><span class="chip-facts">${esc(facts)}</span>`;
    chip.addEventListener("click", () => {
      // 先展開抽屜，再按新的抽屜高度框住整條路線
      if (sheetState === "collapsed") setSheet("half", { recenter: false });
      selectRoute(route.id);
    });
    chipsEl.appendChild(chip);
  });

  mstopsEl.innerHTML = "";
  if (!activeRoute) return;
  const route = activeRoute;
  const color = safeColor(route.color);
  if (route.blurb) {
    const blurb = document.createElement("p");
    blurb.className = "route-blurb";
    blurb.textContent = route.blurb;
    mstopsEl.appendChild(blurb);
  }
  if (route.credit) {
    const credit = document.createElement("p");
    credit.className = "route-credit";
    credit.textContent = route.credit;
    mstopsEl.appendChild(credit);
  }
  const list = document.createElement("ol");
  route.stops.forEach((stop, index) => {
    const item = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "stop-btn" + (activeStop === index ? " active" : "") + (stop.photo ? " has-photo" : "");
    b.innerHTML = `<span class="stop-no" style="background:${color}">${index + 1}</span><span class="stop-name">${esc(stop.name)}</span>${thumbHtml(stop)}`;
    b.addEventListener("click", () => selectRoute(route.id, index));
    item.appendChild(b);
    list.appendChild(item);
  });
  mstopsEl.appendChild(list);
  const fine = document.createElement("p");
  fine.className = "fine";
  fine.textContent = site.fineNote;
  mstopsEl.appendChild(fine);
}

/* ---------- 底部抽屜 ---------- */
function sheetHeights() {
  const vh = window.innerHeight;
  const handle = handleEl.offsetHeight || 24;
  const collapsed = Math.round(handle + mastEl.offsetHeight + 2);
  const landscape = isLandscapeMobile();
  return {
    collapsed,
    half: Math.max(collapsed + 120, Math.round(vh * (landscape ? 0.62 : 0.45))),
    full: Math.round(vh - (landscape ? 8 : Math.max(56, vh * 0.1)))
  };
}

function setSheet(state, opts = {}) {
  if (!isMobile()) return;
  sheetState = state;
  const h = sheetHeights()[state];
  sheetEl.style.setProperty("--sheet-h", h + "px");
  sheetEl.dataset.sheet = state;
  handleEl.setAttribute("aria-expanded", state === "collapsed" ? "false" : "true");
  if (state === "collapsed") sheetBody.scrollTop = 0;
  if (opts.recenter !== false) recenterForSheet(h);
}

/* 抽屜高度改變後，讓目前站點或路線留在可見的地圖範圍中央 */
function recenterForSheet(h) {
  if (!map || !styleReady) return;
  const pad = mobilePadding(h);
  if (activeRoute && activeStop >= 0) {
    const s = activeRoute.stops[activeStop];
    map.easeTo({ center: [s.lng, s.lat], padding: pad, duration: reducedMotion() ? 0 : 450 });
  } else {
    map.easeTo({ padding: pad, duration: reducedMotion() ? 0 : 450 });
  }
}

function mobilePadding(sheetH) {
  const h = typeof sheetH === "number" ? sheetH : sheetHeights()[sheetState];
  const w = window.innerWidth;
  if (isLandscapeMobile()) {
    const expanded = sheetState !== "collapsed";
    const sw = sheetEl.getBoundingClientRect().width || Math.min(420, w * 0.52);
    return { top: 16, bottom: expanded ? 16 : h + 12, left: expanded ? sw + 16 : 16, right: 64 };
  }
  return { top: 64, bottom: h + 16, left: 16, right: 56 };
}

function initSheetDrag() {
  let startY = 0, startH = 0, lastY = 0, lastT = 0, vel = 0, moved = false, active = false;
  const begin = (e) => {
    if (!isMobile()) return;
    if (e.target.closest && e.target.closest("button:not(#sheet-handle), a")) return;
    active = true; moved = false;
    startY = lastY = e.clientY; lastT = performance.now(); vel = 0;
    startH = sheetEl.getBoundingClientRect().height;
    sheetEl.classList.add("dragging");
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!active) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 6) moved = true;
    const now = performance.now();
    vel = (e.clientY - lastY) / Math.max(1, now - lastT); // px/ms，正值 = 往下
    lastY = e.clientY; lastT = now;
    const hs = sheetHeights();
    const h = Math.min(hs.full, Math.max(hs.collapsed, startH - dy));
    sheetEl.style.setProperty("--sheet-h", h + "px");
  };
  const end = () => {
    if (!active) return;
    active = false;
    sheetEl.classList.remove("dragging");
    const order = ["collapsed", "half", "full"];
    if (!moved) {
      // 輕按：收起 ↔ 半開；全開時回到半開
      setSheet(sheetState === "collapsed" ? "half" : sheetState === "full" ? "half" : "collapsed");
      return;
    }
    const h = sheetEl.getBoundingClientRect().height;
    const hs = sheetHeights();
    let target;
    if (vel < -0.5) target = order[Math.min(2, order.indexOf(nearest(h, hs)) + 1)];
    else if (vel > 0.5) target = order[Math.max(0, order.indexOf(nearest(h, hs)) - 1)];
    else target = nearest(h, hs);
    if (sheetEl.dataset.view === "detail" && target === "full") target = "half";
    setSheet(target);
  };
  const nearest = (h, hs) => Object.keys(hs).reduce((a, b) => (Math.abs(hs[b] - h) < Math.abs(hs[a] - h) ? b : a));
  [handleEl, mastEl].forEach((el) => {
    el.addEventListener("pointerdown", begin);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  });
}

/* 手機 / 桌面切換：移動資料卡位置、重新放置地圖控制 */
function applyMode() {
  const mobile = isMobile();
  if (mobile && detailEl.parentElement !== sheetBody) sheetBody.appendChild(detailEl);
  if (!mobile && detailEl.parentElement !== appEl) appEl.insertBefore(detailEl, document.querySelector(".map-tools"));
  closeBtn.textContent = mobile ? "‹ 站點列表" : "關閉";
  closeBtn.setAttribute("aria-label", mobile ? "返回站點列表" : "關閉站點資料");
  sheetEl.dataset.view = !detailEl.hidden ? "detail" : "list";
  if (mobile) {
    setSheet(sheetState, { recenter: false });
  } else {
    sheetEl.style.removeProperty("--sheet-h");
  }
  placeControls();
}

function placeControls() {
  if (!map) return;
  const mobile = isMobile();
  if (navControl) map.removeControl(navControl);
  if (attribControl) map.removeControl(attribControl);
  navControl = new maplibregl.NavigationControl({ visualizePitch: true });
  // 與 MapLibre 預設版權控制相同的設定，桌面外觀不變
  attribControl = new maplibregl.AttributionControl({
    compact: true,
    customAttribution: '<a href="https://maplibre.org/" target="_blank">MapLibre</a>'
  });
  // bottom-* 角落會把新控制插到最前，所以桌面先加版權、後加導航（與原本一致：導航在上）
  if (mobile) {
    map.addControl(navControl, "top-right");
    map.addControl(attribControl, "top-right");
    // 手機上版權說明預設收起成 (i)，按一下展開，避免遮住地圖
    const collapseAttrib = () => {
      const c = attribControl && attribControl._container;
      if (c) { c.classList.remove("maplibregl-compact-show"); c.removeAttribute("open"); }
    };
    collapseAttrib();
    map.once("idle", collapseAttrib);
  } else {
    map.addControl(attribControl, "bottom-right");
    map.addControl(navControl, "bottom-right");
  }
}

function clearMarkers() {
  markers.forEach((marker) => marker.remove());
  markers = [];
}

function drawRoute(route) {
  setRouteLine(map, routeCoords(route), safeColor(route.color));
}

function addMarkers(route) {
  clearMarkers();
  route.stops.forEach((stop, index) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "pin-wrap" + (index === activeStop ? " active" : "");
    el.style.setProperty("--pin", safeColor(route.color));
    // MapLibre 會改寫外層的 transform，所以旋轉只放在內層
    el.innerHTML = `<span class="pin"><span>${index + 1}</span></span>`;
    el.setAttribute("aria-label", stop.name);
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      focusStop(index);
    });
    const marker = new maplibregl.Marker({ element: el, anchor: "bottom", opacity: "1", opacityWhenCovered: "0.9" })
      .setLngLat([stop.lng, stop.lat])
      .addTo(map);
    markers.push(marker);
  });
}

function padding() {
  if (isMobile()) return mobilePadding();
  return { top: 70, bottom: 70, left: 450, right: detailEl.hidden ? 60 : 400 };
}

function frameRoute(route) {
  const coords = routeCoords(route);
  if (!coords.length) return;
  if (coords.length === 1) {
    map.flyTo({ center: coords[0], zoom: 15.4, padding: padding(), duration: reducedMotion() ? 0 : 1100 });
    return;
  }
  const bounds = coords.reduce(
    (box, coord) => box.extend(coord),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  );
  map.fitBounds(bounds, {
    padding: padding(),
    pitch: isMobile() ? 52 : 58,
    bearing: HOME.bearing,
    duration: reducedMotion() ? 0 : 1100,
    maxZoom: 15.4
  });
}

function openDetail(route, index) {
  const stop = route.stops[index];
  detailEl.hidden = false;
  sheetEl.dataset.view = "detail";
  if (isMobile()) {
    sheetBody.scrollTop = 0;
    if (sheetState !== "half") setSheet("half", { recenter: false });
  }
  document.getElementById("detail-kicker").textContent = `${route.name} · 第 ${index + 1} 站`;
  document.getElementById("detail-name").textContent = stop.name;
  document.getElementById("detail-num").textContent = String(index + 1);
  document.getElementById("detail-prev").hidden = index <= 0;
  document.getElementById("detail-next").hidden = index >= route.stops.length - 1;
  document.getElementById("detail-text").textContent = stop.text;

  const en = document.getElementById("detail-en");
  en.hidden = !stop.en;
  en.textContent = stop.en || "";

  // 任何站點都可帶一張相片：photo: { src, alt, w, h, note }，credit 為出處
  const figure = document.getElementById("detail-photo");
  const img = document.getElementById("detail-img");
  figure.classList.remove("expanded");
  if (stop.photo) {
    img.src = stop.photo.src;
    img.alt = stop.photo.alt || stop.name;
    if (stop.photo.w && stop.photo.h) {
      img.width = stop.photo.w;
      img.height = stop.photo.h;
    } else {
      img.removeAttribute("width");
      img.removeAttribute("height");
    }
    const parts = [stop.photo.note, stop.credit || route.credit].filter(Boolean);
    document.getElementById("detail-caption").textContent = parts.join(" · ");
    figure.hidden = false;
  } else {
    img.removeAttribute("src");
    figure.hidden = true;
  }

  let source;
  if (!site.builtin) source = "位置由製作老師標示，屬約數";
  else source = route.credit
    ? (stop.approx ? "位置按路線圖估計，屬約數" : "座標取自開放街圖，屬約數") + " · 指示文字取自路線圖"
    : "只收錄已核對的公開記述";
  document.getElementById("detail-meta").textContent = formatCoord(stop) + " · " + source;
}

function focusStop(index) {
  if (!activeRoute) return;
  activeStop = index;
  openDetail(activeRoute, index);
  renderList();
  addMarkers(activeRoute);
  const stop = activeRoute.stops[index];
  const mobile = isMobile();
  const camera = {
    center: [stop.lng, stop.lat],
    zoom: mobile ? 16.1 : 16.4,
    pitch: mobile ? 56 : 66,
    bearing: -24,
    duration: reducedMotion() ? 0 : 1300,
    essential: true
  };
  // 手機：以抽屜高度作 padding，讓標記落在可見地圖的中央
  if (mobile) camera.padding = mobilePadding(sheetHeights().half);
  else camera.offset = [40, 0];
  map.flyTo(camera);
}

function selectRoute(id, stopIndex) {
  const route = ROUTES.find((item) => item.id === id);
  if (!route || !styleReady) return;
  const changed = !activeRoute || activeRoute.id !== route.id;
  activeRoute = route;
  if (typeof stopIndex === "number") {
    activeStop = stopIndex;
    openDetail(route, stopIndex);
  } else if (changed) {
    activeStop = -1;
    detailEl.hidden = true;
    sheetEl.dataset.view = "list";
  }
  renderList();
  drawRoute(route);
  addMarkers(route);
  if (typeof stopIndex === "number") focusStop(stopIndex);
  else frameRoute(route);
}

function goHome() {
  activeRoute = null;
  activeStop = -1;
  detailEl.hidden = true;
  clearMarkers();
  if (map) clearRouteLine(map);
  renderList();
  sheetEl.dataset.view = "list";
  if (!map) return;
  const home = isMobile() ? { ...HOME, zoom: HOME.mobileZoom, pitch: HOME.mobilePitch, padding: mobilePadding() } : HOME;
  map.flyTo({ ...home, duration: reducedMotion() ? 0 : 1000, essential: true });
}

function startMap() {
  createMap({
    container: "map",
    mapOptions: () => {
      const mobile = isMobile();
      return {
        center: HOME.center,
        zoom: mobile ? HOME.mobileZoom : HOME.zoom,
        pitch: mobile ? HOME.mobilePitch : HOME.pitch,
        bearing: HOME.bearing,
        maxPitch: mobile ? 65 : 72,
        // 手機：限制像素比，減輕 GPU 負擔
        pixelRatio: mobile ? Math.min(window.devicePixelRatio || 1, 2) : undefined,
        minZoom: site.minZoom,
        maxBounds: site.maxBounds || undefined
      };
    },
    onCreate: (m) => {
      map = m;
      styleReady = false;
      navControl = null;
      attribControl = null;
      placeControls();
    },
    onStatus: showStatus,
    onLoad: (m, entry) => {
      styleReady = true;
      const note = document.getElementById("map-note");
      note.textContent = addTerrain(m, isMobile() ? 1.45 : 1.85)
        ? "已開啟地形與傾斜鏡頭；建築立體見於較大比例"
        : "地形圖磚未能載入，仍以傾斜鏡頭觀看";
      if (tiles.proxyMode && entry.proxied) note.textContent += " · 經本機代理載入圖磚";
      applyServices(m);
      if (ROUTES.length) selectRoute(ROUTES[0].id);
    }
  });
}

document.getElementById("detail-photo").addEventListener("click", (e) => {
  if (!isMobile()) return;
  e.currentTarget.classList.toggle("expanded");
});

closeBtn.addEventListener("click", () => {
  detailEl.hidden = true;
  sheetEl.dataset.view = "list";
  activeStop = -1;
  renderList();
  if (activeRoute) addMarkers(activeRoute);
});

document.getElementById("reset-view").addEventListener("click", goHome);

/* 我的位置：可開可關，用橙點顯示，首次定位時把鏡頭移過去 */
const locateBtn = document.getElementById("locate-me");
let geoWatch = null;
let meMarker = null;
let meFirstFix = false;
function setLocateUI(on, label) {
  locateBtn.setAttribute("aria-pressed", String(on));
  locateBtn.textContent = label || ("我的位置");
}
function stopLocate(label) {
  if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = null;
  if (meMarker) { meMarker.remove(); meMarker = null; }
  setLocateUI(false, label);
}
locateBtn.addEventListener("click", () => {
  if (geoWatch !== null) { stopLocate(); return; }
  if (!("geolocation" in navigator)) { setLocateUI(false, "此瀏覽器不支援定位"); return; }
  meFirstFix = false;
  setLocateUI(true, "定位中…");
  geoWatch = navigator.geolocation.watchPosition((pos) => {
    if (!map) return;
    const ll = [pos.coords.longitude, pos.coords.latitude];
    if (!meMarker) {
      const el = document.createElement("div");
      el.className = "me-dot";
      el.setAttribute("aria-label", "我的位置");
      meMarker = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map);
    } else meMarker.setLngLat(ll);
    setLocateUI(true);
    if (!meFirstFix) {
      meFirstFix = true;
      map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 16), duration: reducedMotion() ? 0 : 1200 });
    }
  }, (err) => {
    stopLocate(err.code === 1 ? "未允許定位" : "暫時找不到位置");
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
});

window.addEventListener("resize", () => {
  if (map) map.resize();
  if (isMobile()) setSheet(sheetState, { recenter: false });
});
MOBILE_MQ.addEventListener("change", applyMode);
LANDSCAPE_MQ.addEventListener("change", applyMode);

/* ---------- 老師地圖：由 Firestore 讀取 ---------- */
function showGate({ title, text, signIn = false, error = "" }) {
  gateEl.hidden = false;
  document.getElementById("gate-title").textContent = title;
  document.getElementById("gate-text").textContent = text;
  const err = document.getElementById("gate-error");
  err.textContent = error;
  err.hidden = !error;
  document.getElementById("gate-signin").hidden = !signIn;
}

async function loadRemoteSite(mapId) {
  showStatus("正在讀取地圖……");
  let fb;
  try {
    fb = await import("./firebase-client.js");
  } catch (error) {
    showStatus("");
    showGate({ title: "未能載入", text: "連不上 Firebase 程式庫，請檢查網絡後重新整理。" });
    return null;
  }
  return new Promise((resolve) => {
    let authMessage = "";
    let first = true;
    const signInBtn = document.getElementById("gate-signin");
    signInBtn.onclick = async () => {
      signInBtn.disabled = true;
      const msg = await fb.signInSchool();
      signInBtn.disabled = false;
      if (msg) showGate({ title: "需要學校帳戶登入", text: "此地圖只限學校帳戶查看，或尚未發佈。", signIn: true, error: msg });
    };
    fb.watchAuth(async (user, message) => {
      if (message) authMessage = message;
      if (!first && !user && !message) return;
      first = false;
      try {
        const doc = await fb.getMap(mapId);
        if (!doc) {
          showStatus("");
          showGate({ title: "找不到這張地圖", text: "連結可能有誤，或地圖已被刪除。" });
          return;
        }
        const photos = await fb.loadPhotos(mapId, fb.photoIdsOf(doc.routes));
        gateEl.hidden = true;
        showStatus("");
        const s = fb.toSite(doc, photos);
        if (user && doc.ownerUid === user.uid && !doc.published) {
          s.eyebrow = "預覽 · 尚未發佈，只有你看到";
        }
        resolve(s);
      } catch (error) {
        showStatus("");
        if (error && error.code === "permission-denied") {
          if (!user) {
            showGate({
              title: "需要學校帳戶登入",
              text: "此地圖只限學校帳戶查看，或尚未發佈。請以 @caritasfsc.edu.hk 學校 Google 帳戶登入。",
              signIn: true,
              error: authMessage
            });
          } else {
            showGate({ title: "未能查看這張地圖", text: "地圖尚未發佈，或你沒有查看權限。如有需要，請聯絡製作的老師。" });
          }
        } else {
          showGate({ title: "未能讀取地圖", text: fb.friendlyDbError(error) });
        }
      }
    });
  });
}

async function main() {
  const mapId = new URLSearchParams(location.search).get("map") || DEFAULT_MAP_ID;
  renderMast();
  renderList();
  initSheetDrag();
  applyMode();
  if (typeof maplibregl === "undefined") {
    showStatus("地圖程式庫未能載入。請確認可以連接網絡後重新開啟。");
    return;
  }
  if (mapId) {
    const loaded = await loadRemoteSite(mapId);
    if (!loaded) return;
    site = loaded;
    HOME = site.home;
    ROUTES = site.routes;
    renderMast();
    renderList();
    applyMode();
  }
  await detectProxy();
  startMap();
}

main();

/* 站點卡左右三角形：上一站／下一站 */
document.getElementById("detail-prev").addEventListener("click", () => {
  if (activeRoute && activeStop > 0) focusStop(activeStop - 1);
});
document.getElementById("detail-next").addEventListener("click", () => {
  if (activeRoute && activeStop < activeRoute.stops.length - 1) focusStop(activeStop + 1);
});

initFerry({ getMap: () => map, button: document.getElementById("ferry-toggle"), panel: document.getElementById("ferry-panel") });
initServices({ getMap: () => map, buttons: { toilets: document.getElementById("svc-toilets"), food: document.getElementById("svc-food") } });
initSaved({ getMap: () => map, button: document.getElementById("saved-toggle"), panel: document.getElementById("saved-panel") });
