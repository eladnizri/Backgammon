/* Service worker — מאפשר לפתוח את המשחק גם בלי אינטרנט.
   כל שינוי בקבצים מחייב העלאת CACHE כדי שהגרסה החדשה תיתפס. */
const CACHE = "shesh-besh-v1";

const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./js/rules.js",
  "./js/engine.js",
  "./js/net.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
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
