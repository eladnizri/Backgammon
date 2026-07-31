"use strict";

/* ==========================================================================
   net.js — שכבת התקשורת למשחק מול חבר.

   שני מימושים מאחורי אותו ממשק:

   • LocalTransport   — BroadcastChannel בין לשוניות באותו דפדפן. עובד בלי
                        שום חשבון, ומשמש גם לבדיקות של כל זרימת המשחק.
   • SupabaseTransport — ערוץ broadcast של Supabase Realtime מעל WebSocket
                        גולמי, בלי SDK חיצוני. נדלק לבד ברגע שממלאים את
                        NET_CONFIG למטה.

   הפרוטוקול עצמו קטן בכוונה — מעבירים רק קוביות ומהלכים, לא את הלוח:
     hello   אורח מודיע שהגיע
     welcome מארח עונה ומודיע מי פותח
     roll    השחקן שתורו הטיל קוביות
     turn    המהלכים שבוצעו בתור
     bye     יציאה מסודרת
     ping    דופק לזיהוי ניתוק
   ========================================================================== */

/* ─────────────────────────────────────────────────────────────────────────
   שני הערכים מ-Supabase: Settings → API.
   המפתח הפומבי (sb_publishable_… או מפתח anon ישן) נועד לשבת בצד לקוח,
   ולכן מותר לו להיות ב-repo ציבורי. את המפתח הסודי (sb_secret_… /
   service_role) אין להכניס לכאן לעולם.
   כשהשדות ריקים המשחק המקוון עובד בין לשוניות באותו דפדפן בלבד.
   ───────────────────────────────────────────────────────────────────────── */
const NET_CONFIG = {
  url: "https://gytxwjlicawlfdehszil.supabase.co",
  key: "sb_publishable_w7pTF5fWOfc7zGlQS5c61Q_x6IFM0Ir",
};

const NET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // בלי תווים מתבלבלים

function makeRoomCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += NET_ALPHABET[Math.floor(Math.random() * NET_ALPHABET.length)];
  return s;
}

function normalizeRoomCode(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

const netId = () => Math.random().toString(36).slice(2, 10);

/* ---------- מימוש מקומי: בין לשוניות באותו דפדפן ---------- */

class LocalTransport {
  constructor() { this.id = netId(); this.ch = null; this.onMessage = () => {}; this.onStatus = () => {}; }

  get label() { return "מקומי (בין לשוניות)"; }

  async open(room) {
    if (typeof BroadcastChannel === "undefined") throw new Error("no-broadcastchannel");
    this.ch = new BroadcastChannel("shesh-besh-" + room);
    this.ch.onmessage = e => {
      const m = e.data;
      if (!m || m.from === this.id) return;   // התעלמות מהד עצמי
      this.onMessage(m);
    };
    this.onStatus("open");
  }

  send(msg) {
    if (!this.ch) return;
    this.ch.postMessage(Object.assign({}, msg, { from: this.id }));
  }

  close() { if (this.ch) { try { this.ch.close(); } catch (_) {} } this.ch = null; }
}

/* ---------- מימוש Supabase Realtime מעל WebSocket גולמי ---------- */

class SupabaseTransport {
  constructor() {
    this.id = netId();
    this.ws = null;
    this.topic = null;
    this.ref = 0;
    this.hb = null;
    this.onMessage = () => {};
    this.onStatus = () => {};
  }

  get label() { return "Supabase"; }

  open(room) {
    return new Promise((resolve, reject) => {
      const base = NET_CONFIG.url.replace(/^http/, "ws").replace(/\/$/, "");
      const url = `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(NET_CONFIG.key)}&vsn=1.0.0`;
      this.topic = "realtime:shesh-besh-" + room;

      let settled = false;
      let opened = false;
      const fail = err => { if (!settled) { settled = true; reject(err); } };

      try { this.ws = new WebSocket(url); } catch (e) { return fail(new Error("לא ניתן לפתוח חיבור")); }

      this.ws.onopen = () => {
        opened = true;
        /* self:false — לא לקבל בחזרה את מה ששלחנו.
           access_token נשלח גם בגוף ההצטרפות, כפי ש-supabase-js עושה,
           כדי שגם מפתחות מהפורמט החדש (sb_publishable_…) יזוהו. */
        this.push(this.topic, "phx_join", {
          config: { broadcast: { self: false, ack: false }, private: false },
          access_token: NET_CONFIG.key,
        });
        this.hb = setInterval(() => this.push("phoenix", "heartbeat", {}), 25000);
      };

      this.ws.onmessage = ev => {
        let m;
        try { m = JSON.parse(ev.data); } catch (_) { return; }

        if (m.event === "phx_reply" && m.topic === this.topic) {
          if (m.payload && m.payload.status === "ok") {
            if (!settled) { settled = true; this.onStatus("open"); resolve(); }
          } else {
            const why = (m.payload && m.payload.response &&
              (m.payload.response.reason || m.payload.response.message)) || "";
            fail(new Error("הערוץ דחה את המפתח" + (why ? ` (${why})` : "")));
          }
          return;
        }
        if (m.event === "broadcast" && m.payload && m.payload.payload) {
          const body = m.payload.payload;
          if (body.from === this.id) return;
          this.onMessage(body);
        }
      };

      this.ws.onerror = () => fail(new Error("לא הצלחתי להגיע לשרת"));
      this.ws.onclose = ev => {
        clearInterval(this.hb);
        /* אם נסגר לפני שנפתח, כמעט תמיד המפתח או הכתובת שגויים */
        fail(new Error(opened
          ? `החיבור נסגר (קוד ${ev && ev.code})`
          : `נדחה על ידי השרת (קוד ${ev && ev.code}) — בדקו את הכתובת והמפתח`));
        this.onStatus("closed");
      };

      setTimeout(() => fail(new Error("החיבור לא נענה בזמן")), 12000);
    });
  }

  push(topic, event, payload) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ topic, event, payload, ref: String(++this.ref) }));
  }

  send(msg) {
    this.push(this.topic, "broadcast", {
      type: "broadcast",
      event: "m",
      payload: Object.assign({}, msg, { from: this.id }),
    });
  }

  close() {
    clearInterval(this.hb);
    if (this.ws) { try { this.ws.close(); } catch (_) {} }
    this.ws = null;
  }
}

/* מוצא מוצא חירום: אם Supabase לא נענה אפשר לחזור למצב המקומי בלי
   לגעת בקוד, כדי שתמיד תהיה דרך לשחק. */
let netForceLocal = false;
const setForceLocal = v => { netForceLocal = Boolean(v); };
const netConfigured = () => Boolean(NET_CONFIG.url && NET_CONFIG.key) && !netForceLocal;

function makeTransport() {
  return netConfigured() ? new SupabaseTransport() : new LocalTransport();
}
