/* 長洲足印：編輯地圖（editor.html?map=<id>） */
import {
  watchAuth, signInSchool, signOutUser, friendlyDbError, LIMITS,
  getMap, saveMapDoc, loadPhotos, photoIdsOf, putPhoto, newPhotoId, deletePhoto, newId,
  pathFromFirestore, pathToFirestore, DEFAULT_MARQUEE
} from "./firebase-client.js";
import { detectProxy, createMap, setRouteLine, clearRouteLine, esc, safeColor, alignPathToStops } from "./map-core.js";
import { compressImage } from "./photo-utils.js";

const $ = (id) => document.getElementById(id);
const els = {};
["status", "signInCard", "signInBtn", "authError", "signOutBtn", "blockedCard", "blockedMsg", "editorArea",
  "previewLink", "saveBtn", "dirtyState", "mapTitle", "mapDesc", "mapMarquee", "setCenterBtn", "centerInfo",
  "addRouteBtn", "routeList", "routeForm", "rName", "rTheme", "rArea", "rDuration", "rColor", "rBlurb",
  "rPathWrap", "rUsePath", "regenPathBtn", "regenOsrmBtn", "routeUpBtn", "routeDownBtn", "routeDelBtn",
  "stopSec", "addStopBtn", "stopList", "stopForm", "sName", "sBody", "sBodyEn", "placeBtn", "stopCoords",
  "photoThumb", "photoBtnLabel", "photoInput", "photoRemoveBtn", "photoProgress", "sCredit",
  "stopUpBtn", "stopDownBtn", "stopDelBtn", "map", "mapMsg"].forEach((id) => { els[id] = $(id); });

const mapId = new URLSearchParams(location.search).get("map") || "";
const COLORS = ["#e25b3a", "#2f80ed", "#27ae60", "#9b51e0", "#f2994a", "#16a085", "#c0392b", "#d4a017"];
const round6 = (n) => Math.round(n * 1e6) / 1e6;

const state = {
  user: null, doc: null, routes: [], rIdx: -1, sIdx: -1,
  photos: {},             // photoId -> {dataUrl,...}
  orphanPhotos: new Set(), // 被更換 / 移除、儲存後可刪除的相片
  usePath: new Map(),     // route.id -> 是否使用道路路徑
  dirty: false, saving: false, armed: false, loaded: false
};
let map = null;
let markers = [];

const setStatus = (t) => { els.status.textContent = t || ""; };
const curRoute = () => state.routes[state.rIdx] || null;
const curStop = () => { const r = curRoute(); return r ? r.stops[state.sIdx] || null : null; };

function setDirty(d) {
  state.dirty = d;
  els.dirtyState.textContent = d ? "未儲存的更改" : "已儲存";
  els.dirtyState.classList.toggle("is-dirty", d);
  els.saveBtn.disabled = state.saving || !state.loaded;
}

/* ---------- 登入與載入 ---------- */
function showOnly(which) {
  els.signInCard.hidden = which !== "signin";
  els.blockedCard.hidden = which !== "blocked";
  els.editorArea.hidden = which !== "editor";
}
function block(msg) { setStatus(""); els.blockedMsg.textContent = msg; showOnly("blocked"); }

els.signInBtn.addEventListener("click", async () => {
  els.authError.textContent = "";
  els.signInBtn.disabled = true;
  const msg = await signInSchool();
  els.signInBtn.disabled = false;
  if (msg) els.authError.textContent = msg;
});
els.signOutBtn.addEventListener("click", () => {
  if (state.dirty && !confirm("有未儲存的更改，仍要登出嗎？")) return;
  state.dirty = false;
  signOutUser();
});

