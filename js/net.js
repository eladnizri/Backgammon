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

  isOpen() { return !!this.ch; }

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

  isOpen() { return !!this.ws && this.ws.readyState === 1; }

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

/* ---------- מימוש PeerJS: חיבור ישיר בין שני המכשירים ---------- */

/* אין כאן שרת משלנו ואין חשבון. שרת התיווך הציבורי של PeerJS רק מצמיד
   בין שני הצדדים לפי קוד החדר, ומרגע שהחיבור נוצר ההודעות עוברות ישירות
   ביניהם. המארח נרשם אצל המתווך תחת קוד החדר, והאורח מתחבר אל המזהה הזה. */

const PEER_PREFIX = "sheshbesh-";
const PEER_TIMEOUT = 15000;
const PEER_ID_TRIES = 3;     // ניסיונות חוזרים כשהמזהה הישן עוד לא שוחרר

function peerErrorText(type) {
  switch (type) {
    case "browser-incompatible": return "הדפדפן לא תומך בחיבור ישיר";
    case "unavailable-id":       return "קוד החדר עדיין תפוס — פתחו חדר חדש";
    case "invalid-id":           return "קוד חדר לא תקין";
    case "ssl-unavailable":
    case "server-error":
    case "socket-error":
    case "socket-closed":
    case "network":              return "לא הצלחתי להגיע לשרת התיווך";
    default:                     return "החיבור נכשל";
  }
}

class PeerTransport {
  constructor() {
    this.id = netId();
    this.peer = null;
    this.conn = null;
    this.role = "host";
    this.retry = null;
    this.onMessage = () => {};
    this.onStatus = () => {};
  }

  get label() { return "חיבור ישיר (P2P)"; }

  open(room, role) {
    this.role = role === "guest" ? "guest" : "host";
    const hostId = PEER_PREFIX + room;

    return new Promise((resolve, reject) => {
      let settled = false;
      const stop = () => { clearInterval(this.retry); this.retry = null; };
      const done = () => { if (!settled) { settled = true; stop(); this.onStatus("open"); resolve(); } };
      const fail = err => { if (!settled) { settled = true; stop(); reject(err); } };

      if (typeof Peer !== "function") return fail(new Error("ספריית החיבור לא נטענה"));

      let idTries = 0;

      /* אורח: מנסה להתחבר שוב ושוב עד לפקיעת הזמן, כדי שגם מארח
         שחזר לאפליקציה כמה שניות מאוחר יותר עדיין ייתפס */
      const tryConnect = () => {
        if (settled || !this.peer || this.peer.destroyed) return;
        let conn;
        try { conn = this.peer.connect(hostId, { reliable: true }); } catch (_) { return; }
        if (!conn) return;
        conn.on("open", () => { this.attach(conn); done(); });
        conn.on("error", () => {});
      };

      const start = () => {
        try {
          this.peer = this.role === "host" ? new Peer(hostId, { debug: 0 }) : new Peer({ debug: 0 });
        } catch (_) {
          return fail(new Error("לא ניתן לפתוח חיבור"));
        }

        if (this.role === "host") {
          /* המארח מוכן ברגע שנרשם אצל המתווך — עוד לפני שהאורח הגיע */
          this.peer.on("open", done);
          this.peer.on("connection", conn => this.attach(conn));
        } else {
          this.peer.on("open", () => {
            tryConnect();
            this.retry = setInterval(tryConnect, 2000);
          });
        }

        this.peer.on("error", err => {
          const type = err && err.type;
          /* המארח עוד לא נרשם — ממשיכים לנסות עד לפקיעת הזמן */
          if (type === "peer-unavailable") return;
          /* הרישום הקודם של אותו חדר עוד לא שוחרר אצל המתווך */
          if (type === "unavailable-id" && this.role === "host" && ++idTries < PEER_ID_TRIES) {
            try { this.peer.destroy(); } catch (_) {}
            this.peer = null;
            setTimeout(() => { if (!settled) start(); }, 900);
            return;
          }
          fail(new Error(peerErrorText(type)));
        });

        /* ניתוק מהמתווך לא מפיל את החיבור הישיר — מנסים להירשם מחדש ברקע */
        this.peer.on("disconnected", () => {
          if (this.peer && !this.peer.destroyed) { try { this.peer.reconnect(); } catch (_) {} }
        });
      };

      start();
      setTimeout(() => fail(new Error(this.role === "guest"
        ? "לא נמצא חדר עם הקוד הזה"
        : "החיבור לא נענה בזמן")), PEER_TIMEOUT);
    });
  }

  attach(conn) {
    this.conn = conn;
    conn.on("data", d => {
      if (!d || d.from === this.id) return;
      this.onMessage(d);
    });
    conn.on("close", () => this.onStatus("closed"));
    conn.on("error", () => {});
  }

  isOpen() {
    if (!this.peer || this.peer.destroyed) return false;
    /* המארח נחשב פתוח כל עוד הוא רשום אצל המתווך, גם לפני שהאורח הגיע.
       האורח תלוי בחיבור עצמו — וכך הוא זה שיוזם חיבור-מחדש אם הוא נפל. */
    if (this.role === "guest") return !!(this.conn && this.conn.open);
    return true;
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(Object.assign({}, msg, { from: this.id })); } catch (_) {}
    }
  }

  close() {
    clearInterval(this.retry);
    this.retry = null;
    if (this.conn) { try { this.conn.close(); } catch (_) {} }
    if (this.peer) { try { this.peer.destroy(); } catch (_) {} }
    this.conn = null;
    this.peer = null;
  }
}

/* ---------- בחירת המנוע ----------
   ברירת המחדל היא PeerJS: עובד מכל מקום בלי חשבון ובלי שרת משלנו.
   Supabase נשאר זמין למי שמילא NET_CONFIG ומעדיף ערוץ מתווך.
   מצב מקומי הוא רשת ביטחון שתמיד עובדת בין לשוניות באותו דפדפן. */
let netForceLocal = false;
let netEngine = "peer";
const setForceLocal = v => { netForceLocal = Boolean(v); };
const setEngine = e => { netEngine = e === "supabase" ? "supabase" : "peer"; };

const peerReady = () => typeof Peer === "function";
const supabaseReady = () => Boolean(NET_CONFIG.url && NET_CONFIG.key);

function netConfigured() {
  if (netForceLocal) return false;
  return netEngine === "supabase" ? supabaseReady() : peerReady();
}

function makeTransport() {
  if (!netConfigured()) return new LocalTransport();
  return netEngine === "supabase" ? new SupabaseTransport() : new PeerTransport();
}
