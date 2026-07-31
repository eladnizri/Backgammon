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
   הדביקו כאן את שני הערכים מ-Supabase: Settings → API.
   המפתח anon נועד לשבת בצד לקוח, ולכן מותר לו להיות ב-repo ציבורי.
   כל עוד השדות ריקים המשחק המקוון עובד בין לשוניות באותו דפדפן בלבד.
   ───────────────────────────────────────────────────────────────────────── */
const NET_CONFIG = {
  url: "",   // https://xxxxxxxx.supabase.co
  key: "",   // anon public key
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
      const fail = err => { if (!settled) { settled = true; reject(err); } };

      try { this.ws = new WebSocket(url); } catch (e) { return fail(e); }

      this.ws.onopen = () => {
        /* self:false — לא לקבל בחזרה את מה ששלחנו */
        this.push(this.topic, "phx_join", {
          config: { broadcast: { self: false, ack: false } },
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
            fail(new Error("join-refused"));
          }
          return;
        }
        if (m.event === "broadcast" && m.payload && m.payload.payload) {
          const body = m.payload.payload;
          if (body.from === this.id) return;
          this.onMessage(body);
        }
      };

      this.ws.onerror = () => fail(new Error("socket-error"));
      this.ws.onclose = () => {
        clearInterval(this.hb);
        fail(new Error("socket-closed"));
        this.onStatus("closed");
      };

      setTimeout(() => fail(new Error("timeout")), 12000);
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

const netConfigured = () => Boolean(NET_CONFIG.url && NET_CONFIG.key);

/* בוחר את המימוש הזמין. ברירת המחדל היא המקומי, כדי שהמשחק המקוון
   יהיה ניתן לניסיון מיד גם לפני שהוגדר חשבון. */
function makeTransport() {
  return netConfigured() ? new SupabaseTransport() : new LocalTransport();
}
