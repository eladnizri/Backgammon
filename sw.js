/* Service worker — מאפשר לפתוח את המשחק גם בלי אינטרנט.
   בכל עדכון: מעלים את VERSION ב-1 — זה מה שגורם לדפדפן לזהות גרסה חדשה. */
const VERSION = "1.0.28";
const CACHE = "shesh-besh-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./js/rules.js",
  "./js/engine.js",
  "./js/academy-levels.js",
  "./js/net.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./img/lagoon-couple.jpg",
  "./og-image.png",
];

self.addEventListener("install", e => {
  /* לא קוראים skipWaiting — ה-SW החדש ימתין עד שהמשתמש יאשר עדכון */
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

/* האפליקציה שולחת SKIP_WAITING כשהמשתמש לוחץ על כפתור העדכון */
self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ includeUncontrolled: true })
        .then(clients => clients.forEach(c => c.postMessage({ type: "VERSION", version: VERSION }))))
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  /* התקשורת עם Supabase לעולם לא נשמרת במטמון */
  if (!req.url.startsWith(self.location.origin)) return;

  /* רשת תחילה, מטמון כגיבוי — כך עדכון נתפס מיד וגם אופליין עובד */
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