watchAuth(async (user, message) => {
  state.user = user;
  els.signOutBtn.hidden = !user;
  if (!user) {
    state.loaded = false;
    showOnly("signin");
    setStatus("");
    els.authError.textContent = message || "";
    return;
  }
  if (state.loaded) return;
  if (!mapId) return block("網址缺少地圖編號，請由老師後台開啟要編輯的地圖。");
  setStatus("正在載入地圖……");
  let doc;
  try {
    doc = await getMap(mapId);
  } catch (error) {
    return block("未能載入地圖：" + friendlyDbError(error));
  }
  if (!doc) return block("找不到這張地圖（可能已被刪除）。");
  if (doc.ownerUid !== user.uid) return block("這張地圖不屬於你的帳戶，只有製作老師可以編輯。");
  state.doc = doc;
  state.routes = JSON.parse(JSON.stringify(doc.routes || []));
  state.routes.forEach((r) => {
    r.stops = r.stops || [];
    state.usePath.set(r.id, !!pathFromFirestore(r.path));
  });
  state.rIdx = state.routes.length ? 0 : -1;
  state.sIdx = -1;
  state.loaded = true;
  els.previewLink.href = "index.html?map=" + encodeURIComponent(mapId);
  els.previewLink.hidden = false;
  els.mapTitle.value = doc.title || "";
  els.mapDesc.value = doc.description || "";
  els.mapMarquee.value = typeof doc.marquee === "string" ? doc.marquee : DEFAULT_MARQUEE;
  showCenterInfo();
  showOnly("editor");
  setStatus("");
  setDirty(false);
  renderAll();
  initMap();
  try {
    state.photos = await loadPhotos(mapId, photoIdsOf(state.routes));
    renderStopForm();
  } catch (error) {
    setStatus("部分相片未能載入：" + friendlyDbError(error));
  }
});

function showCenterInfo() {
  const c = state.doc.center || {};
  els.centerInfo.textContent = typeof c.lat === "number"
    ? `中心 ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)} · 縮放 ${Number(state.doc.zoom).toFixed(1)}` : "";
}

/* ---------- 地圖 ---------- */
async function initMap() {
  await detectProxy();
  const c = state.doc.center || { lng: 114.029, lat: 22.208 };
  createMap({
    container: els.map,
    mapOptions: () => ({
      center: [c.lng, c.lat],
      zoom: typeof state.doc.zoom === "number" ? state.doc.zoom : 14.7,
      pitch: 45, bearing: 0, maxPitch: 70
    }),
    onStatus: (msg) => { els.mapMsg.textContent = msg || ""; },
    onLoad: (m) => {
      map = m;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      map.on("click", onMapClick);
      renderMap();
    }
  });
}

function onMapClick(e) {
  if (!state.armed) return;
  const s = curStop();
  disarm();
  if (!s) return;
  s.lng = round6(e.lngLat.lng);
  s.lat = round6(e.lngLat.lat);
  renderStopCoords();
  afterStopsGeometryChanged(curRoute());
}

function disarm() {
  state.armed = false;
  els.placeBtn.textContent = "在地圖上點選位置";
  els.map.parentElement.classList.remove("is-armed");
  els.mapMsg.textContent = "";
}

function lineCoords(r) {
  const path = pathFromFirestore(r.path);
  if (path && state.usePath.get(r.id)) {
    return alignPathToStops(path, r.stops || []);
  }
  return (r.stops || []).map((s) => [s.lng, s.lat]);
}

/* 直線後備：單段 OSM 缺樓梯／小路、路由大繞時先用。 */
function densifyLeg(a, b, maxStepM = 28) {
  const out = [];
  const midLat = (a.lat + b.lat) / 2;
  const toRad = Math.PI / 180;
  const dx = (b.lng - a.lng) * 111000 * Math.cos(midLat * toRad);
  const dy = (b.lat - a.lat) * 111000;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / Math.max(8, maxStepM)));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    out.push([
      round6(a.lng + (b.lng - a.lng) * t),
      round6(a.lat + (b.lat - a.lat) * t)
    ]);
  }
  return out;
}

function straightDistM(a, b) {
  const midLat = (a.lat + b.lat) / 2;
  const toRad = Math.PI / 180;
  const dx = (b.lng - a.lng) * 111000 * Math.cos(midLat * toRad);
  const dy = (b.lat - a.lat) * 111000;
  return Math.hypot(dx, dy);
}

