/* 長洲足印：輕量地圖資料模組（不載入 Firebase SDK）
   公開頁以 Firestore REST 讀取已發佈地圖，加快首次載入。 */
import { firebaseConfig } from "./firebase-config.js";

/* Firestore 不能存巢狀陣列，路徑以 [{lng,lat}] 儲存 */
export function pathToFirestore(path) {
  return Array.isArray(path) ? path.map(([lng, lat]) => ({ lng, lat })) : null;
}
export function pathFromFirestore(path) {
  return Array.isArray(path) && path.length > 1 ? path.map((p) => [p.lng, p.lat]) : null;
}

/* Firestore 地圖 → 顯示程式用的 site 物件（與內置路線同一格式） */
export const DEFAULT_MARQUEE = "溫馨提示：地圖上的公廁及食店資料只供參考，請以現場實際情況為準。";

export function toSite(mapDoc, photos) {
  const title = mapDoc.title || "未命名地圖";
  return {
    marquee: typeof mapDoc.marquee === "string" ? mapDoc.marquee : DEFAULT_MARQUEE,
    builtin: false,
    id: mapDoc.id,
    title,
    seal: Array.from(title)[0] || "圖",
    eyebrow: (mapDoc.ownerName ? mapDoc.ownerName + " 製作" : "製作") + " · 不是導航",
    lede: mapDoc.description || "",
    fineNote: "站點位置由製作老師在地圖上標示，屬約數；路線跟行人路／小路／樓梯連接站點，只表示步行次序，不是官方導航。出行前請以現場及主管部門最新公布為準。",
    published: !!mapDoc.published,
    visibility: mapDoc.visibility,
    home: {
      center: [mapDoc.center ? mapDoc.center.lng : 114.029, mapDoc.center ? mapDoc.center.lat : 22.208],
      zoom: typeof mapDoc.zoom === "number" ? mapDoc.zoom : 14.7,
      pitch: 62, bearing: -32,
      mobileZoom: (typeof mapDoc.zoom === "number" ? mapDoc.zoom : 14.7) - 0.8,
      mobilePitch: 52
    },
    maxBounds: null,
    minZoom: 3,
    routes: (mapDoc.routes || []).map((r) => ({
      id: r.id,
      name: r.name || "未命名路線",
      theme: r.theme || "",
      area: r.area || "",
      duration: r.duration || "",
      color: r.color,
      blurb: r.blurb || "",
      credit: r.credit || "",
      path: pathFromFirestore(r.path),
      stops: (r.stops || []).map((s) => {
        const p = s.photoId && photos[s.photoId];
        return {
          id: s.id,
          name: s.name || "未命名站點",
          lng: s.lng,
          lat: s.lat,
          text: s.body || "",
          short: keyLine(s.body || ""),
          en: s.bodyEn || "",
          credit: s.photoCredit || "",
          photo: p ? { src: p.dataUrl, alt: s.name || "", w: p.width, h: p.height } : null
        };
      })
    }))
  };
}


/* 重點字：取第一句；太長再截到第一個逗號 */
export function keyLine(text) {
  let t = String(text || "").trim().split(/[。！？\n]/)[0];
  if (t.length > 16) t = t.split(/[，、；]/)[0];
  if (t.length > 18) t = t.slice(0, 17) + "…";
  return t;
}

/* Firestore REST 值 → 普通 JS 物件 */
function decodeValue(v) {
  if (!v || typeof v !== "object") return v;
  if ("stringValue" in v) return v.stringValue;
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("integerValue" in v) return Number(v.integerValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) {
    const out = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) out[k] = decodeValue(x);
    return out;
  }
  return null;
}

/* 未登入讀取公開地圖；失敗（例如未發佈）回傳 null，交由 SDK 流程處理 */
export async function fetchPublicMap(mapId, { timeoutMs = 8000 } = {}) {
  const url = "https://firestore.googleapis.com/v1/projects/" + firebaseConfig.projectId +
    "/databases/(default)/documents/maps/" + encodeURIComponent(mapId) +
    "?key=" + encodeURIComponent(firebaseConfig.apiKey);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const doc = { id: mapId };
    for (const [k, x] of Object.entries(data.fields || {})) doc[k] = decodeValue(x);
    return doc;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* 本機快取：重開時即時顯示，背景再更新 */
const CACHE_PREFIX = "ccw-site-v1:";
export function readCachedMap(mapId) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + mapId);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}
export function writeCachedMap(mapId, doc) {
  try {
    const slim = { ...doc };
    delete slim.ownerEmail;
    localStorage.setItem(CACHE_PREFIX + mapId, JSON.stringify(slim));
  } catch (error) { /* 空間不足就算 */ }
}
