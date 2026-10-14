/* 長洲足印：地圖底層（樣式、地形、本機代理偵測），檢視頁與編輯器共用 */

export const DIRECT_TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/* kind：osm（標準 OpenFreeMap Liberty；Dark 僅作載入失敗備援，無 UI） */
export const DIRECT_STYLES = [
  { kind: "osm", style: () => "https://tiles.openfreemap.org/styles/liberty", label: "OpenFreeMap Liberty", proxied: false },
  { kind: "osm", style: () => "https://tiles.openfreemap.org/styles/dark", label: "OpenFreeMap Dark", proxied: false }
];
const PROXY_HOSTS = ["tiles.openfreemap.org", "s3.amazonaws.com", "www.sunferry.com.hk"];
const STYLE_TIMEOUT_MS = 12000;

/* 由 serve.py 提供時改用 /proxy/<host>/<path>；直接開檔或其他伺服器（GitHub Pages 等）則用原網址。 */
export const tiles = {
  styles: DIRECT_STYLES.slice(),
  terrain: DIRECT_TERRAIN,
  proxyMode: false
};

export function toProxy(url) {
  for (const host of PROXY_HOSTS) {
    const prefix = "https://" + host + "/";
    if (url.startsWith(prefix)) return location.origin + "/proxy/" + host + "/" + url.slice(prefix.length);
  }
  return url;
}

async function probeProxy() {
  if (!/^https?:$/.test(location.protocol)) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch("/proxy/health", { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.ok === true;
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let detecting = null;
export function detectProxy() {
  if (!detecting) {
    detecting = probeProxy().then((ok) => {
      tiles.proxyMode = ok;
      if (ok) {
        // 先走本機代理，最後才嘗試直連。
        tiles.styles = DIRECT_STYLES.map((s) => ({
          ...s,
          style: () => toProxy(s.style()),
          label: s.label + "（本機代理）", proxied: true
        })).concat(DIRECT_STYLES);
        tiles.terrain = toProxy(DIRECT_TERRAIN);
      }
      window.__ccw = { proxyMode: ok, styles: tiles.styles.map((s) => s.label), terrain: tiles.terrain };
      return ok;
    });
  }
  return detecting;
}

/* 建立地圖；樣式載入失敗時自動換下一個樣式（重新建立地圖）。
   opts: { container, mapOptions, onCreate(map, entry), onLoad(map, entry), onStatus(msg), onFail() } */
export function createMap(opts) {
  let index = 0;
  const boot = () => {
    const entry = tiles.styles[index];
    let ready = false;
    let failed = false;
    const holder = { entry };
    const map = new maplibregl.Map({
      container: opts.container,
      style: entry.style(),
      attributionControl: false,
      localIdeographFontFamily: "'Noto Sans TC', 'PingFang TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif",
      // 代理模式下的保險：即使樣式內有漏改的網址，也轉到本機代理。
      transformRequest: (url) => ({ url: holder.entry.proxied ? toProxy(url) : url }),
      ...opts.mapOptions()
    });
    map.__ccwHolder = holder;
    map.__ccwBaseMin = map.getMinZoom();
    if (entry.minZoom && map.getMinZoom() < entry.minZoom) map.setMinZoom(entry.minZoom);
    if (window.__ccw) window.__ccw.map = map;
    if (opts.onCreate) opts.onCreate(map, entry);
    const failOver = (reason) => {
      if (ready || failed) return;
      failed = true;
      clearTimeout(timer);
      console.warn("[長洲足印] 樣式失敗：" + entry.label + "（" + reason + "）");
      map.remove();
      if (index < tiles.styles.length - 1) {
        index += 1;
        if (opts.onStatus) opts.onStatus("地圖樣式未能載入，改用備用底圖……");
        boot();
      } else if (opts.onStatus) {
        opts.onStatus("所有地圖樣式都未能載入。請確認網絡，或在資料夾執行 python3 serve.py 後開啟 http://127.0.0.1:8765/。");
      }
    };
    const timer = setTimeout(() => failOver("逾時 " + STYLE_TIMEOUT_MS / 1000 + " 秒"), STYLE_TIMEOUT_MS);
    map.on("error", (event) => {
      if (event && (event.sourceId || event.tile)) return; // 單一圖磚失敗不換樣式
      const message = String(event && event.error ? event.error.message : event);
      // 樣式未載入前的任何錯誤（連線被斷、404、樣式解析失敗）都轉用下一個樣式。
      if (!ready && !map.isStyleLoaded()) failOver(message);
    });
    map.on("load", () => {
      ready = true;
      clearTimeout(timer);
      if (opts.onStatus) opts.onStatus("");
      if (opts.onLoad) opts.onLoad(map, entry);
    });
  };
  boot();
}

/* 加入地形與天空；成功回傳 true */
export function enableTerrain(map, exaggeration) {
  try {
    if (!map.getSource("terrain-dem")) {
      map.addSource("terrain-dem", {
        type: "raster-dem",
        tiles: [tiles.terrain],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 15
      });
    }
    map.setTerrain({ source: "terrain-dem", exaggeration });
    if (!map.getLayer("sky")) {
      map.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [180, 18],
          "sky-atmosphere-sun-intensity": 6
        }
      });
    }
    return true;
  } catch (error) {
    return false;
  }
}

/* 路線線條：route.path（[[lng,lat],…]）缺少時以站點依次連接 */
export function routeCoords(route) {
  if (Array.isArray(route.path) && route.path.length > 1) return route.path;
  return route.stops.map((s) => [s.lng, s.lat]);
}

export function setRouteLine(map, coords, color) {
  const data = coords.length > 1
    ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }
    : { type: "FeatureCollection", features: [] };
  if (map.getSource("route")) {
    map.getSource("route").setData(data);
  } else {
    map.addSource("route", { type: "geojson", data });
    map.addLayer({
      id: "route-casing",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#1a120e", "line-width": 9, "line-opacity": 0.45 }
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": color || "#e25b3a", "line-width": 4.2 }
    });
  }
  if (color) map.setPaintProperty("route-line", "line-color", color);
}

export function clearRouteLine(map) {
  if (map.getSource("route")) map.getSource("route").setData({ type: "FeatureCollection", features: [] });
}

/* 文字轉義：Firestore 內容一律當純文字 */
export function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 顏色只接受 #rrggbb，避免把任意字串放進 style */
export function safeColor(value, fallback = "#e25b3a") {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? value : fallback;
}