function pathLengthM(coords) {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += straightDistM(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] }
    );
  }
  return len;
}

function decodePolyline6(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let result = 0, shift = 0, b;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    result = 0; shift = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lng / 1e6, lat / 1e6]);
  }
  return coords;
}

/* Valhalla pedestrian：允許樓梯，偏重 walkway／巷仔（CORS 可用）。 */
async function fetchValhallaLeg(a, b) {
  const body = {
    locations: [{ lon: a.lng, lat: a.lat }, { lon: b.lng, lat: b.lat }],
    costing: "pedestrian",
    directions_options: { units: "kilometers" },
    costing_options: {
      pedestrian: {
        walkway_factor: 0.5,
        alley_factor: 0.5,
        step_penalty: 0,
        max_hiking_difficulty: 6,
        use_hills: 0.1,
        use_ferry: 0
      }
    }
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error("http " + res.status);
    const data = await res.json();
    const shape = data && data.trip && data.trip.legs && data.trip.legs[0] && data.trip.legs[0].shape;
    if (!shape) throw new Error("no shape");
    return decodePolyline6(shape);
  } finally {
    clearTimeout(timer);
  }
}

/* OSRM foot：作比較；長洲常大繞，祇取較短者。 */
async function fetchOsrmLeg(a, b) {
  const url = `https://router.project-osrm.org/route/v1/foot/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&continue_straight=false&alternatives=true`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("http " + res.status);
    const data = await res.json();
    const routes = (data && data.routes) || [];
    if (!routes.length) throw new Error(data.code || "no route");
    routes.sort((x, y) => x.distance - y.distance);
    return routes[0].geometry.coordinates;
  } finally {
    clearTimeout(timer);
  }
}

/* 跟路行：Valhalla／OSRM 取較短；若仍 > maxRatio×直線（多半 OSM 缺樓梯／小路）則該段用直線。 */
const MAX_DETOUR_RATIO = 1.85;

async function fetchWalkLeg(a, b) {
  const candidates = [];
  const jobs = [fetchValhallaLeg(a, b), fetchOsrmLeg(a, b)];
  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "fulfilled" && Array.isArray(r.value) && r.value.length > 1) {
      candidates.push(r.value);
    }
  }
  const straight = straightDistM(a, b);
  if (!candidates.length) {
    return { coords: [[a.lng, a.lat], [b.lng, b.lat]], source: "straight", ratio: 1 };
  }
  candidates.sort((p, q) => pathLengthM(p) - pathLengthM(q));
  const best = candidates[0];
  const len = pathLengthM(best);
  const ratio = straight > 1 ? len / straight : 1;
  if (ratio > MAX_DETOUR_RATIO) {
    return {
      coords: [[a.lng, a.lat], ...densifyLeg(a, b), [b.lng, b.lat]],
      source: "straight-fallback",
      ratio
    };
  }
  return { coords: best, source: "network", ratio };
}

