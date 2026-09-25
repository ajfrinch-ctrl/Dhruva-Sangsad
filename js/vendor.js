/* Vendor loader — libraries are fetched ONLY when the feature that needs them
   is used, instead of being part of every start-up.
 *
 * Before: index.html loaded 7 <script> files (~1.8 MB parsed on every launch)
 *         even though PDF, Excel and cloud sync are used occasionally.
 * Now:    the shell boots with just the app modules; each library group is
 *         injected on first use and cached afterwards (browser cache + the
 *         offline service-worker cache, so a statement PDF still works with no
 *         network).
 */

const V = './vendor/';
const loaded = new Map();

/** Inject a classic script once; resolves when it has executed. */
export function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve(src);
    s.onerror = () => { loaded.delete(src); reject(new Error(`Could not load ${src}`)); };
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

/* ---------------- Firebase (cloud sync) ---------------- */
let firebaseLoad = null;
export function ensureFirebaseSdk() {
  if (!firebaseLoad) {
    firebaseLoad = (async () => {
      await loadScript(V + 'firebase-app-compat.js');
      await loadScript(V + 'firebase-auth-compat.js');
      await loadScript(V + 'firebase-database-compat.js');
      return true;
    })();
  }
  return firebaseLoad;
}

let bridge = null;
/** Start cloud sync (SDK + bridge) — always after the first paint. */
export async function initFirebase() {
  await ensureFirebaseSdk();
  if (!bridge) bridge = await import('./firebase.js').then(m => m.firebase);
  return bridge.init();
}
/** The bridge without forcing the SDK to load (for UI that only reads status). */
export async function firebaseBridge() {
  if (!bridge) bridge = await import('./firebase.js').then(m => m.firebase);
  return bridge;
}

/* ---------------- PDF (print sheets → A4) ---------------- */
let pdfLoad = null;
export function ensurePdfLibs() {
  if (!pdfLoad) {
    pdfLoad = (async () => {
      await loadScript(V + 'jspdf.umd.min.js');
      await loadScript(V + 'jspdf.plugin.autotable.min.js');
      await loadScript(V + 'html2canvas.min.js');
      return true;
    })();
  }
  return pdfLoad;
}

/* ---------------- Excel (admin backup export) ---------------- */
let xlsxLoad = null;
export function ensureXlsx() {
  if (!xlsxLoad) xlsxLoad = loadScript(V + 'xlsx.full.min.js');
  return xlsxLoad;
}
