/* 長洲足印：Firebase（登入 + Firestore）共用模組
   Firebase JS SDK 模組版，直接由 gstatic CDN 載入，無需建置步驟。 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut, connectAuthEmulator, signInWithCredential
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAIL, SCHOOL_DOMAIN } from "./firebase-config.js";

/* 本機測試：在 localhost 網址加 ?emu=1 便改用 Auth / Firestore 模擬器（不會碰正式資料） */
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
if (LOCAL && new URLSearchParams(location.search).has("emu")) sessionStorage.setItem("ccwEmu", "1");
export const EMULATOR = LOCAL && sessionStorage.getItem("ccwEmu") === "1";

const app = initializeApp(EMULATOR ? { ...firebaseConfig, projectId: "demo-ccw", apiKey: "demo-key" } : firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
auth.languageCode = "zh-TW";
if (EMULATOR) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

export const LIMITS = {
  title: 100, description: 2000, routes: 12, stopsPerRoute: 40,
  routeName: 60, routeText: 120, blurb: 600, stopName: 80, body: 3000, bodyEn: 3000, credit: 200,
  photoChars: 900000 // 相片 data URL 上限（字元），規則容許 950000
};

export function isSchoolUser(user) {
  return !!(user && user.email && user.emailVerified &&
    user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
}

/* 登入狀態：非學校帳戶或電郵未驗證會被即時登出，並把原因傳給 callback */
export function watchAuth(callback) {
  getRedirectResult(auth).catch((error) => callback(null, friendlyAuthError(error)));
  return onAuthStateChanged(auth, async (user) => {
    if (user && !isSchoolUser(user)) {
      const email = user.email || "（沒有電郵）";
      await signOut(auth);
      callback(null, `只限 ${ADMIN_EMAIL} 登入後台。你剛才以 ${email} 登入，已自動登出。`);
      return;
    }
    callback(user, "");
  });
}

export async function signInSchool() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: SCHOOL_DOMAIN, prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
    return "";
  } catch (error) {
    if (error && (error.code === "auth/popup-blocked" || error.code === "auth/operation-not-supported-in-this-environment")) {
      await signInWithRedirect(auth, provider);
      return "";
    }
    return friendlyAuthError(error);
  }
}

export function signOutUser() {
  return signOut(auth);
}

/* 只供模擬器測試：以假 Google 憑證登入（正式網站不可用） */
if (EMULATOR) {
  window.__ccwTestSignIn = (email, name = "測試老師", verified = true) =>
    signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({
      sub: "test-" + email.replace(/[^a-z0-9]/gi, ""), email, email_verified: verified, name
    })));
}

export function friendlyAuthError(error) {
  const code = (error && error.code) || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "登入視窗已關閉，未有登入。";
  if (code === "auth/unauthorized-domain") return "此網址尚未加入 Firebase 的「已授權網域」，請通知管理員（見 README）。";
  if (code === "auth/operation-not-allowed") return "Firebase 尚未啟用 Google 登入，請通知管理員。";
  if (code === "auth/network-request-failed") return "網絡連線失敗，請稍後再試。";
  return "登入失敗：" + (error && error.message ? error.message : code || "未知錯誤");
}

export function friendlyDbError(error) {
  const code = (error && error.code) || "";
  if (code === "permission-denied") return "沒有權限（可能未登入、帳戶不是授權管理員，或地圖不屬於你）。";
  if (code === "unavailable") return "暫時連不上資料庫，請檢查網絡後再試。";
  if (code === "resource-exhausted") return "今日的免費資料庫用量已滿，請明天再試。";
  if (code === "invalid-argument") return "資料過大或格式不正確（單一地圖文件上限約 1 MB）。";
  return (error && error.message) || "未知錯誤";
}

export function newId(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

/* ---------- 地圖 ---------- */
export function newPhotoId(mapId) {
  return doc(collection(db, "maps", mapId, "photos")).id;
}

export function newMapId() {
  return doc(collection(db, "maps")).id;
}

export async function listMyMaps(uid) {
  const snap = await getDocs(query(collection(db, "maps"), where("ownerUid", "==", uid)));
  const maps = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const t = (m) => (m.updatedAt && m.updatedAt.toMillis ? m.updatedAt.toMillis() : 0);
  return maps.sort((a, b) => t(b) - t(a));
}

export async function getMap(mapId) {
  const snap = await getDoc(doc(db, "maps", mapId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createMapDoc(mapId, user, fields) {
  await setDoc(doc(db, "maps", mapId), {
    title: fields.title,
    description: fields.description || "",
    ownerUid: user.uid,
    ownerEmail: user.email,
    ownerName: (user.displayName || user.email.split("@")[0]).slice(0, 100),
    published: false,
    visibility: "school",
    center: fields.center,
    zoom: fields.zoom,
    routes: fields.routes || [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

/* 只更新可編輯欄位；擁有人、建立時間等由規則鎖定 */
export async function saveMapDoc(mapId, fields) {
  const allowed = ["title", "description", "marquee", "published", "visibility", "center", "zoom", "routes"];
  const data = { updatedAt: serverTimestamp() };
  for (const k of allowed) if (k in fields) data[k] = fields[k];
  await updateDoc(doc(db, "maps", mapId), data);
}

export async function deleteMapAndPhotos(mapId) {
  const photos = await getDocs(collection(db, "maps", mapId, "photos"));
  let batch = writeBatch(db);
  let n = 0;
  for (const p of photos.docs) {
    batch.delete(p.ref);
    if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  batch.delete(doc(db, "maps", mapId));
  await batch.commit();
}

/* ---------- 相片（每張一份文件：maps/{mapId}/photos/{photoId}） ---------- */
export async function putPhoto(mapId, photoId, uid, photo) {
  await setDoc(doc(db, "maps", mapId, "photos", photoId), {
    ownerUid: uid,
    dataUrl: photo.dataUrl,
    width: photo.width,
    height: photo.height,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function getPhoto(mapId, photoId) {
  const snap = await getDoc(doc(db, "maps", mapId, "photos", photoId));
  return snap.exists() ? snap.data() : null;
}

export async function deletePhoto(mapId, photoId) {
  await deleteDoc(doc(db, "maps", mapId, "photos", photoId));
}

/* 地圖內所有站點用到的相片 id */
export function photoIdsOf(routes) {
  const ids = new Set();
  (routes || []).forEach((r) => (r.stops || []).forEach((s) => { if (s.photoId) ids.add(s.photoId); }));
  return ids;
}

/* 讀取一組相片；個別失敗不影響其他 */
export async function loadPhotos(mapId, ids) {
  const out = {};
  await Promise.all([...ids].map(async (id) => {
    try {
      const p = await getPhoto(mapId, id);
      if (p) out[id] = p;
    } catch (error) {
      console.warn("[長洲足印] 相片讀取失敗", id, error && error.code);
    }
  }));
  return out;
}

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
    fineNote: "站點位置由製作老師在地圖上標示，屬約數；路線連線只表示步行次序，不是官方步道軌跡。出行前請以現場及主管部門最新公布為準。",
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
          en: s.bodyEn || "",
          credit: s.photoCredit || "",
          photo: p ? { src: p.dataUrl, alt: s.name || "", w: p.width, h: p.height } : null
        };
      })
    }))
  };
}