/* mode: "walk"（預設：跟路＋小路／樓梯）| "direct"（純直線） */
async function regenerateRoutePath(r, { quiet, mode } = {}) {
  if (!r) return false;
  const stops = r.stops || [];
  if (stops.length < 2) {
    delete r.path;
    state.usePath.set(r.id, false);
    return true;
  }
  const wantDirect = mode === "direct";
  if (!quiet) {
    setStatus(wantDirect
      ? "正在以直線連接站點……"
      : "正在重算行路路徑（跟路，優先小路／樓梯）……");
  }

  const out = [];
  let networkLegs = 0, fallbackLegs = 0;
  if (wantDirect) {
    out.push([round6(stops[0].lng), round6(stops[0].lat)]);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      for (const p of densifyLeg(a, b)) out.push(p);
      out.push([round6(b.lng), round6(b.lat)]);
    }
  } else {
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      const { coords, source } = await fetchWalkLeg(a, b);
      if (source === "network") networkLegs += 1;
      else fallbackLegs += 1;
      if (i === 0) out.push([round6(a.lng), round6(a.lat)]);
      for (let j = 1; j < coords.length - 1; j++) {
        out.push([round6(coords[j][0]), round6(coords[j][1])]);
      }
      out.push([round6(b.lng), round6(b.lat)]);
    }
  }

  r.path = pathToFirestore(out);
  state.usePath.set(r.id, true);
  if (!quiet) {
    if (wantDirect) {
      setStatus("已用直線連接站點。記得按「儲存」。");
    } else if (fallbackLegs && networkLegs) {
      setStatus(`行路路徑已更新：${networkLegs} 段跟路，${fallbackLegs} 段因 OSM 缺路／大繞改用直線（多為樓梯／小路）。記得按「儲存」。`);
    } else if (fallbackLegs) {
      setStatus("各段路網都大繞或失敗，已用直線補上（OSM 或未收錄樓梯／小路）。記得按「儲存」。");
    } else {
      setStatus("行路路徑已按小路／樓梯重算。記得按「儲存」。");
    }
  }
  return true;
}

async function afterStopsGeometryChanged(r) {
  if (!r) return;
  setDirty(true);
  // 移動站點後：先對齊舊 path 預覽，再非同步跟路重算
  if (state.usePath.get(r.id)) {
    const old = pathFromFirestore(r.path);
    if (old && old.length > 1 && (r.stops || []).length >= 2) {
      r.path = pathToFirestore(alignPathToStops(old, r.stops));
    }
    renderRouteForm();
    renderMap();
    try {
      await regenerateRoutePath(r, { quiet: true, mode: "walk" });
      renderRouteForm();
      renderMap();
    } catch (error) {
      console.warn("[長洲足印] 路徑重算失敗", error);
    }
    return;
  }
  renderRouteForm();
  renderMap();
}

function renderMap() {
  if (!map) return;
  markers.forEach((mk) => mk.remove());
  markers = [];
  const r = curRoute();
  if (!r) { clearRouteLine(map); return; }
  const color = safeColor(r.color);
  setRouteLine(map, lineCoords(r), color);
  r.stops.forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "ed-marker" + (i === state.sIdx ? " is-sel" : "");
    el.style.background = color;
    el.textContent = String(i + 1);
    el.title = s.name || "";
    el.addEventListener("click", (ev) => { ev.stopPropagation(); selectStop(i); });
    const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([s.lng, s.lat]).addTo(map);
    mk.on("dragend", () => {
      const ll = mk.getLngLat();
      s.lng = round6(ll.lng);
      s.lat = round6(ll.lat);
      if (i !== state.sIdx) selectStop(i); else renderStopCoords();
      afterStopsGeometryChanged(r);
    });
    markers.push(mk);
  });
}

/* ---------- 面板 ---------- */
function renderAll() {
  renderRouteList();
  renderRouteForm();
  renderStopList();
  renderStopForm();
  renderMap();
}

function renderRouteList() {
  els.routeList.innerHTML = state.routes.map((r, i) => `
    <li><button type="button" class="ed-item${i === state.rIdx ? " is-sel" : ""}" data-i="${i}">
      <span class="ed-swatch" style="background:${safeColor(r.color)}"></span>
      <span class="ed-item-name">${esc(r.name || "（未命名路線）")}</span>
      <span class="ed-item-sub">${r.stops.length} 站</span>
    </button></li>`).join("") || `<li class="ed-hint">尚未有路線，按「新增路線」開始。</li>`;
  els.addRouteBtn.disabled = state.routes.length >= LIMITS.routes;
}
els.routeList.addEventListener("click", (e) => {
  const b = e.target.closest("[data-i]");
  if (!b) return;
  state.rIdx = Number(b.dataset.i);
  state.sIdx = -1;
  disarm();
  renderAll();
});

