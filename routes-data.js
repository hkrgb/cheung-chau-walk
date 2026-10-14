/* 長洲足印：內置站點已清空；路線以 Firebase maps/cheung-chau-footprints 為單一來源。
   後台可編輯該地圖；公開頁透過 DEFAULT_MAP_ID 載入。 */

export const HOME = {
  center: [114.029, 22.208],
  zoom: 14.7,
  pitch: 62,
  bearing: -32,
  mobileZoom: 13.9,
  mobilePitch: 52
};

export const ROUTES = [];

export const FINE_NOTE = "站點座標為約數。路線跟行人路／小路／樓梯連接站點，不是官方導航。船期、泳灘與現場通道請以主管部門最新公布為準。";

/* 內置版本的刊頭與設定（與 Firestore 地圖共用同一個顯示程式；routes 留空以免與 Firebase 重複） */
export const BUILTIN_SITE = {
  marquee: "溫馨提示：地圖上的公廁及食店資料只供參考，請以現場實際情況為準。",
  builtin: true,
  title: "長洲足印",
  seal: "洲",
  eyebrow: "離島步行 · 不是導航",
  lede: "把東灣、山頂、西灣與北眺收進一張可俯瞰的地圖。選一條觀光路線，沿站點慢慢看。",
  fineNote: FINE_NOTE,
  home: HOME,
  maxBounds: [[113.99, 22.175], [114.065, 22.238]],
  minZoom: 13,
  routes: ROUTES
};