function renderRouteForm() {
  const r = curRoute();
  els.routeForm.hidden = !r;
  els.stopSec.hidden = !r;
  if (!r) return;
  els.rName.value = r.name || "";
  els.rTheme.value = r.theme || "";
  els.rArea.value = r.area || "";
  els.rDuration.value = r.duration || "";
  els.rColor.value = safeColor(r.color);
  els.rBlurb.value = r.blurb || "";
  const hasPath = !!pathFromFirestore(r.path);
  els.rPathWrap.hidden = !hasPath;
  els.rUsePath.checked = hasPath && !!state.usePath.get(r.id);
  const few = (r.stops || []).length < 2;
  if (els.regenPathBtn) els.regenPathBtn.disabled = few;
  if (els.regenOsrmBtn) els.regenOsrmBtn.disabled = few;
  els.routeUpBtn.disabled = state.rIdx <= 0;
  els.routeDownBtn.disabled = state.rIdx >= state.routes.length - 1;
}

function renderStopList() {
  const r = curRoute();
  if (!r) { els.stopList.innerHTML = ""; return; }
  els.stopList.innerHTML = r.stops.map((s, i) => `
    <li><button type="button" class="ed-item${i === state.sIdx ? " is-sel" : ""}" data-i="${i}">
      <span class="ed-num" style="background:${safeColor(r.color)}">${i + 1}</span>
      <span class="ed-item-name">${esc(s.name || "（未命名站點）")}</span>
      ${s.photoId ? `<span class="ed-item-sub">相片</span>` : ""}
    </button></li>`).join("") || `<li class="ed-hint">尚未有站點。</li>`;
  els.addStopBtn.disabled = r.stops.length >= LIMITS.stopsPerRoute;
}
els.stopList.addEventListener("click", (e) => {
  const b = e.target.closest("[data-i]");
  if (b) selectStop(Number(b.dataset.i));
});

function selectStop(i) {
  state.sIdx = i;
  disarm();
  renderStopList();
  renderStopForm();
  renderMap();
}

function renderStopCoords() {
  const s = curStop();
  els.stopCoords.textContent = s ? `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}` : "";
}

function renderStopForm() {
  const s = curStop();
  els.stopForm.hidden = !s;
  if (!s) return;
  els.sName.value = s.name || "";
  els.sBody.value = s.body || "";
  els.sBodyEn.value = s.bodyEn || "";
  els.sCredit.value = s.photoCredit || "";
  renderStopCoords();
  renderPhoto();
  const r = curRoute();
  els.stopUpBtn.disabled = state.sIdx <= 0;
  els.stopDownBtn.disabled = state.sIdx >= r.stops.length - 1;
}

function renderPhoto() {
  const s = curStop();
  if (!s) return;
  const p = s.photoId ? state.photos[s.photoId] : null;
  const url = p && typeof p.dataUrl === "string" && p.dataUrl.startsWith("data:image/") ? p.dataUrl : "";
  els.photoThumb.style.backgroundImage = url ? `url("${url}")` : "";
  els.photoThumb.textContent = url ? "" : (s.photoId ? "相片載入中／未能載入" : "未有相片");
  els.photoBtnLabel.textContent = s.photoId ? "更換相片" : "上載相片";
  els.photoRemoveBtn.hidden = !s.photoId;
}

/* 文字欄位：即時寫入狀態 */
const bindText = (el, getObj, key, after) => el.addEventListener("input", () => {
  const o = getObj();
  if (!o) return;
  o[key] = el.value;
  setDirty(true);
  if (after) after();
});
bindText(els.rName, curRoute, "name", renderRouteList);
bindText(els.rTheme, curRoute, "theme");
bindText(els.rArea, curRoute, "area");
bindText(els.rDuration, curRoute, "duration");
bindText(els.rBlurb, curRoute, "blurb");
bindText(els.rColor, curRoute, "color", () => { renderRouteList(); renderStopList(); renderMap(); });
bindText(els.sName, curStop, "name", renderStopList);
bindText(els.sBody, curStop, "body");
bindText(els.sBodyEn, curStop, "bodyEn");
bindText(els.sCredit, curStop, "photoCredit");
els.mapTitle.addEventListener("input", () => setDirty(true));
els.mapDesc.addEventListener("input", () => setDirty(true));
els.mapMarquee.addEventListener("input", () => setDirty(true));

els.rUsePath.addEventListener("change", async () => {
  const r = curRoute();
  if (!r) return;
  state.usePath.set(r.id, els.rUsePath.checked);
  if (els.rUsePath.checked && !pathFromFirestore(r.path) && (r.stops || []).length >= 2) {
    await regenerateRoutePath(r, { mode: "walk" });
  }
  setDirty(true);
  renderRouteForm();
  renderMap();
});

async function runRegen(mode) {
  const r = curRoute();
  if (!r || (r.stops || []).length < 2) return;
  if (els.regenPathBtn) els.regenPathBtn.disabled = true;
  if (els.regenOsrmBtn) els.regenOsrmBtn.disabled = true;
  try {
    await regenerateRoutePath(r, { mode });
    setDirty(true);
    renderRouteForm();
    renderMap();
  } finally {
    if (els.regenPathBtn) els.regenPathBtn.disabled = false;
    if (els.regenOsrmBtn) els.regenOsrmBtn.disabled = false;
  }
}
els.regenPathBtn.addEventListener("click", () => runRegen("walk"));
if (els.regenOsrmBtn) els.regenOsrmBtn.addEventListener("click", () => runRegen("direct"));

els.setCenterBtn.addEventListener("click", () => {
  if (!map) { setStatus("地圖尚未載入。"); return; }
  const c = map.getCenter();
  state.doc.center = { lng: round6(c.lng), lat: round6(c.lat) };
  state.doc.zoom = Math.min(20, Math.max(3, Math.round(map.getZoom() * 100) / 100));
  showCenterInfo();
  setDirty(true);
});

/* ---------- 路線操作 ---------- */
function move(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
}

els.addRouteBtn.addEventListener("click", () => {
  if (state.routes.length >= LIMITS.routes) return;
  const r = {
    id: newId("r"), name: "新路線 " + (state.routes.length + 1), theme: "", area: "", duration: "",
    color: COLORS[state.routes.length % COLORS.length], blurb: "", stops: []
  };
  state.routes.push(r);
  state.rIdx = state.routes.length - 1;
  state.sIdx = -1;
  setDirty(true);
  renderAll();
  els.rName.focus();
  els.rName.select();
});
els.routeDelBtn.addEventListener("click", () => {
  const r = curRoute();
  if (!r || !confirm(`確定刪除路線「${r.name || "未命名路線"}」及其 ${r.stops.length} 個站點？（按「儲存」後生效）`)) return;
  r.stops.forEach((s) => { if (s.photoId) state.orphanPhotos.add(s.photoId); });
  state.routes.splice(state.rIdx, 1);
  state.usePath.delete(r.id);
  state.rIdx = Math.min(state.rIdx, state.routes.length - 1);
  state.sIdx = -1;
  disarm();
  setDirty(true);
  renderAll();
});
els.routeUpBtn.addEventListener("click", () => { if (move(state.routes, state.rIdx, -1)) { state.rIdx--; setDirty(true); renderAll(); } });
els.routeDownBtn.addEventListener("click", () => { if (move(state.routes, state.rIdx, 1)) { state.rIdx++; setDirty(true); renderAll(); } });

/* ---------- 站點操作 ---------- */
els.addStopBtn.addEventListener("click", () => {
  const r = curRoute();
  if (!r || r.stops.length >= LIMITS.stopsPerRoute) return;
  const c = map ? map.getCenter() : state.doc.center || { lng: 114.029, lat: 22.208 };
  r.stops.push({ id: newId("s"), name: "新站點 " + (r.stops.length + 1), body: "", lat: round6(c.lat), lng: round6(c.lng) });
  state.sIdx = r.stops.length - 1;
  disarm();
  renderRouteList();
  renderStopList();
  renderStopForm();
  afterStopsGeometryChanged(r);
  els.sName.focus();
  els.sName.select();
});
els.stopDelBtn.addEventListener("click", () => {
  const r = curRoute();
  const s = curStop();
  if (!s || !confirm(`確定刪除站點「${s.name || "未命名站點"}」？（按「儲存」後生效）`)) return;
  if (s.photoId) state.orphanPhotos.add(s.photoId);
  r.stops.splice(state.sIdx, 1);
  state.sIdx = Math.min(state.sIdx, r.stops.length - 1);
  disarm();
  renderRouteList();
  renderStopList();
  renderStopForm();
  afterStopsGeometryChanged(r);
});
els.stopUpBtn.addEventListener("click", () => {
  const r = curRoute();
  if (r && move(r.stops, state.sIdx, -1)) {
    state.sIdx--;
    renderStopList();
    renderStopForm();
    afterStopsGeometryChanged(r);
  }
});
els.stopDownBtn.addEventListener("click", () => {
  const r = curRoute();
  if (r && move(r.stops, state.sIdx, 1)) {
    state.sIdx++;
    renderStopList();
    renderStopForm();
    afterStopsGeometryChanged(r);
  }
});
els.placeBtn.addEventListener("click", () => {
  if (state.armed) { disarm(); return; }
  if (!map) { setStatus("地圖尚未載入。"); return; }
  state.armed = true;
  els.placeBtn.textContent = "取消點選";
  els.map.parentElement.classList.add("is-armed");
  els.mapMsg.textContent = "請在地圖上點選此站點的位置";
});

/* ---------- 相片 ---------- */
els.photoInput.addEventListener("change", async () => {
  const file = els.photoInput.files && els.photoInput.files[0];
  els.photoInput.value = "";
  const s = curStop();
  if (!file || !s) return;
  els.photoProgress.textContent = "正在壓縮及上載相片……";
  els.photoInput.disabled = true;
  try {
    const photo = await compressImage(file, { maxDim: 1280, quality: 0.75, maxChars: LIMITS.photoChars });
    const pid = newPhotoId(mapId);
    await putPhoto(mapId, pid, state.user.uid, photo);
    state.photos[pid] = photo;
    if (s.photoId) state.orphanPhotos.add(s.photoId);
    s.photoId = pid;
    state.orphanPhotos.add(pid); // 未儲存前亦屬「未被引用」，儲存時會按實際引用排除
    setDirty(true);
    els.photoProgress.textContent = "相片已上載，記得按「儲存」。";
  } catch (error) {
    els.photoProgress.textContent = "相片上載失敗：" + (error && error.code ? friendlyDbError(error) : (error && error.message) || "未知錯誤");
  } finally {
    els.photoInput.disabled = false;
  }
  if (curStop() === s) { renderPhoto(); renderStopList(); }
});
els.photoRemoveBtn.addEventListener("click", () => {
  const s = curStop();
  if (!s || !s.photoId) return;
  state.orphanPhotos.add(s.photoId);
  delete s.photoId;
  setDirty(true);
  els.photoProgress.textContent = "";
  renderPhoto();
  renderStopList();
});

/* ---------- 儲存 ---------- */
function clean(v) { return typeof v === "string" ? v.trim() : ""; }

function buildRoutes() {
  const errs = [];
  const tooLong = (label, v, max) => { if (v.length > max) errs.push(`${label}超過 ${max} 字`); };
  const routes = state.routes.map((r, ri) => {
    const rl = `路線 ${ri + 1}`;
    const out = {
      id: r.id, name: clean(r.name), theme: clean(r.theme), area: clean(r.area), duration: clean(r.duration),
      color: safeColor(r.color), blurb: clean(r.blurb)
    };
    if (!out.name) errs.push(`${rl}未有名稱`);
    tooLong(`${rl}名稱`, out.name, LIMITS.routeName);
    ["theme", "area", "duration"].forEach((k) => tooLong(`${rl}的${{ theme: "主題", area: "地區", duration: "時間" }[k]}`, out[k], LIMITS.routeText));
    tooLong(`${rl}簡介`, out.blurb, LIMITS.blurb);
    if (r.credit) out.credit = clean(r.credit).slice(0, LIMITS.credit);
    if (pathFromFirestore(r.path) && state.usePath.get(r.id)) out.path = r.path;
    out.stops = r.stops.map((s, si) => {
      const sl = `${rl}第 ${si + 1} 站`;
      const st = { id: s.id, name: clean(s.name), body: clean(s.body), lat: round6(s.lat), lng: round6(s.lng) };
      if (!st.name) errs.push(`${sl}未有名稱`);
      tooLong(`${sl}名稱`, st.name, LIMITS.stopName);
      tooLong(`${sl}介紹`, st.body, LIMITS.body);
      const en = clean(s.bodyEn);
      if (en) { st.bodyEn = en; tooLong(`${sl}英文介紹`, en, LIMITS.bodyEn); }
      if (s.photoId) st.photoId = s.photoId;
      const cr = clean(s.photoCredit);
      if (cr) { st.photoCredit = cr; tooLong(`${sl}相片來源`, cr, LIMITS.credit); }
      return st;
    });
    if (r.stops.length > LIMITS.stopsPerRoute) errs.push(`${rl}站點多於 ${LIMITS.stopsPerRoute} 個`);
    return out;
  });
  if (routes.length > LIMITS.routes) errs.push(`路線多於 ${LIMITS.routes} 條`);
  return { routes, errs };
}

async function save() {
  if (!state.loaded || state.saving) return;
  const title = clean(els.mapTitle.value);
  const description = clean(els.mapDesc.value);
  const marquee = clean(els.mapMarquee.value).slice(0, 200);
  const { routes, errs } = buildRoutes();
  if (!title) errs.unshift("地圖標題不可留空");
  if (title.length > LIMITS.title) errs.unshift(`地圖標題超過 ${LIMITS.title} 字`);
  if (description.length > LIMITS.description) errs.unshift(`簡介超過 ${LIMITS.description} 字`);
  if (errs.length) {
    setStatus("未能儲存：" + errs.slice(0, 4).join("；") + (errs.length > 4 ? `（另有 ${errs.length - 4} 項）` : ""));
    return;
  }
  state.saving = true;
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = "儲存中……";
  setStatus("");
  const center = state.doc.center, zoom = state.doc.zoom;
  try {
    await saveMapDoc(mapId, { title, description, marquee, center, zoom, routes });
    state.doc.title = title;
    state.doc.description = description;
    state.doc.marquee = marquee;
    // 路徑取消勾選後已在儲存時移除
    state.routes.forEach((r) => { if (!state.usePath.get(r.id)) delete r.path; });
    setDirty(false);
    renderRouteForm();
    // 清理不再被引用的相片
    const used = photoIdsOf(routes);
    const stale = [...state.orphanPhotos].filter((id) => !used.has(id));
    state.orphanPhotos = new Set();
    const failed = [];
    await Promise.all(stale.map((id) => deletePhoto(mapId, id).then(() => { delete state.photos[id]; })
      .catch((error) => { failed.push(id); console.warn("[長洲足印] 相片刪除失敗", id, error && error.code); })));
    failed.forEach((id) => state.orphanPhotos.add(id));
    setStatus(failed.length ? `已儲存，但有 ${failed.length} 張舊相片未能刪除，下次儲存會再試。` : "");
  } catch (error) {
    setStatus("儲存失敗：" + friendlyDbError(error));
  } finally {
    state.saving = false;
    els.saveBtn.textContent = "儲存";
    setDirty(state.dirty);
  }
}

els.saveBtn.addEventListener("click", save);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  } else if (e.key === "Escape" && state.armed) {
    disarm();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (!state.dirty) return;
  e.preventDefault();
  e.returnValue = "";
});
