"use strict";

/* ==========================================================================
   app.js — ממשק המשתמש ובקרת המשחק.
   השחקן הוא תמיד לבן ונע מנקודה 24 אל הבית (נקודות 1–6, ברביע הימני-תחתון).

   שלושה עקרונות שמנחים את הקובץ:
   1. חייל = אלמנט DOM קבוע. הרינדור מזיז אלמנטים קיימים ולא בונה מחדש,
      כדי שכל מהלך יתקבל כתנועה רציפה במקום קפיצה.
   2. הגאומטריה נגזרת מיחס הרוחב/גובה האמיתי של הלוח, כך שאותו קוד
      משרת לוח מאונך בטלפון ולוח רוחבי במסך גדול.
   3. התור מתקדם מעצמו: מהלך יחיד מתבצע בלחיצה אחת, תור כפוי משוחק
      אוטומטית, וסיום התור לא דורש אישור.
   ========================================================================== */

(function () {

  const $ = sel => document.querySelector(sel);
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const d6 = () => 1 + Math.floor(Math.random() * 6);

  /* קצב האנימציות — חייב להתאים ל-‎--move שב-CSS */
  const T = {
    move: 260,      // מעבר חייל
    settle: 130,    // נשימה קצרה אחרי מהלך
    aiThink: 320,   // "מחשבה" של המחשב
    aiStep: 300,    // בין מהלך למהלך של המחשב
    handoff: 620,   // מסירת התור לאחר סיום
    autoRoll: 480,  // השהיה לפני הטלה אוטומטית
  };

  const LEVEL_NAME = { easy: "רמה קלה", medium: "רמה בינונית", hard: "רמה קשה" };

  const AVATARS = ["🙂", "😎", "🦊", "🐼", "🐯", "🦉", "🐺", "🦁", "🐨", "🐸", "👑", "⚡"];

  /* ---------- סטטיסטיקה מצטברת (לכל שחקן בנפרד) ---------- */
  const Stats = {
    /* d מצביע תמיד על הסטטיסטיקה של הפרופיל הפעיל */
    get d() { return Profiles.active().stats; },

    blank() {
      return {
        games: 0, wins: 0, losses: 0,
        winKind: { 1: 0, 2: 0, 3: 0 },      // רגיל / מארס / מארס טורקי
        lossKind: { 1: 0, 2: 0, 3: 0 },
        byLevel: { easy: { g: 0, w: 0 }, medium: { g: 0, w: 0 }, hard: { g: 0, w: 0 } },
        turns: 0, rated: 0, forced: 0, scoreSum: 0,
        dist: {},
        bestGame: null, worstGame: null,
        hitsMade: 0, hitsTaken: 0,
        doubles: 0, borneOff: 0, barEntries: 0,
        streak: 0, bestStreak: 0,
        playMs: 0, draws: 0,
        pointsWon: 0, pointsLost: 0,   // ניקוד: רגיל 1, מארס 2, מארס טורקי 3
        vs: {},          // שם יריב -> { w, l, d }
      };
    },

    save() { Profiles.save(); },
    add(key, n = 1) { this.d[key] = (this.d[key] || 0) + n; },
    reset() {
      Object.assign(Profiles.active().stats, this.blank());
      Profiles.save();
    },

    /* נגזרות — מקבלות סטטיסטיקה כדי שאפשר יהיה לחשב גם לפרופיל אחר */
    winRate(s) { s = s || this.d; return s.games ? Math.round(s.wins / s.games * 100) : 0; },
    avgScore(s) { s = s || this.d; return s.rated ? Math.round(s.scoreSum / s.rated) : null; },
    avgTurns(s) { s = s || this.d; return s.games ? Math.round(s.turns / s.games) : 0; },
  };

  /* ---------- פרופילים ----------
     כל שחקן על המכשיר מקבל שם, סמל וסטטיסטיקה משלו. השם גם נשלח
     ליריב במשחק מקוון כדי שכל צד יראה מול מי הוא משחק. */
  const Profiles = {
    KEY: "shesh-besh-profiles-v1",
    OLD_STATS: "shesh-besh-stats-v1",
    d: null,

    make(name, avatar) {
      return {
        id: Math.random().toString(36).slice(2, 9),
        name: name || "שחקן",
        avatar: avatar || AVATARS[0],
        stats: Stats.blank(),
      };
    },

    load() {
      try {
        const raw = localStorage.getItem(this.KEY);
        if (raw) this.d = JSON.parse(raw);
      } catch (_) { /* אחסון חסום — ממשיכים בזיכרון בלבד */ }

      if (!this.d || !Array.isArray(this.d.list) || !this.d.list.length) {
        this.isNew = true;               // הפעלה ראשונה — נבקש שם לפני הכול
        const first = this.make("שחקן", AVATARS[0]);
        /* העברת הסטטיסטיקה מהגרסה שהייתה בלי פרופילים */
        try {
          const old = localStorage.getItem(this.OLD_STATS);
          if (old) Object.assign(first.stats, JSON.parse(old));
        } catch (_) {}
        this.d = { active: first.id, list: [first] };
        this.save();
      }
      /* השלמת שדות חסרים אחרי שדרוג גרסה */
      for (const p of this.d.list) p.stats = Object.assign(Stats.blank(), p.stats || {});
      if (!this.d.list.some(p => p.id === this.d.active)) this.d.active = this.d.list[0].id;
      return this.d;
    },

    save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.d)); } catch (_) {} },
    active() { return this.d.list.find(p => p.id === this.d.active) || this.d.list[0]; },
    setActive(id) { if (this.d.list.some(p => p.id === id)) { this.d.active = id; this.save(); } },
    add(name) { const p = this.make(name, AVATARS[this.d.list.length % AVATARS.length]); this.d.list.push(p); this.d.active = p.id; this.save(); return p; },
    remove(id) {
      if (this.d.list.length <= 1) return;
      this.d.list = this.d.list.filter(p => p.id !== id);
      if (!this.d.list.some(p => p.id === this.d.active)) this.d.active = this.d.list[0].id;
      this.save();
    },
    rename(id, name) { const p = this.d.list.find(x => x.id === id); if (p && name) { p.name = name.slice(0, 14); this.save(); } },
    cycleAvatar(id) {
      const p = this.d.list.find(x => x.id === id);
      if (!p) return;
      p.avatar = AVATARS[(AVATARS.indexOf(p.avatar) + 1) % AVATARS.length];
      this.save();
    },
  };
  Profiles.load();

  /* ---------- גאומטריה (אחוזים מתוך רוחב/גובה הלוח) ---------- */
  const GEO = {
    pad: 2.4,          // שוליים אופקיים של משטח המשחק
    padY: 2.6,
    pointW: 7.216,     // (100 - 2*2.4 - 8.6) / 12
    barW: 8.6,
    checkerD: 6.6,     // קוטר חייל באחוזי רוחב
    rowH: 41,          // גובה רביע באחוזי גובה
    AR: 1.6,           // רוחב/גובה בפועל — מתעדכן ב-ResizeObserver
  };
  GEO.leftQuadX = GEO.pad;
  GEO.barX = GEO.pad + 6 * GEO.pointW;
  GEO.rightQuadX = GEO.barX + GEO.barW;
  GEO.rightEdge = GEO.rightQuadX + 6 * GEO.pointW;

  /* גובה חייל, באחוזי גובה הלוח (כדי שיישאר עיגול מושלם) */
  const dh = () => GEO.checkerD * GEO.AR;

  /* ---------- נקודת המבט של הצופה ----------
     המצב עצמו תמיד קנוני (לבן נע 23→0), אבל מי שמשחק בשחור צריך לראות את
     הבית שלו למטה-מימין בדיוק כמו היריב. לכן כל הרינדור עובר דרך אינדקס
     "תצוגה", והקלט מתורגם בחזרה לאינדקס המודל. מול המחשב אין היפוך בכלל. */
  const flipped = () => Game.me === BLACK;
  const toView = i => (flipped() ? 23 - i : i);
  const toModel = v => (flipped() ? 23 - v : v);
  const isMine = color => color === Game.me;

  function pointX(vIdx) {
    let col, baseX;
    if (vIdx >= 12 && vIdx <= 17) { col = vIdx - 12; baseX = GEO.leftQuadX; }
    else if (vIdx >= 18) { col = vIdx - 18; baseX = GEO.rightQuadX; }
    else if (vIdx >= 6) { col = 11 - vIdx; baseX = GEO.leftQuadX; }
    else { col = 5 - vIdx; baseX = GEO.rightQuadX; }
    return baseX + col * GEO.pointW;
  }
  const isTopView = vIdx => vIdx >= 12;

  /* מיקום חייל מספר k מתוך n בנקודה (idx במונחי המודל) */
  function slotPos(idx, k, n) {
    const v = toView(idx);
    const D = dh();
    const left = pointX(v) + GEO.pointW / 2 - GEO.checkerD / 2;
    const maxSpan = GEO.rowH - D;
    const spacing = n <= 1 ? D : Math.min(D, maxSpan / (n - 1));
    const top = isTopView(v)
      ? GEO.padY + k * spacing
      : (100 - GEO.padY) - D - k * spacing;
    return { left, top };
  }

  function barSlotPos(color, k) {
    const D = dh();
    const left = GEO.barX + GEO.barW / 2 - GEO.checkerD / 2;
    const step = D * 0.62;
    return { left, top: isMine(color) ? 52 + k * step : 48 - D - k * step };
  }

  /* חיילים שהורדו מתכווצים לכיוון הרצועה של בעליהם (מעל/מתחת ללוח) */
  function offPos(color) {
    return {
      left: GEO.rightEdge - GEO.checkerD,
      top: isMine(color) ? 100 - GEO.padY - dh() : GEO.padY,
    };
  }

  /* ---------- צליל ורטט ----------
     החומרים בשש-בש הם עץ, עצם ולבד, ולכן כל הצלילים כאן נבנים מאותו
     אבן בניין: פרץ רעש קצר שעובר דרך מסנן פס — "קלאק" — עם גוף מצלצל
     נמוך שנותן לו חומר. ריבוי קלאקים בזמנים אקראיים נשמע כמו קוביות
     אמיתיות מתגלגלות, ושליחה קלה להדהוד מונעת את הצליל היבש. */
  const Sfx = {
    on: true, ctx: null, master: null, verb: null, noiseBuf: null,

    boot() {
      if (!this.on) return null;
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          const c = this.ctx = new AC();

          this.master = c.createGain();
          this.master.gain.value = 0.85;
          this.master.connect(c.destination);

          /* חדר קטן מסונתז — נותן לקליקים מקום במקום צליל שטוח */
          this.verb = c.createConvolver();
          this.verb.buffer = this.makeImpulse(0.26, 3.2);
          const wet = c.createGain();
          wet.gain.value = 0.18;
          this.verb.connect(wet).connect(this.master);

          this.noiseBuf = this.makeNoise(0.4);
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
        return this.ctx;
      } catch (_) { return null; }
    },

    makeNoise(sec) {
      const c = this.ctx, n = Math.floor(c.sampleRate * sec);
      const b = c.createBuffer(1, n, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    },

    makeImpulse(sec, decay) {
      const c = this.ctx, n = Math.floor(c.sampleRate * sec);
      const b = c.createBuffer(2, n, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
      return b;
    },

    /* פגיעה יחידה של חומר קשה */
    clack(t, o = {}) {
      const c = this.ctx;
      const gain = o.gain != null ? o.gain : 0.5;
      const dur = o.dur != null ? o.dur : 0.055;

      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 0.8 + Math.random() * 0.5;

      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = o.freq || 2200;
      bp.Q.value = o.q || 5;

      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      src.connect(bp).connect(g);
      g.connect(this.master);
      g.connect(this.verb);
      src.start(t, Math.random() * 0.2);
      src.stop(t + dur + 0.02);

      /* גוף נמוך שנותן תחושת מסה */
      if (o.body) {
        const osc = c.createOscillator(), og = c.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(o.body, t);
        osc.frequency.exponentialRampToValueAtTime(o.body * 0.55, t + dur * 1.2);
        og.gain.setValueAtTime(gain * 0.45, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.5);
        osc.connect(og);
        og.connect(this.master);
        og.connect(this.verb);
        osc.start(t); osc.stop(t + dur * 1.7);
      }
    },

    tone(t, freq, dur, gain, type) {
      const c = this.ctx;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.verb);
      o.start(t); o.stop(t + dur + 0.02);
    },

    /* גלגול: פגיעות שהולכות ומתקרבות זו לזו ונחלשות, כמו קוביות שנעצרות */
    roll() {
      const c = this.boot(); if (!c) return;
      const t0 = c.currentTime + 0.01;
      const n = 6 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const t = t0 + Math.pow(k, 0.62) * 0.5 + Math.random() * 0.02;
        const amp = 0.55 * (1 - k * 0.72);
        this.clack(t, {
          gain: amp,
          freq: 1500 + Math.random() * 1800,
          q: 3 + Math.random() * 6,
          dur: 0.035 + 0.035 * (1 - k),
          body: 200 + Math.random() * 220,
        });
      }
      buzz([6, 30, 8, 40, 10]);
    },

    place() {
      const c = this.boot(); if (!c) return;
      this.clack(c.currentTime + 0.005, { gain: 0.5, freq: 2500, q: 6, dur: 0.05, body: 340 });
      buzz(9);
    },

    /* רעש שמסונן דרך פס נע — משמש ל"שריקה" של החייל שנשלח לבר */
    swoop(t, from, to, dur, gain) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 7;
      bp.frequency.setValueAtTime(from, t);
      bp.frequency.exponentialRampToValueAtTime(to, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + dur * 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g);
      g.connect(this.master);
      g.connect(this.verb);
      src.start(t); src.stop(t + dur + 0.03);
    },

    /* בום נמוך עם צניחת גובה — המסה של הפגיעה */
    boom(t, from, to, dur, gain) {
      const c = this.ctx;
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.7);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },

    /* הכאה — האירוע הכי דרמטי במשחק, ולכן מורכב מארבע שכבות:
       פגיעה חדה, נקישה בהירה, בום נמוך, ושריקה יורדת של החייל שעף לבר. */
    hit() {
      const c = this.boot(); if (!c) return;
      const t = c.currentTime + 0.005;
      this.clack(t, { gain: 0.9, freq: 680, q: 2, dur: 0.16, body: 105 });
      this.clack(t + 0.014, { gain: 0.5, freq: 3100, q: 9, dur: 0.05 });
      this.boom(t, 190, 55, 0.34, 0.4);
      this.swoop(t + 0.05, 2800, 320, 0.3, 0.22);
      this.tone(t + 0.055, 174.6, 0.36, 0.05, "triangle");
      buzz([18, 40, 30, 55, 22]);
    },

    off() {
      const c = this.boot(); if (!c) return;
      const t = c.currentTime + 0.005;
      this.clack(t, { gain: 0.45, freq: 2700, q: 7, dur: 0.05, body: 430 });
      this.tone(t + 0.03, 1175, 0.16, 0.045, "sine");
      this.tone(t + 0.09, 1568, 0.2, 0.035, "sine");
    },

    win() {
      const c = this.boot(); if (!c) return;
      const t = c.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        this.tone(t + i * 0.1, f, 0.34, 0.07, "triangle");
        this.tone(t + i * 0.1, f * 2, 0.22, 0.022, "sine");
      });
    },

    lose() {
      const c = this.boot(); if (!c) return;
      const t = c.currentTime;
      [392, 329.63, 261.63].forEach((f, i) =>
        this.tone(t + i * 0.13, f, 0.4, 0.06, "triangle"));
    },

    /* טיק שקט לשניות האחרונות של הטיימר */
    tick(urgent) {
      const c = this.boot(); if (!c) return;
      this.clack(c.currentTime, { gain: urgent ? 0.3 : 0.16, freq: urgent ? 3200 : 2600, q: 12, dur: 0.03 });
    },
  };

  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} }

  /* ---------- מצב ---------- */
  const Game = {
    state: null,
    /* playerRoll → rolling → playerMove → committing → ai → playerRoll
       auto = תור כפוי שמשוחק לבד, blocked = אין מהלך אפשרי. בשניהם הקלט חסום. */
    phase: "idle",
    level: "medium",
    hints: true,
    autoRoll: true,
    startedAt: 0,
    rollTimer: null,
    turnSecs: 60,      // 0 = בלי טיימר
    timer: null,       // { until, who, raf, lastTick }
    mode: "cpu",       // cpu | online
    variant: "regular",// regular | turkish
    naturalDouble: false, // דאבל טבעי → תור נוסף (טורקי)
    turkishAction: null,  // swap | choose | relocate — תור שלא מדורג
    relocLeft: 0,      // כמה חיילים נותר להעביר בחוק 5-6
    me: WHITE,         // הצבע שהשחקן המקומי מזיז
    oppName: "מחשב",
    silentCoach: false,// מדרג ברקע בלי להציג כרטיס תוך כדי משחק
    net: null,         // { tr, role, room, ready, alive, hbTimer, watchTimer }
    dice: [], diceWho: null, diceUsed: [],
    turnStart: null, turnsResult: null,
    prefix: [], chunks: [],
    view: null,        // המצב המוצג (כולל מהלכים חלקיים בתור הנוכחי)
    options: [], sources: new Set(),
    selected: null,
    ratings: [], turnNumber: 0,
    log: [],           // כל תור: { color, dice, moves, before, after, rating }
    replay: null,      // { i } כשצופים בהקלטה
    coach: null,       // { r, tok, which } בזמן שידור חוזר של המאמן
    lastCoach: null,   // הדירוג האחרון שניתן להקיש עליו להסבר
    gen: 0,            // מבטל טיימרים ישנים אחרי "משחק חדש"
    toastTimer: null,
  };

  const boardEl = $("#board");
  const statusEl = $("#status-text");
  const rollBtn = $("#roll-btn");
  const undoBtn = $("#undo-btn");
  const confirmBtn = $("#confirm-btn");
  const ratingEl = $("#rating");

  let pieceLayer, diceLayer, pointEls = [], pnumEls = [], borneEls = {}, stripEls = {};
  /* מאגר חיילים קבוע: 15 לכל צבע. lastLoc = המיקום הלוגי בפריים הקודם. */
  const pool = { [WHITE]: [], [BLACK]: [] };
  let topPiece = new Map();   // loc -> האלמנט העליון בערימה

  /* ---------- בניית הלוח ---------- */
  function buildBoard() {
    boardEl.innerHTML = "";

    const field = document.createElement("div");
    field.className = "field";
    boardEl.appendChild(field);

    for (let idx = 0; idx < 24; idx++) {
      const p = document.createElement("div");
      p.style.width = GEO.pointW + "%";
      boardEl.appendChild(p);
      pointEls[idx] = p;

      const num = document.createElement("div");
      num.style.width = GEO.pointW + "%";
      boardEl.appendChild(num);
      pnumEls[idx] = num;
    }
    layoutPoints();

    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.left = GEO.barX + "%";
    bar.style.width = GEO.barW + "%";
    boardEl.appendChild(bar);

    diceLayer = document.createElement("div");
    boardEl.appendChild(diceLayer);

    pieceLayer = document.createElement("div");
    boardEl.appendChild(pieceLayer);

    for (const color of [WHITE, BLACK]) {
      pool[color] = [];
      for (let i = 0; i < 15; i++) {
        const el = document.createElement("div");
        el.className = "checker " + (color === WHITE ? "w" : "b");
        el.style.width = GEO.checkerD + "%";
        el.style.height = dh() + "%";
        const cnt = document.createElement("span");
        cnt.className = "cnt";
        el.appendChild(cnt);
        pieceLayer.appendChild(el);
        pool[color].push({ el, cnt, loc: null });
      }
    }

    borneEls.mine = buildBorne($("#borne-white"));
    borneEls.theirs = buildBorne($("#borne-black"));
    stripEls.mine = $("#strip-me");
    stripEls.theirs = $("#strip-ai");

    /* מגש ההורדה יושב מחוץ ללוח, ולכן צריך מאזין משלו כדי שאפשר יהיה
       להוריד חייל בלחיצה ולא רק בגרירה. */
    borneEls.mine.host.addEventListener("pointerdown", e => {
      if ((Game.phase !== "playerMove" && Game.phase !== "relocate") || !Game.selected) return;
      const chain = Game.selected.chains.find(c => c.dest === "off");
      if (!chain) return;
      e.preventDefault();
      applyChain(chain);
    });
  }

  /* ממקם את המשולשים ואת המספרים לפי נקודת המבט הנוכחית. נקרא מחדש
     כשמתחילים משחק בצד השני של הלוח. */
  function layoutPoints() {
    for (let idx = 0; idx < 24; idx++) {
      const v = toView(idx);
      const side = isTopView(v) ? "top" : "bottom";
      pointEls[idx].className = `point ${side} c${v % 2}`;
      pointEls[idx].style.left = pointX(v) + "%";
      pnumEls[idx].className = `pnum ${side}`;
      pnumEls[idx].style.left = pointX(v) + "%";
      pnumEls[idx].textContent = v + 1;      // מספור מנקודת מבט הצופה
    }
  }

  /* הרצועה והמגש של צבע מסוים: שלי תמיד למטה, של היריב למעלה */
  const stripOf = color => (isMine(color) ? stripEls.mine : stripEls.theirs);
  const borneOf = color => (isMine(color) ? borneEls.mine : borneEls.theirs);

  function buildBorne(host) {
    host.innerHTML = "";
    const pips = [];
    for (let i = 0; i < 15; i++) {
      const b = document.createElement("i");
      host.appendChild(b);
      pips.push(b);
    }
    return { host, pips };
  }

  /* הלוח מתאים את יחס הצלעות שלו לשטח הפנוי בפועל, ולכן הוא ממלא את המסך
     בכל מכשיר ובכל אוריינטציה במקום להסתמך על נקודות שבירה קבועות. */
  function fitBoard() {
    const a = $("#board-area").getBoundingClientRect();
    const w = a.width - 20, h = a.height - 8;   // מקביל ל-padding ב-CSS
    if (w <= 0 || h <= 0) return;

    /* יחס הצלעות עוקב אחרי השטח הפנוי, אך מוגבל לטווח שנראה כמו לוח אמיתי.
       כשההגבלה נכנסת לתוקף הלוח מוקטן כדי שימשיך להיכנס — בלי לדחוף
       את רצועות השחקנים אל מחוץ למסך. */
    /* התקרה 1.45 שומרת על פרופורציה של לוח אמיתי: מעליה ערימה של חמישה
       חיילים כבר לא נכנסת לאורך הנקודה והחיילים נערמים זה על זה. */
    const ar = Math.max(0.52, Math.min(1.45, w / h));
    let bw = w, bh = w / ar;
    if (bh > h) { bh = h; bw = h * ar; }
    boardEl.style.width = bw + "px";
    boardEl.style.height = bh + "px";

    const real = bw / bh;
    if (Math.abs(real - GEO.AR) < 0.004) return;

    GEO.AR = real;
    const hh = dh() + "%";
    for (const color of [WHITE, BLACK]) {
      for (const p of pool[color]) p.el.style.height = hh;
    }
    render();
  }

  /* ---------- רינדור ---------- */

  /* מיקומי היעד של כל 15 החיילים של צבע, לפי המצב */
  function targetSlots(s, color) {
    const slots = [];
    for (let i = 0; i < 24; i++) {
      const v = s.points[i];
      if (v === 0 || (v > 0 ? WHITE : BLACK) !== color) continue;
      const n = Math.abs(v);
      for (let k = 0; k < n; k++) slots.push({ loc: i, k, n });
    }
    const nb = s.bar[color];
    for (let k = 0; k < nb; k++) slots.push({ loc: "bar", k, n: nb });
    const no = s.off[color];
    for (let k = 0; k < no; k++) slots.push({ loc: "off", k, n: no });
    return slots;
  }

  /* משייך אלמנטים לחריצים תוך שימור מיקום קודם, כדי שרק החייל שזז יזוז */
  function assign(color, slots) {
    const byLoc = new Map();
    for (const sl of slots) {
      const key = String(sl.loc);
      if (!byLoc.has(key)) byLoc.set(key, []);
      byLoc.get(key).push(sl);
    }
    for (const arr of byLoc.values()) arr.sort((a, b) => a.k - b.k);

    const pieces = pool[color];
    const out = new Map();     // piece -> slot
    const free = [];

    for (const p of pieces) {
      const arr = p.loc !== null ? byLoc.get(String(p.loc)) : null;
      if (arr && arr.length) out.set(p, arr.shift());
      else free.push(p);
    }
    const leftovers = [];
    for (const arr of byLoc.values()) leftovers.push(...arr);
    leftovers.forEach((sl, i) => { if (free[i]) out.set(free[i], sl); });
    return out;
  }

  function render() {
    const s = Game.view || Game.state;
    if (!s || !pieceLayer) return;

    topPiece = new Map();

    for (const color of [WHITE, BLACK]) {
      const slots = targetSlots(s, color);
      const map = assign(color, slots);

      for (const p of pool[color]) {
        const sl = map.get(p);
        if (!sl) { p.el.classList.add("gone"); continue; }
        p.loc = sl.loc;

        let pos;
        if (sl.loc === "off") pos = offPos(color);
        else if (sl.loc === "bar") pos = barSlotPos(color, sl.k);
        else pos = slotPos(sl.loc, sl.k, sl.n);

        p.el.style.left = pos.left + "%";
        p.el.style.top = pos.top + "%";
        p.el.classList.toggle("gone", sl.loc === "off");
        p.el.style.zIndex = 5 + sl.k;

        const isTopOfStack = sl.k === sl.n - 1;
        const showCount = isTopOfStack && sl.n > 5 && sl.loc !== "off";
        p.cnt.textContent = showCount ? sl.n : "";

        /* רק החייל העליון בערימה נחשב "ניתן להזזה" */
        const movable = (Game.phase === "playerMove" || Game.phase === "relocate") && isMine(color) &&
          isTopOfStack && Game.sources.has(sl.loc);
        p.el.classList.toggle("movable", !!(movable && Game.hints));
        p.el.classList.remove("selected");
        if (isTopOfStack) topPiece.set(String(sl.loc), p);
      }
    }

    renderDice();
    renderSelection();
    renderHud(s);
  }

  function renderHud(s) {
    for (const color of [WHITE, BLACK]) {
      const n = s.off[color];
      borneOf(color).pips.forEach((b, i) => b.classList.toggle("on", i < n));
    }
    $("#pip-white").textContent = pipCount(s, Game.me);
    $("#pip-black").textContent = pipCount(s, -Game.me);

    const myTurn = ["playerMove", "playerRoll", "rolling", "auto", "blocked", "confirm"].includes(Game.phase);
    stripEls.mine.classList.toggle("active", myTurn);
    stripEls.theirs.classList.toggle("active", Game.phase === "ai" || Game.phase === "remote");
  }

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  function makeDie(value, xPct, yPct, wPct, opts = {}) {
    const el = document.createElement("div");
    el.className = "die" + (opts.ai ? " ai" : "") + (opts.used ? " used" : "") + (opts.throw ? " throw" : "");
    el.style.left = xPct + "%";
    el.style.top = yPct + "%";
    el.style.width = wPct + "%";
    el.style.height = wPct * GEO.AR + "%";
    const grid = document.createElement("div");
    grid.className = "grid";
    const on = PIPS[value] || [];
    for (let i = 0; i < 9; i++) {
      const d = document.createElement("span");
      d.className = "pip";
      if (on.includes(i)) d.style.visibility = "visible";
      grid.appendChild(d);
    }
    el.appendChild(grid);
    diceLayer.appendChild(el);
    return el;
  }

  function renderDice(throwAnim = false) {
    if (!diceLayer) return;
    diceLayer.innerHTML = "";
    if (!Game.dice.length || Game.phase === "over") return;

    const isDouble = Game.dice[0] === Game.dice[1];
    const values = isDouble ? [Game.dice[0], Game.dice[0], Game.dice[0], Game.dice[0]] : Game.dice.slice();

    /* גודל קובייה שמרגיש נכון גם בלוח מאונך צר וגם בלוח רוחבי */
    const base = Math.max(4.4, Math.min(11, 6.4 / GEO.AR));
    const w = isDouble ? base * 0.82 : base;

    const mine = isMine(Game.diceWho);
    const usedList = mine ? Game.prefix.map(m => m.die) : Game.diceUsed;
    const left = usedList.slice();
    const usedFlags = values.map(v => {
      const i = left.indexOf(v);
      if (i >= 0) { left.splice(i, 1); return true; }
      return false;
    });

    /* הקוביות נוחתות ברביע של מי שהטיל אותן — שלי מימין, של היריב משמאל */
    const quadCenter = mine
      ? GEO.rightQuadX + 3 * GEO.pointW
      : GEO.leftQuadX + 3 * GEO.pointW;
    const gap = w * 0.26;
    const totalW = values.length * w + (values.length - 1) * gap;
    const y = 50 - (w * GEO.AR) / 2;

    values.forEach((v, i) => {
      makeDie(v, quadCenter - totalW / 2 + i * (w + gap), y, w, {
        ai: !mine,
        used: usedFlags[i],
        throw: throwAnim,
      });
    });
  }

  function clearMarks() {
    diceLayer.parentNode.querySelectorAll(".dest").forEach(el => el.remove());
    pointEls.forEach(p => p.classList.remove("dest-hl", "src-hl"));
    borneEls.mine.host.classList.remove("target");
  }

  function renderSelection() {
    clearMarks();
    if (!Game.selected) return;
    const s = Game.view;
    const src = topPiece.get(String(Game.selected.from));
    if (src) src.el.classList.add("selected");

    for (const ch of Game.selected.chains) {
      if (ch.dest === "off") { borneEls.mine.host.classList.add("target"); continue; }
      const idx = ch.dest;
      pointEls[idx].classList.add("dest-hl");
      const n = Math.abs(s.points[idx]);
      const isHit = s.points[idx] === -Game.me;   // בדיוק חייל יריב אחד
      const k = isHit ? 0 : n;
      const pos = slotPos(idx, Math.min(k, 4), Math.max(k + 1, 1));
      const mk = document.createElement("div");
      mk.className = "dest" + (isHit ? " hit" : "");
      mk.style.left = pos.left + "%";
      mk.style.top = pos.top + "%";
      mk.style.width = GEO.checkerD + "%";
      mk.style.height = dh() + "%";
      mk.dataset.dest = idx;
      pieceLayer.appendChild(mk);
    }
  }

  /* ---------- טקסט ---------- */

  function status(html) { statusEl.innerHTML = html; }

  function moveHtml(m) {
    const hit = m.hit ? " ✕" : "";
    if (m.from === "bar") return `כניסה ל־${m.to + 1}${hit}`;
    if (m.to === "off") return `הורדה מ־${m.from + 1}`;
    return `<span dir="ltr">${m.from + 1}→${m.to + 1}</span>${hit}`;
  }
  const movesHtml = ms => ms.map(moveHtml).join(" · ");

  function updateButtons() {
    /* בהטלה אוטומטית הכפתור מיותר ורק מהבהב לרגע — עדיף להסתיר אותו */
    rollBtn.hidden = !(Game.phase === "playerRoll") || Game.autoRoll;
    confirmBtn.hidden = Game.phase !== "confirm";
    /* ביטול זמין כל עוד התור לא אושר, כולל בשלב האישור וההעברה */
    undoBtn.hidden = !(Game.prefix.length > 0 &&
      (Game.phase === "playerMove" || Game.phase === "confirm" || Game.phase === "relocate"));
  }

  /* ---------- זרימת המשחק ---------- */

  function newGame() {
    Game.gen++;
    Game.turkishAction = null; Game.naturalDouble = false;
    Game.state = initialState();
    Game.view = Game.state;
    Game.ratings = []; Game.log = []; Game.replay = null;
    Game.coach = null; Game.lastCoach = null;
    Game.turnNumber = 0;
    Game.dice = []; Game.diceWho = null; Game.diceUsed = [];
    Game.prefix = []; Game.chunks = [];
    Game.options = []; Game.sources = new Set();
    Game.selected = null;
    Game.phase = "playerRoll";
    Game.startedAt = Date.now();
    stopTimer();
    clearTimeout(Game.rollTimer);
    hideToast(); hideModal(); hideSheet();
    updateAvgChip();
    updateButtons();
    render();
    status(Game.autoRoll ? "מתחילים" : "תורך לפתוח — <b>הטל קוביות</b>");
    armAutoRoll();
  }

  /* כל טיימר בודק שהדור לא התחלף (למשל אחרי "משחק חדש") */
  function stale(g) { return g !== Game.gen; }

  async function playerRoll() {
    if (Game.phase !== "playerRoll") return;
    const g = Game.gen;
    Game.phase = "rolling";
    hideToast();          // הדירוג מלווה את תור המחשב ונעלם כשחוזרים לשחק
    updateButtons();
    Sfx.roll();

    const dice = [d6(), d6()];
    if (dice[0] === dice[1]) Stats.add("doubles");
    Game.dice = dice;
    Game.diceWho = Game.me;
    Game.prefix = [];
    /* מודיעים על ההטלה מיד, כדי שהיריב יראה את הקוביות בזמן שאני חושב */
    if (Game.mode === "online") netSend({ t: "roll", dice: dice.slice() });
    renderDice(true);
    await delay(T.move);
    if (stale(g)) return;

    startPlayerTurn(dice);
  }

  /* מפזר את הזריקה: בטורקי חלק מהזריקות מפעילות חוק מיוחד, אחרת מהלך רגיל */
  function startPlayerTurn(dice) {
    const g = Game.gen;
    Game.turkishAction = null;
    Game.naturalDouble = false;
    if (Game.variant === "turkish") {
      const kind = classifyRoll(dice);
      if (kind === "swap") return humanSwap(g, dice);
      if (kind === "choose") return humanChooseDouble(g, dice);
      if (kind === "relocate") return humanRelocate(g, dice);
      if (kind === "double") Game.naturalDouble = true;
    }
    beginMoveTurn(dice, g);
  }

  function beginMoveTurn(dice, g) {
    Game.dice = dice;             // דאבל נבחר (3-4) מעדכן את הקוביות המוצגות
    Game.diceWho = Game.me;
    Game.turnStart = Game.state;
    Game.view = Game.state;
    Game.prefix = []; Game.chunks = [];
    Game.selected = null;
    Game.turnNumber++;
    Game.turnsResult = generateTurns(Game.state, Game.me, dice);
    Game.phase = "playerMove";
    refreshOptions();

    if (Game.turnsResult.maxLen === 0) {
      Game.phase = "blocked";
      stopTimer();
      status(`יצא <b>${dice[0]}-${dice[1]}</b> — אין מהלך אפשרי`);
      updateButtons(); render();
      setTimeout(() => { if (!stale(g)) endPlayerTurn(true); }, 1250);
      return;
    }

    /* תור כפוי — משחקים אותו לבד במקום להכריח לחיצה חסרת משמעות */
    const finals = uniqueFinalStates(Game.turnsResult);
    if (finals.length === 1) {
      status(`יצא <b>${dice[0]}-${dice[1]}</b> — מהלך יחיד אפשרי`);
      updateButtons(); render();
      autoPlay(finals[0].moves, g);
      return;
    }

    startTimer(Game.me);
    const dbl = dice[0] === dice[1] ? " דאבל — ארבעה מהלכים!" : "";
    const hint = Game.state.bar[Game.me] > 0
      ? "יש לך חייל על הבר — חובה להכניס אותו"
      : "בחר חייל";
    status(`יצא <b>${dice[0]}-${dice[1]}</b>.${dbl} ${hint}`);
    updateButtons();
    render();
  }

  /* ==================== שש-בש טורקי — חוקים מיוחדים ==================== */

  /* מחליף איזה צבע כל שחקן מזיז. הלוח לא זז — רק ההגדרה מי מוביל מה,
     והתצוגה מסתובבת לצד של הצבע החדש. */
  function performSwap() {
    Game.me = -Game.me;
    layoutPoints();
    applyStripColors();
    render();
  }

  /* מבצע את ההחלפה באיטיות ומודגש, כדי ששני השחקנים יראו את הלוח מסתובב:
     כרזה במרכז + החלקה איטית של החיילים למקומם החדש. */
  function animateSwap(g, done) {
    showSwapFlash();
    boardEl.classList.add("swapping");        // מאט את מעבר החיילים ל-720ms
    performSwap();
    setTimeout(() => {
      boardEl.classList.remove("swapping");
      if (!stale(g) && done) done();
    }, 1000);
  }

  function showSwapFlash() {
    const old = boardEl.querySelector(".swap-flash");
    if (old) old.remove();
    const el = document.createElement("div");
    el.className = "swap-flash";
    el.innerHTML = `<span class="swap-ico">🔄</span><span>מחליפים צדדים</span>`;
    boardEl.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  function applyStripColors() {
    const meAv = $("#strip-me .avatar"), oppAv = $("#strip-ai .avatar");
    if (!meAv || !oppAv) return;
    meAv.classList.toggle("w", Game.me === WHITE);
    meAv.classList.toggle("b", Game.me === BLACK);
    oppAv.classList.toggle("w", Game.me === BLACK);
    oppAv.classList.toggle("b", Game.me === WHITE);
  }

  /* 1-2: אני מחליף צדדים, התור עובר ליריב */
  function humanSwap(g, dice) {
    Game.turkishAction = "swap";
    Game.dice = dice; Game.diceWho = Game.me; Game.diceUsed = [];
    Game.phase = "auto";
    stopTimer(); updateButtons(); render(); renderDice(true);
    Sfx.roll();
    status("יצא <b>1-2</b> — מחליפים צדדים! 🔄");
    if (Game.mode === "online") netSend({ t: "swap" });
    setTimeout(() => {
      if (stale(g)) return;
      Sfx.hit();
      animateSwap(g, () => {
        setTimeout(() => {
          if (stale(g)) return;
          if (Game.mode === "online") {
            Game.phase = "remote"; render();
            status("החלפת צדדים — ממתין ליריב…");
            startTimer(-Game.me);
          } else {
            Game.phase = "ai"; render(); aiTurn();
          }
        }, 700);
      });
    }, 950);
  }

  /* 3-4: השחקן בוחר דאבל */
  function humanChooseDouble(g, dice) {
    Game.dice = dice; Game.diceWho = Game.me; Game.diceUsed = [];
    Game.phase = "choosing";
    stopTimer(); updateButtons(); render(); renderDice(true);
    status("יצא <b>3-4</b> — בחר איזה דאבל לשחק");
    Sfx.roll();
    showDoubleChooser(die => {
      if (stale(g)) return;
      Game.turkishAction = "choose";
      Game.naturalDouble = false;   // דאבל נבחר אינו מזכה בתור נוסף
      beginMoveTurn([die, die], g);
    });
  }

  /* 5-6: השחקן מעביר שני חיילים לכל מקום פנוי */
  function humanRelocate(g, dice) {
    Game.turkishAction = "relocate";
    Game.turnStart = Game.state;
    Game.view = Game.state;
    Game.dice = dice; Game.diceWho = Game.me; Game.diceUsed = [];
    Game.prefix = []; Game.chunks = [];
    Game.selected = null;
    Game.turnNumber++;
    Game.relocLeft = 2;
    Game.phase = "relocate";
    refreshRelocate();
    startTimer(Game.me);
    status("יצא <b>5-6</b> — בחר חייל והעבר אותו לכל מקום (2 חיילים)");
    updateButtons();
    render();
  }

  function refreshRelocate() {
    const s = Game.view;
    const src = new Set();
    if (Game.relocLeft > 0) {
      if (s.bar[Game.me] > 0) src.add("bar");
      for (let i = 0; i < 24; i++) if (ownCount(s, i, Game.me) > 0) src.add(i);
    }
    Game.sources = src;
    /* applyChain בודק את אורך options כדי לדעת אם התור נגמר */
    Game.options = Game.relocLeft > 0 ? [{ relocate: true }] : [];
  }

  async function autoPlay(moves, g) {
    Game.phase = "auto";          // חוסם קלט בזמן שהמהלך הכפוי משוחק
    stopTimer();
    updateButtons();
    for (const m of moves) {
      await delay(T.aiStep);
      if (stale(g)) return;
      commitMove(m);
      render();
      Sfx.place();
    }
    await delay(T.move + T.settle);
    if (!stale(g)) endPlayerTurn(false);
  }

  function refreshOptions() {
    if (Game.phase === "relocate") { refreshRelocate(); return; }
    if (!Game.turnsResult) { Game.options = []; Game.sources = new Set(); return; }
    Game.options = nextMoveOptions(Game.turnsResult, Game.prefix);
    Game.sources = new Set(Game.options.map(m => m.from));
  }

  function commitMove(m) {
    if (m.hit) Stats.add("hitsMade");
    if (m.to === "off") Stats.add("borneOff");
    if (m.from === "bar") Stats.add("barEntries");
    Game.view = applyMove(Game.view, Game.me, m).state;
    Game.prefix.push(m);
    refreshOptions();
  }

  function applyChain(chain) {
    const relocating = Game.phase === "relocate";
    for (const m of chain.moves) commitMove(m);
    Game.chunks.push(chain.moves.length);
    Game.selected = null;
    if (relocating) Game.relocLeft -= chain.moves.length;

    const hit = chain.moves.some(m => m.hit);
    const bore = chain.moves.some(m => m.to === "off");
    if (relocating) refreshRelocate();
    updateButtons();
    render();
    if (hit) {
      Sfx.hit();
      const h = chain.moves.find(m => m.hit);
      flashHit(h && h.to);
    } else if (bore) Sfx.off(); else Sfx.place();

    if (Game.options.length === 0) {
      /* התור לא נסגר מעצמו — נותנים הזדמנות אחרונה לבטל ולחשוב מחדש */
      Game.phase = "confirm";
      updateButtons();
      status("סיימת את המהלכים — <b>סיים תור</b> לאישור");
    } else if (relocating) {
      status(`נותר להעביר עוד חייל אחד`);
    } else {
      status(`נותרו מהלכים — ${Game.options.length === 1 ? "מהלך אחד" : "בחר חייל"}`);
    }
  }

  function undoChunk() {
    if (!Game.chunks.length) return;
    const reloc = Game.turkishAction === "relocate";
    Game.prefix.length -= Game.chunks.pop();
    let s = Game.turnStart;
    for (const m of Game.prefix) s = applyMove(s, Game.me, m).state;
    Game.view = s;
    Game.selected = null;
    if (reloc) {
      Game.relocLeft = 2 - Game.prefix.length;
      Game.phase = "relocate";
      refreshRelocate();
    } else {
      if (Game.phase === "confirm") Game.phase = "playerMove";
      refreshOptions();
    }
    updateButtons();
    render();
    status(reloc ? "בוטל — בחר חייל להעברה" : "בוטל — נסה שוב");
  }

  function endPlayerTurn(noMoves) {
    const g = Game.gen;
    Game.state = Game.view;
    Game.selected = null;
    Game.phase = Game.mode === "online" ? "remote" : "ai";
    stopTimer();
    updateButtons();
    clearMarks();

    Stats.add("turns");
    const entry = {
      color: Game.me, dice: Game.dice.slice(), moves: Game.prefix.slice(),
      before: Game.turnStart, after: Game.state, rating: null,
    };
    Game.log.push(entry);

    /* בטורקי אין דירוג לזריקות המיוחדות — ההיוריסטיקה לא מבינה אותן */
    if (!noMoves && !Game.turkishAction) {
      const r = rateTurn(Game.turnStart, Game.me, Game.dice, Game.state);
      if (!r.noMoves) {
        entry.rating = r;
        r.turn = Game.turnNumber;
        r.dice = Game.dice.slice();
        /* הקשר לשידור החוזר של המאמן: המצב לפני, המהלך שלי, והמהלך המומלץ */
        r.before = Game.turnStart;
        r.myMoves = entry.moves;
        r.myAfter = Game.state;
        r.color = Game.me;
        Game.ratings.push(r);
        if (r.forced) {
          Stats.add("forced");
        } else {
          Stats.add("rated");
          Stats.add("scoreSum", r.score);
          Stats.d.dist[r.grade.cls] = (Stats.d.dist[r.grade.cls] || 0) + 1;
        }
        /* מול חבר המאמן שותק תוך כדי משחק — הציון נאסף ומוצג רק בסיום */
        if (!Game.silentCoach) showToast(r);
        updateAvgChip();
      }
    }
    Stats.save();
    render();

    const extra = Game.naturalDouble && Game.variant === "turkish";
    if (Game.mode === "online") {
      netSend({ t: "turn", dice: Game.dice.slice(), moves: Game.prefix.slice(), again: extra });
    }
    if (winner(Game.state) === Game.me) return gameOver(Game.me);

    /* דאבל טבעי → אני זורק שוב, במקום למסור את התור */
    if (extra) {
      status("דאבל! תור נוסף 🎲");
      setTimeout(() => { if (!stale(g)) playerRollPhase(); }, T.handoff);
      return;
    }

    if (Game.mode === "online") {
      status("ממתין ליריב…");
      startTimer(-Game.me);
      return;
    }
    setTimeout(() => { if (!stale(g)) aiTurn(); }, noMoves ? 400 : T.handoff);
  }

  /* מריץ תור של הצד השני — בין אם המחשב בחר אותו ובין אם הגיע מהרשת.
     opts: { preRolled, again, action } — action מסמן זריקה טורקית מיוחדת. */
  async function playOpponentTurn(dice, moves, g, label, opts = {}) {
    const opp = -Game.me;
    const before = Game.state;
    stopTimer();
    Game.phase = Game.mode === "online" ? "remote" : "ai";
    Game.dice = dice;
    Game.diceWho = opp;
    Game.diceUsed = [];
    updateButtons();
    render();

    const intro = opts.action === "relocate" ? `${label} הוציא 5-6 והעביר חיילים`
      : opts.action === "choose" ? `${label} בחר דאבל ${dice[0]}`
      : `${label} הטיל <b>${dice[0]}-${dice[1]}</b>`;

    if (!opts.preRolled) {
      renderDice(true);
      Sfx.roll();
      status(intro);
      await delay(T.aiThink);
    } else {
      await delay(160);
    }
    if (stale(g)) return;

    if (!moves.length) {
      status(`${label} הטיל <b>${dice[0]}-${dice[1]}</b> — אין לו מהלך`);
      await delay(1100);
      if (!stale(g)) afterOpponentTurn(opp, opts, g);
      return;
    }

    for (const m of moves) {
      await delay(T.aiStep);
      if (stale(g)) return;
      Game.state = applyMove(Game.state, opp, m).state;
      Game.view = Game.state;
      Game.diceUsed.push(m.die);
      render();
      if (m.hit) { Stats.add("hitsTaken"); Sfx.hit(); flashHit(m.to); } else Sfx.place();
    }
    await delay(T.move);
    if (stale(g)) return;

    Game.log.push({ color: opp, dice: dice.slice(), moves: moves.slice(), before, after: Game.state, rating: null });

    const hit = moves.some(m => m.hit);
    status(`${label} שיחק ${movesHtml(moves)}${hit ? " — הכה אותך" : ""}`);
    if (winner(Game.state) === opp) return gameOver(opp);
    afterOpponentTurn(opp, opts, g);
  }

  /* לאחר תור היריב: דאבל טבעי מזכה אותו בתור נוסף, אחרת התור עובר אליי */
  function afterOpponentTurn(opp, opts, g) {
    if (opts.again) {
      if (Game.mode === "online") {
        status(`${Game.oppName} קיבל תור נוסף (דאבל)`);
        return;                     // נשארים ב-remote וממתינים לזריקה הבאה שלו
      }
      status(`${Game.oppName} קיבל תור נוסף!`);
      setTimeout(() => { if (!stale(g)) aiTurn(); }, T.handoff);
      return;
    }
    playerRollPhase();
  }

  async function aiTurn() {
    const g = Game.gen;
    const dice = [d6(), d6()];

    if (Game.variant === "turkish") {
      const kind = classifyRoll(dice);
      if (kind === "swap") return aiSwap(g, dice);
      if (kind === "choose") {
        const pick = aiChooseDouble(Game.state, -Game.me);
        const tr = generateTurns(Game.state, -Game.me, [pick.die, pick.die]);
        const moves = tr.maxLen === 0 ? [] : chooseAiTurn(Game.state, -Game.me, [pick.die, pick.die], Game.level, tr).moves;
        return playOpponentTurn([pick.die, pick.die], moves, g, "המחשב", { action: "choose" });
      }
      if (kind === "relocate") {
        const rel = aiRelocate(Game.state, -Game.me);
        return playOpponentTurn([5, 6], rel.moves, g, "המחשב", { action: "relocate" });
      }
      if (kind === "double") {
        const tr = generateTurns(Game.state, -Game.me, dice);
        const moves = tr.maxLen === 0 ? [] : chooseAiTurn(Game.state, -Game.me, dice, Game.level, tr).moves;
        return playOpponentTurn(dice, moves, g, "המחשב", { again: true });
      }
    }

    const tr = generateTurns(Game.state, -Game.me, dice);
    const moves = tr.maxLen === 0 ? [] : chooseAiTurn(Game.state, -Game.me, dice, Game.level, tr).moves;
    await playOpponentTurn(dice, moves, g, "המחשב");
  }

  /* המחשב הוציא 1-2 — מציג את הקוביות, מחליף צדדים, והתור עובר אליי */
  async function aiSwap(g, dice) {
    Game.phase = "ai";
    Game.dice = dice; Game.diceWho = -Game.me; Game.diceUsed = [];
    render(); renderDice(true); Sfx.roll();
    status(`${Game.oppName} הוציא <b>1-2</b> — מחליף צדדים! 🔄`);
    await delay(T.aiThink + 600);
    if (stale(g)) return;
    Sfx.hit();
    await new Promise(res => animateSwap(g, res));
    if (stale(g)) return;
    await delay(700);
    if (stale(g)) return;
    playerRollPhase();
  }

  /* ---------- טיימר תור ----------
     רץ עבור שני הצדדים כדי שאפשר יהיה לראות מי משתהה, אבל אוכף רק את
     התור שלי: כשהזמן נגמר המנוע בוחר במקומי ומסיים את התור. */

  function stopTimer() {
    if (Game.timer && Game.timer.raf) cancelAnimationFrame(Game.timer.raf);
    Game.timer = null;
    for (const el of [stripEls.mine, stripEls.theirs]) {
      if (!el) continue;
      el.classList.remove("timing", "urgent");
      el.style.removeProperty("--t");
    }
  }

  function startTimer(who) {
    stopTimer();
    if (!Game.turnSecs || Game.phase === "over") return;
    const g = Game.gen;
    Game.timer = { until: Date.now() + Game.turnSecs * 1000, who, raf: 0, lastTick: 99 };
    const strip = stripOf(who);
    strip.classList.add("timing");

    const step = () => {
      if (!Game.timer || stale(g)) return;
      const left = (Game.timer.until - Date.now()) / 1000;
      const frac = Math.max(0, Math.min(1, left / Game.turnSecs));
      strip.style.setProperty("--t", frac);
      const secs = Math.ceil(Math.max(0, left));
      strip.classList.toggle("urgent", secs <= 10);

      if (secs <= 5 && secs !== Game.timer.lastTick && secs > 0 && isMine(who)) {
        Game.timer.lastTick = secs;
        Sfx.tick(secs <= 3);
      }
      if (left <= 0) { const w = who; stopTimer(); onTimeout(w); return; }
      Game.timer.raf = requestAnimationFrame(step);
    };
    step();
  }

  function onTimeout(who) {
    if (!isMine(who)) {
      /* היריב איטי — רק מודיעים, לא מחליטים בשבילו */
      status(`${Game.oppName} לוקח את הזמן…`);
      return;
    }
    const g = Game.gen;
    if (Game.phase === "playerRoll") { playerRoll(); return; }
    if (Game.phase === "confirm") { endPlayerTurn(false); return; }

    /* בטורקי, אם נגמר הזמן בזמן העברה חופשית — המנוע משלים אותה */
    if (Game.phase === "relocate") {
      Game.prefix = []; Game.chunks = [];
      Game.view = Game.turnStart;
      Game.selected = null;
      status("נגמר הזמן — ההעברה נבחרה אוטומטית");
      const rel = aiRelocate(Game.turnStart, Game.me);
      autoPlay(rel.moves, g);
      return;
    }
    if (Game.phase !== "playerMove") return;

    /* מחזירים את התור להתחלה ונותנים למנוע לבחור — עדיף מלהשאיר תור חצי־מוזז */
    Game.prefix = []; Game.chunks = [];
    Game.view = Game.turnStart;
    Game.selected = null;
    refreshOptions();
    status("נגמר הזמן — המהלך נבחר אוטומטית");
    const choice = chooseAiTurn(Game.turnStart, Game.me, Game.dice, "medium", Game.turnsResult);
    autoPlay(choice.moves, g);
  }

  /* מדגיש את החייל שהוכה בזמן שהוא עף אל הבר, ומשאיר הבזק במקום הפגיעה */
  function flashHit(atIdx) {
    const p = topPiece.get("bar");
    if (p) {
      p.el.classList.add("flying");
      setTimeout(() => p.el && p.el.classList.remove("flying"), T.move + 220);
    }
    if (atIdx == null || atIdx === "bar" || atIdx === "off") return;
    const n = Math.abs((Game.view || Game.state).points[atIdx]) || 1;
    const pos = slotPos(atIdx, n - 1, n);
    const spark = document.createElement("div");
    spark.className = "spark";
    spark.style.left = pos.left + "%";
    spark.style.top = pos.top + "%";
    spark.style.width = GEO.checkerD + "%";
    spark.style.height = dh() + "%";
    pieceLayer.appendChild(spark);
    setTimeout(() => spark.remove(), 520);
  }

  function playerRollPhase() {
    Game.phase = "playerRoll";
    Game.selected = null;
    updateButtons();
    render();
    status(Game.autoRoll ? "תורך" : "תורך — <b>הטל קוביות</b>");
    armAutoRoll();
  }

  /* מטיל לבד אחרי רגע קצר, כדי שהמעבר בין התורות יישאר קריא */
  function armAutoRoll() {
    clearTimeout(Game.rollTimer);
    if (!Game.autoRoll || Game.phase !== "playerRoll") return;
    const g = Game.gen;
    Game.rollTimer = setTimeout(() => {
      if (!stale(g) && Game.phase === "playerRoll") playerRoll();
    }, T.autoRoll);
  }

  /* ---------- אינטראקציה ---------- */

  let drag = null;

  function pct(e) {
    const r = boardEl.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 };
  }

  /* הפגיעה היא בעמודת הנקודה כולה, לא רק בחייל — קריטי במסך טלפון */
  function hitTest(x, y) {
    if (x >= GEO.barX && x <= GEO.barX + GEO.barW) return { loc: "bar" };
    let col = -1, base = null;
    if (x >= GEO.leftQuadX && x < GEO.barX) { base = "L"; col = Math.floor((x - GEO.leftQuadX) / GEO.pointW); }
    else if (x >= GEO.rightQuadX && x <= GEO.rightEdge) { base = "R"; col = Math.floor((x - GEO.rightQuadX) / GEO.pointW); }
    if (col < 0 || col > 5) return null;
    const top = y < 50;
    const v = top ? (base === "L" ? 12 + col : 18 + col)
                  : (base === "L" ? 11 - col : 5 - col);
    return { loc: toModel(v) };   // חזרה למונחי המודל
  }

  /* מגש ההורדה יושב מחוץ ללוח, ולכן נבדק מול הקואורדינטות במסך */
  function overBearOff(e) {
    if (!Game.selected || !Game.selected.chains.some(c => c.dest === "off")) return false;
    const r = borneEls.mine.host.getBoundingClientRect();
    const pad = 14;
    return e.clientX >= r.left - pad && e.clientX <= r.right + pad &&
           e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
  }

  /* בהעברה חופשית (5-6): כל נקודה פנויה היא יעד חוקי מכל מקור נבחר,
     ובשלב ההוצאה אפשר גם פשוט להוריד את החייל מהלוח (יעד "off"). */
  function relocateChainsFrom(from) {
    const s = Game.view;
    const chains = [];
    for (let i = 0; i < 24; i++) {
      if (i === from || isBlocked(s, i, Game.me)) continue;
      const hit = s.points[i] === -Game.me;
      chains.push({ dest: i, moves: [{ from, to: i, die: 0, relocate: true, hit }] });
    }
    if (from !== "bar" && allInHome(s, Game.me)) {
      chains.push({ dest: "off", moves: [{ from, to: "off", die: 0, relocate: true }] });
    }
    return chains;
  }

  const chainsFor = from =>
    Game.phase === "relocate" ? relocateChainsFrom(from)
      : chainOptionsFrom(Game.turnsResult, Game.prefix, from);

  function selectSource(from) {
    const chains = chainsFor(from);
    if (!chains.length) return;
    /* יעד יחיד — אין טעם לבקש לחיצה שנייה */
    if (chains.length === 1) { applyChain(chains[0]); return; }
    Game.selected = { from, chains };
    renderSelection();
    const src = topPiece.get(String(from));
    if (src) src.el.classList.add("selected");
  }

  function onPointerDown(e) {
    Sfx.boot();

    if (Game.phase === "playerRoll") { playerRoll(); return; }
    if (Game.phase !== "playerMove" && Game.phase !== "relocate") return;

    const p = pct(e);
    const ht = hitTest(p.x, p.y);

    /* לחיצה על יעד מסומן */
    if (Game.selected && ht) {
      const chain = Game.selected.chains.find(c => c.dest === ht.loc);
      if (chain) { applyChain(chain); return; }
    }

    /* לחיצה על מקור אפשרי — כולל תחילת גרירה */
    if (ht && Game.sources.has(ht.loc)) {
      const from = ht.loc;
      if (Game.selected && Game.selected.from === from) { Game.selected = null; renderSelection(); return; }
      const piece = topPiece.get(String(from));
      drag = { from, piece, startX: p.x, startY: p.y, moved: false, chains: chainsFor(from) };
      try { boardEl.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      return;
    }

    if (Game.selected) { Game.selected = null; renderSelection(); }
  }

  function onPointerMove(e) {
    if (!drag) return;
    const p = pct(e);
    if (!drag.moved && Math.hypot(p.x - drag.startX, (p.y - drag.startY) / GEO.AR) > 1.2) {
      drag.moved = true;
      Game.selected = { from: drag.from, chains: drag.chains };
      renderSelection();
      if (drag.piece) drag.piece.el.classList.add("dragging");
    }
    if (drag.moved && drag.piece) {
      drag.piece.el.style.left = (p.x - GEO.checkerD / 2) + "%";
      drag.piece.el.style.top = (p.y - dh() / 2) + "%";
      borneEls.mine.host.classList.toggle("target",
        Game.selected.chains.some(c => c.dest === "off") && overBearOff(e));
    }
  }

  function onPointerUp(e) {
    if (!drag) return;
    const cur = drag;
    drag = null;
    try { boardEl.releasePointerCapture(e.pointerId); } catch (_) {}
    if (cur.piece) cur.piece.el.classList.remove("dragging");

    if (!cur.moved) { selectSource(cur.from); return; }

    Game.selected = { from: cur.from, chains: cur.chains };
    let chain = null;
    if (overBearOff(e)) chain = cur.chains.find(c => c.dest === "off") || null;
    if (!chain) {
      const p = pct(e);
      const ht = hitTest(p.x, p.y);
      if (ht) chain = cur.chains.find(c => c.dest === ht.loc) || null;
    }
    Game.selected = null;
    if (chain) applyChain(chain);
    else render();
  }

  /* ---------- כרטיס הדירוג ---------- */

  function showToast(r) {
    clearTimeout(Game.toastTimer);
    ratingEl.className = r.forced ? "g-forced" : r.grade.cls;
    $("#rating-score").textContent = r.forced ? "✓" : r.score;
    $("#rating-grade").textContent = r.forced ? "מהלך כפוי" : `${r.grade.label} · ${r.score}`;
    $("#rating-expl").textContent = r.explanation;
    const best = $("#rating-best");
    if (r.bestMoves) { best.innerHTML = "עדיף היה: " + movesHtml(r.bestMoves); best.hidden = false; }
    else best.hidden = true;

    /* מול המחשב, כשיש מהלך טוב יותר — אפשר להקיש כדי לראות אותו בשידור חוזר */
    if (coachAvailable(r)) {
      Game.lastCoach = r;
      ratingEl.classList.add("tappable");
      ratingEl.setAttribute("role", "button");
      $("#rating-hint").hidden = false;
    } else {
      Game.lastCoach = null;
      ratingEl.classList.remove("tappable");
      ratingEl.removeAttribute("role");
      $("#rating-hint").hidden = true;
    }

    ratingEl.hidden = false;
    statusEl.hidden = true;
    Game.toastTimer = setTimeout(hideToast, (!r.forced && r.score < 70) ? 5200 : 3400);
  }

  const coachAvailable = r =>
    Game.mode === "cpu" && r && !r.forced && r.bestMoves && r.bestMoves.length > 0;

  function hideToast() {
    clearTimeout(Game.toastTimer);
    ratingEl.hidden = true;
    statusEl.hidden = false;
  }

  function updateAvgChip() {
    const sum = summarizeRatings(Game.ratings);
    $("#avg-badge").textContent = sum.count ? sum.avg : "—";
  }

  /* ---------- שידור חוזר של המאמן ----------
     הקשה על הציון פותחת הדגמה: הלוח חוזר למצב שלפני המהלך ומראה בשידור
     חוזר גם את המהלך שבחרת וגם את המהלך המומלץ, עם הסבר למה הוא עדיף.
     ההדגמה אינה משנה את המהלך שכבר שיחקת — היא רק ממחישה אלטרנטיבה. */
  let coachTok = 0;

  function openCoach() {
    const r = Game.lastCoach;
    if (!r || Game.mode !== "cpu" || Game.phase === "coach") return;
    Game.gen++;                       // עוצר תור מחשב ממתין או רץ
    stopTimer();
    clearTimeout(Game.rollTimer);
    hideToast();
    Game.phase = "coach";
    Game.coach = { r, tok: ++coachTok, which: "best" };
    $("#coach-bar").hidden = false;
    $("#dock").hidden = true;
    updateButtons();
    coachShow("best");                // מתחילים מהמהלך המומלץ — זה מה שרוצים ללמוד
  }

  function renderCoachPanel() {
    const c = Game.coach;
    if (!c) return;
    const r = c.r, isBest = c.which === "best";
    const badge = $("#coach-score");
    badge.className = "score-ring " + r.grade.cls;
    badge.textContent = r.score;
    $("#coach-title").textContent = isBest ? "המהלך המומלץ ✓" : "המהלך שבחרת";
    $("#coach-desc").innerHTML = isBest
      ? movesHtml(r.bestMoves)
      : (r.myMoves && r.myMoves.length ? movesHtml(r.myMoves) : "אין מהלך");
    $("#coach-expl").textContent = isBest ? r.explanation : `הציון שלך: ${r.score}`;
    $("#coach-mine").classList.toggle("on", !isBest);
    $("#coach-best").classList.toggle("on", isBest);
  }

  async function coachShow(which) {
    const c = Game.coach;
    if (!c) return;
    c.which = which;
    const tok = c.tok, r = c.r;
    const moves = which === "best" ? r.bestMoves : (r.myMoves || []);
    renderCoachPanel();

    /* אתחול הלוח למצב שלפני המהלך */
    Game.view = r.before;
    Game.dice = r.dice.slice();
    Game.diceWho = r.color;
    Game.diceUsed = [];
    Game.selected = null;
    Game.sources = new Set();
    render();
    await delay(650);

    for (const m of moves) {
      if (!Game.coach || Game.coach.tok !== tok) return;   // נסגר או הוחלף
      await delay(560);
      if (!Game.coach || Game.coach.tok !== tok) return;
      const res = applyMove(Game.view, r.color, m);
      Game.view = res.state;
      Game.diceUsed.push(m.die);
      render();
      if (res.hit || m.hit) { Sfx.hit(); flashHit(m.to); } else Sfx.place();
    }
  }

  function closeCoach() {
    const c = Game.coach;
    Game.coach = null;
    $("#coach-bar").hidden = true;
    $("#dock").hidden = false;
    /* משחזרים את הלוח למצב שאחרי המהלך שלך (המהלך המקורי לא השתנה) וממשיכים */
    const r = c && c.r;
    if (r) {
      Game.state = r.myAfter;
      Game.view = r.myAfter;
      Game.dice = r.dice.slice();
      Game.diceWho = r.color;
    }
    Game.selected = null;
    Game.phase = "ai";
    render();
    updateButtons();
    const g = Game.gen;
    setTimeout(() => { if (!stale(g)) aiTurn(); }, T.handoff);
  }

  /* ---------- סיכומים ---------- */

  function summaryHtml(sum) {
    if (!sum.count) return `<p class="note">עוד לא נמדדו מהלכים.</p>`;
    let html = `
      <div class="overall ${sum.grade.cls}"><span class="num">${sum.avg}</span><span class="lbl">ציון כולל</span></div>
      <div class="overall-grade ${sum.grade.cls}">${overallText(sum.avg)}</div>
      <div class="dist">${sum.dist.map(d => `<span class="chip ${d.cls}">${d.label} ${d.count}</span>`).join("")}</div>
      <p class="note">${sum.count} מהלכים נמדדו · מהלכים כפויים אינם נספרים</p>`;
    if (sum.worst.length) {
      html += `<div class="worst"><h3>מהלכים לשיפור</h3><ul>` + sum.worst.map(r =>
        `<li class="${r.grade.cls}">תור ${r.turn} · קוביות <span dir="ltr">${r.dice[0]}-${r.dice[1]}</span> · ציון <span class="sc">${r.score}</span><br>${r.explanation}</li>`
      ).join("") + `</ul></div>`;
    }
    return html;
  }

  function overallText(avg) {
    if (avg >= 95) return "רמת אלוף";
    if (avg >= 85) return "משחק מצוין";
    if (avg >= 70) return "משחק טוב מאוד";
    if (avg >= 55) return "יש לאן להשתפר";
    return "כדאי להתאמן";
  }

  function showModal(html) { $("#modal").innerHTML = html; $("#modal-backdrop").hidden = false; }
  function hideModal() { $("#modal-backdrop").hidden = true; }

  /* סיכום המשחק הנוכחי (להבדיל ממסך הסטטיסטיקות המצטברות) */
  function showStatsModal() {
    hideSheet(); hideToast();
    const sum = summarizeRatings(Game.ratings);
    showModal(`<h2>סיכום ביניים</h2>${summaryHtml(sum)}
      <div class="actions"><button class="pill-btn wide gold" id="m-close">המשך משחק</button></div>`);
    $("#m-close").onclick = hideModal;
  }

  function gameOver(winColor, reason) {
    Game.phase = "over";
    Game.dice = [];
    stopTimer();
    clearTimeout(Game.rollTimer);
    updateButtons();
    hideToast();
    render();
    /* פרישה נספרת כניצחון רגיל, בלי לבדוק את הלוח */
    const kind = reason === "resign" ? 1 : winKind(Game.state, winColor);
    const points = kind;      // רגיל 1, מארס 2, מארס טורקי 3
    const kindTxt = reason === "resign"
      ? (winColor === Game.me ? `${Game.oppName} פרש מהמשחק` : "פרשת מהמשחק")
      : { 1: "ניצחון רגיל", 2: "מארס — ניצחון כפול", 3: "מארס טורקי — ניצחון משולש" }[kind];
    const sum = summarizeRatings(Game.ratings);

    /* רישום התוצאה לסטטיסטיקה המצטברת. הפילוח לפי רמת קושי נוגע רק
       למשחקים מול המחשב; משחקים מול חבר נספרים בנפרד. */
    const won = winColor === Game.me;
    const online = Game.mode === "online";
    const lvl = online ? { g: 0, w: 0 }
      : (Stats.d.byLevel[Game.level] || (Stats.d.byLevel[Game.level] = { g: 0, w: 0 }));
    Stats.add("games");
    Stats.add("playMs", Math.max(0, Date.now() - Game.startedAt));
    if (online) Stats.add("onlineGames");
    lvl.g++;

    /* מאזן אישי מול כל יריב מקוון, לפי שמו — סופר גם משחקים וגם נקודות
       (מארס = 2, מארס טורקי = 3), כדי שהמאזן ישקף את שיטת הניקוד */
    if (online && Game.oppName) {
      const vs = Stats.d.vs || (Stats.d.vs = {});
      const rec = vs[Game.oppName] || (vs[Game.oppName] = { w: 0, l: 0, d: 0, pf: 0, pa: 0 });
      if (rec.pf == null) rec.pf = rec.w;   // המרה ממאזן ישן שספר רק משחקים
      if (rec.pa == null) rec.pa = rec.l;
      if (won) { rec.w++; rec.pf += points; }
      else { rec.l++; rec.pa += points; }
    }
    if (won) {
      Stats.add("wins"); lvl.w++;
      Stats.add("pointsWon", points);
      if (online) Stats.add("onlineWins");
      Stats.d.winKind[kind] = (Stats.d.winKind[kind] || 0) + 1;
      Stats.d.streak = Math.max(0, Stats.d.streak) + 1;
      Stats.d.bestStreak = Math.max(Stats.d.bestStreak, Stats.d.streak);
    } else {
      Stats.add("losses");
      Stats.add("pointsLost", points);
      Stats.d.lossKind[kind] = (Stats.d.lossKind[kind] || 0) + 1;
      Stats.d.streak = 0;
    }
    if (sum.count) {
      if (Stats.d.bestGame == null || sum.avg > Stats.d.bestGame) Stats.d.bestGame = sum.avg;
      if (Stats.d.worstGame == null || sum.avg < Stats.d.worstGame) Stats.d.worstGame = sum.avg;
    }
    Stats.save();

    won ? Sfx.win() : Sfx.lose();
    const rec = online ? (Stats.d.vs || {})[Game.oppName] : null;
    Game.lastResult = { won, kindTxt, points, sum, online, rec };
    status(won ? "ניצחת!" : `${Game.oppName} ניצח`);
    showGameOverModal();
  }

  function showGameOverModal() {
    const r = Game.lastResult;
    if (!r) return;
    showModal(`
      <h2>${r.draw ? "תיקו 🤝" : r.won ? "ניצחת! 🎉" : `${Game.oppName} ניצח`}</h2>
      <div class="win-kind">${r.kindTxt}</div>
      ${!r.draw && r.points ? `<div class="points-badge ${r.won ? "won" : "lost"}">
          <span class="pts-n">${r.points}</span>
          <span class="pts-lbl">${r.points === 1 ? "נקודה" : "נקודות"}</span>
        </div>` : ""}
      ${r.rec ? (() => { const pts = recPts(r.rec); return `<div class="h2h">
          <span class="h2h-side"><b>${pts.pf}</b>${escapeHtml(Profiles.active().name)}</span>
          <span class="h2h-vs">מאזן נקודות${r.rec.d ? ` · ${r.rec.d} תיקו` : ""}</span>
          <span class="h2h-side"><b>${pts.pa}</b>${escapeHtml(Game.oppName)}</span>
        </div>
        <p class="h2h-games" dir="ltr">${r.rec.w}–${r.rec.l} משחקים</p>`; })() : ""}
      ${summaryHtml(r.sum)}
      <div class="actions">
        <button class="pill-btn wide gold" id="m-again">משחק חוזר</button>
        <button class="pill-btn wide" id="m-home">${r.online ? "יציאה ללובי" : "מסך הבית"}</button>
      </div>
      <div class="actions">
        <button class="pill-btn wide" id="m-replay">צפה במשחק</button>
        <button class="pill-btn wide" id="m-share">שתף</button>
      </div>
      <p class="note" id="m-note" hidden></p>`);
    $("#m-again").onclick = () => (r.online ? requestRematch() : newGame());
    $("#m-home").onclick = goHome;
    $("#m-replay").onclick = enterReplay;
    $("#m-share").onclick = shareSummary;
  }

  /* ==================== מדריך למתחילים ====================
     רץ על הלוח האמיתי לפני שהמשחק מתחיל. חלק מהשלבים מציבים עמדת הדגמה
     כדי להראות חסימה, הכאה, בר והורדה — דברים שלא קיימים בפתיחה. */

  /* אזורים על הלוח, באחוזים, לצורך הזרקור */
  const HOME_RECT = { x1: GEO.rightQuadX, x2: GEO.rightEdge, y1: 100 - GEO.padY - GEO.rowH, y2: 100 - GEO.padY };
  const OUTER_RECT = { x1: GEO.leftQuadX, x2: GEO.barX, y1: GEO.padY, y2: GEO.padY + GEO.rowH };
  const BAR_RECT = { x1: GEO.barX, x2: GEO.barX + GEO.barW, y1: 20, y2: 80 };
  const DICE_RECT = { x1: GEO.rightQuadX, x2: GEO.rightEdge, y1: 38, y2: 62 };

  function demoState(spec) {
    const s = { points: new Array(24).fill(0), bar: { 1: 0, "-1": 0 }, off: { 1: 0, "-1": 0 } };
    for (const k of Object.keys(spec.points || {})) s.points[+k] = spec.points[k];
    if (spec.bar) Object.assign(s.bar, spec.bar);
    if (spec.off) Object.assign(s.off, spec.off);
    return s;
  }

  const TUT_STEPS = [
    {
      title: "ברוך הבא לשש-בש",
      body: "המטרה פשוטה: להביא את כל 15 החיילים שלך אל הבית, ואז להוריד אותם מהלוח. מי שמוריד את כולם ראשון — מנצח.",
    },
    {
      title: "אלה החיילים שלך",
      body: "החיילים הבהירים הם שלך, הכהים של היריב. בהתחלה כולם מפוזרים על הלוח.",
      rect: () => ({ x1: GEO.leftQuadX, x2: GEO.rightEdge, y1: GEO.padY, y2: 100 - GEO.padY }),
    },
    {
      title: "הבית שלך",
      body: "שש הנקודות למטה מימין (1 עד 6) הן הבית שלך. לשם צריך להביא את כל החיילים.",
      rect: () => HOME_RECT,
    },
    {
      title: "לאן זזים",
      body: "החיילים שלך נעים תמיד מהמספרים הגבוהים לנמוכים — מ-24 לכיוון 1, כלומר אל הבית. היריב נע בכיוון ההפוך.",
      rect: () => OUTER_RECT,
    },
    {
      title: "הקוביות",
      body: "בכל תור מוטלות שתי קוביות. כל קובייה היא מהלך אחד: קובייה 5 מזיזה חייל חמש נקודות קדימה. יצא דאבל? מקבלים ארבעה מהלכים.",
      rect: () => DICE_RECT,
      dice: [5, 3],
    },
    {
      title: "איך מזיזים",
      body: "חייל שאפשר להזיז מסומן בטבעת זהב. לוחצים עליו ורואים לאן הוא יכול ללכת, ואז לוחצים על היעד. אפשר גם לגרור.",
    },
    {
      title: "נקודה חסומה",
      body: "נקודה שיש עליה שני חיילי יריב או יותר חסומה — אסור לנחות עליה. כאן היריב חוסם את נקודה 5.",
      state: () => demoState({ points: { 3: 1, 5: 4, 7: 3, 12: 5, 23: 2, 0: -1, 4: -2, 11: -5, 16: -3, 18: -4 } }),
      rect: () => HOME_RECT,
    },
    {
      title: "הכאה",
      body: "חייל יריב בודד נקרא חשוף. אם תנחת עליו — הוא נשלח לבר ומתחיל את כל הדרך מהתחלה. זה המהלך החזק במשחק.",
      state: () => demoState({ points: { 3: 1, 5: 4, 7: 3, 12: 5, 23: 2, 0: -1, 4: -1, 11: -5, 16: -3, 18: -5 } }),
      rect: () => HOME_RECT,
    },
    {
      title: "הבר",
      body: "אם החייל שלך הוכה הוא עולה לבר, באמצע הלוח. חובה להחזיר אותו למשחק לפני שמזיזים כל חייל אחר.",
      state: () => demoState({ points: { 5: 4, 7: 3, 12: 5, 23: 2, 0: -2, 11: -5, 16: -3, 18: -5 }, bar: { 1: 1 } }),
      rect: () => BAR_RECT,
    },
    {
      title: "הורדה מהלוח",
      body: "כשכל 15 החיילים שלך בבית, מתחילים להוריד אותם. לוחצים על חייל וגוררים אל הפס שברצועה שלך למטה.",
      state: () => demoState({ points: { 0: 3, 1: 3, 2: 3, 3: 2, 4: 2, 5: 2, 18: -5, 20: -5, 22: -5 } }),
      rect: () => HOME_RECT,
    },
    {
      title: "המאמן שלך",
      body: "בסוף כל תור תקבל ציון מ-0 עד 100 והסבר קצר מה היה עדיף. זה לא משפיע על המשחק — רק עוזר להשתפר.",
    },
    {
      title: "זהו, אפשר להתחיל",
      body: "ברמה הקלה המחשב סלחן ועושה טעויות, אז זה המקום המושלם ללמוד. בהצלחה!",
    },
  ];

  const Tutorial = {
    i: 0, onDone: null, active: false,

    start(onDone) {
      this.onDone = onDone;
      this.i = 0;
      this.active = true;
      $("#tut-dots").innerHTML = TUT_STEPS.map(() => "<i></i>").join("");
      $("#tutorial").hidden = false;
      this.show();
      window.addEventListener("resize", this.reposition);
    },

    show() {
      const step = TUT_STEPS[this.i];

      /* עמדת הדגמה, אם השלב מבקש כזו */
      Game.view = step.state ? step.state() : initialState();
      Game.state = Game.view;
      Game.dice = step.dice || [];
      Game.diceWho = WHITE;
      Game.diceUsed = [];
      Game.sources = new Set();
      render();

      $("#tut-title").textContent = step.title;
      $("#tut-body").textContent = step.body;
      [...$("#tut-dots").children].forEach((d, k) => d.classList.toggle("on", k === this.i));
      $("#tut-next").textContent = this.i === TUT_STEPS.length - 1 ? "מתחילים" : "הבא";
      $("#tut-skip").hidden = this.i === TUT_STEPS.length - 1;
      this.reposition();
    },

    /* הזרקור הוא חור בשכבה הכהה, ולכן צריך מיקום בפיקסלים אמיתיים */
    reposition() {
      const step = TUT_STEPS[Tutorial.i];
      const spot = $("#tut-spot");
      const card = $("#tut-card");
      if (!step || !step.rect) {
        /* חייבים לנקות את המיקום מהשלב הקודם, אחרת נשאר מלבן רפאים */
        spot.removeAttribute("style");
        spot.classList.add("full");
        card.classList.remove("at-top");
        return;
      }
      spot.classList.remove("full");
      const b = boardEl.getBoundingClientRect();
      const r = step.rect();
      const left = b.left + b.width * r.x1 / 100;
      const top = b.top + b.height * r.y1 / 100;
      const w = b.width * (r.x2 - r.x1) / 100;
      const h = b.height * (r.y2 - r.y1) / 100;
      spot.hidden = false;
      spot.style.left = (left - 6) + "px";
      spot.style.top = (top - 6) + "px";
      spot.style.width = (w + 12) + "px";
      spot.style.height = (h + 12) + "px";
      /* הכרטיס עובר לצד הנגדי כדי לא להסתיר את מה שמסבירים עליו */
      card.classList.toggle("at-top", top + h / 2 > window.innerHeight / 2);
    },

    next() {
      if (this.i >= TUT_STEPS.length - 1) return this.end();
      this.i++;
      Sfx.place();
      this.show();
    },

    end() {
      this.active = false;
      $("#tutorial").hidden = true;
      window.removeEventListener("resize", this.reposition);
      Profiles.active().stats.tutorialDone = true;
      Profiles.save();
      const done = this.onDone;
      this.onDone = null;
      if (done) done();
    },
  };

  $("#tut-next").onclick = () => Tutorial.next();
  $("#tut-skip").onclick = () => Tutorial.end();

  /* ---------- שיתוף סיכום כתמונה ----------
     מצייר כרטיס על קנבס ומעביר אותו ל-Web Share. אם השיתוף לא נתמך,
     התמונה יורדת כקובץ. */

  const GRADE_HEX = {
    "g-excellent": "#4ecb82", "g-verygood": "#86cf62", "g-good": "#c3d155",
    "g-ok": "#edc752", "g-inaccurate": "#eda047", "g-mistake": "#ec7145",
    "g-blunder": "#e2504c", "g-forced": "#8fa8c8",
  };

  function drawSummaryCard() {
    const W = 1080, H = 1350;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const x = cv.getContext("2d");
    const r = Game.lastResult;
    const sum = r.sum;

    x.direction = "rtl";
    x.textAlign = "center";

    const bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#16202b");
    bg.addColorStop(0.55, "#0b0f14");
    bg.addColorStop(1, "#070a0d");
    x.fillStyle = bg; x.fillRect(0, 0, W, H);

    /* סמל */
    x.fillStyle = "#121820";
    roundRect(x, W / 2 - 66, 92, 132, 132, 34); x.fill();
    x.strokeStyle = "rgba(227,189,119,.5)"; x.lineWidth = 4;
    roundRect(x, W / 2 - 66, 92, 132, 132, 34); x.stroke();
    x.fillStyle = "#5c6773";
    tri(x, W / 2 - 34, 118, W / 2 - 6, 118, W / 2 - 20, 172);
    x.fillStyle = "#e3bd77";
    tri(x, W / 2 + 8, 198, W / 2 + 36, 198, W / 2 + 22, 144);
    x.fillStyle = "#f7f3ea"; dot(x, W / 2 + 22, 126, 14);
    x.fillStyle = "#2b333d"; dot(x, W / 2 - 20, 190, 14);

    x.fillStyle = "#eef2f6";
    x.font = "800 64px system-ui, sans-serif";
    x.fillText(r.draw ? "תיקו 🤝" : r.won ? "ניצחתי!" : "הפסדתי", W / 2, 300);

    x.fillStyle = "#93a1b0";
    x.font = "400 34px system-ui, sans-serif";
    x.fillText(`${Profiles.active().name} מול ${Game.oppName}`, W / 2, 352);
    x.fillText(r.kindTxt, W / 2, 400);

    /* ציון כולל */
    if (sum.count) {
      const col = GRADE_HEX[sum.grade.cls] || "#e3bd77";
      x.beginPath(); x.arc(W / 2, 580, 118, 0, Math.PI * 2);
      x.fillStyle = col + "22"; x.fill();
      x.strokeStyle = col; x.lineWidth = 9; x.stroke();
      x.fillStyle = col;
      x.font = "800 116px system-ui, sans-serif";
      x.fillText(String(sum.avg), W / 2, 618);
      x.font = "700 28px system-ui, sans-serif";
      x.fillStyle = "#93a1b0";
      x.fillText("ציון כולל", W / 2, 730);

      /* התפלגות */
      let y = 800;
      const max = Math.max(...sum.dist.map(d => d.count), 1);
      for (const d of sum.dist) {
        const c = GRADE_HEX[d.cls] || "#888";
        x.textAlign = "right";
        x.fillStyle = c;
        x.font = "700 30px system-ui, sans-serif";
        x.fillText(d.label, W - 110, y + 8);

        x.fillStyle = "rgba(255,255,255,.08)";
        roundRect(x, 200, y - 16, 560, 24, 12); x.fill();
        x.fillStyle = c;
        roundRect(x, 200 + 560 * (1 - d.count / max), y - 16, 560 * (d.count / max), 24, 12); x.fill();

        x.textAlign = "left";
        x.fillStyle = "#eef2f6";
        x.font = "700 28px system-ui, sans-serif";
        x.fillText(String(d.count), 120, y + 8);
        x.textAlign = "center";
        y += 58;
      }
      x.fillStyle = "#93a1b0";
      x.font = "400 28px system-ui, sans-serif";
      x.fillText(`${sum.count} מהלכים נמדדו · ${Game.log.length} תורות`, W / 2, y + 30);
    }

    x.fillStyle = "rgba(227,189,119,.75)";
    x.font = "700 30px system-ui, sans-serif";
    x.fillText("שש-בש · עם מאמן אישי", W / 2, H - 60);
    return cv;
  }

  function roundRect(x, a, b, w, h, r) {
    x.beginPath();
    x.moveTo(a + r, b);
    x.arcTo(a + w, b, a + w, b + h, r);
    x.arcTo(a + w, b + h, a, b + h, r);
    x.arcTo(a, b + h, a, b, r);
    x.arcTo(a, b, a + w, b, r);
    x.closePath();
  }
  function tri(x, x1, y1, x2, y2, x3, y3) {
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.lineTo(x3, y3); x.closePath(); x.fill();
  }
  function dot(x, cx, cy, r) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }

  async function shareSummary() {
    if (!Game.lastResult) return;
    let blob;
    try {
      const cv = drawSummaryCard();
      blob = await new Promise(res => cv.toBlob(res, "image/png"));
    } catch (_) { return; }
    if (!blob) return;

    const file = new File([blob], "shesh-besh.png", { type: "image/png" });
    const text = Game.lastResult.sum.count
      ? `ציון ${Game.lastResult.sum.avg} בשש-בש`
      : "משחק שש-בש";
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return;
      }
    } catch (_) { /* המשתמש ביטל או שהשיתוף נכשל — יורדים להורדה */ }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "shesh-besh.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------- צפייה חוזרת ----------
     משתמשת באותו לוח ובאותו רינדור: פשוט מציבים מצב מתוך היומן
     ומכבים את הקלט. שורת הבקרה מחליפה את המזח לזמן הצפייה. */

  function enterReplay() {
    if (!Game.log.length) return;
    hideModal();
    Game.replay = { i: 0, playing: false, timer: null };
    Game.phase = "replay";
    stopTimer();
    updateButtons();
    $("#replay-bar").hidden = false;
    $("#dock").hidden = true;
    replayGoto(0);
  }

  function exitReplay() {
    if (Game.replay && Game.replay.timer) clearInterval(Game.replay.timer);
    Game.replay = null;
    $("#replay-bar").hidden = true;
    $("#dock").hidden = false;
    Game.phase = "over";
    Game.view = Game.state;
    Game.dice = [];
    render();
    showGameOverModal();
  }

  function replayGoto(i) {
    const R = Game.replay;
    if (!R) return;
    R.i = Math.max(0, Math.min(Game.log.length - 1, i));
    const e = Game.log[R.i];

    Game.view = e.after;
    Game.state = e.after;
    Game.dice = e.dice.slice();
    Game.diceWho = e.color;
    Game.diceUsed = e.moves.map(m => m.die);
    Game.sources = new Set();
    Game.selected = null;
    render();

    const who = isMine(e.color) ? "אתה" : Game.oppName;
    const r = e.rating;
    $("#replay-count").textContent = `${R.i + 1} / ${Game.log.length}`;
    $("#replay-desc").innerHTML =
      `<b>${who}</b> · <span dir="ltr">${e.dice[0]}-${e.dice[1]}</span> · ` +
      (e.moves.length ? movesHtml(e.moves) : "אין מהלך");
    const badge = $("#replay-score");
    if (r && !r.forced) {
      badge.hidden = false;
      badge.className = "score-ring " + r.grade.cls;
      badge.textContent = r.score;
      $("#replay-expl").textContent = r.explanation;
      $("#replay-expl").hidden = false;
    } else {
      badge.hidden = true;
      $("#replay-expl").hidden = !(r && r.forced);
      if (r && r.forced) $("#replay-expl").textContent = "מהלך כפוי";
    }
    $("#replay-prev").disabled = R.i === 0;
    $("#replay-next").disabled = R.i === Game.log.length - 1;
  }

  function replayPlay() {
    const R = Game.replay;
    if (!R) return;
    if (R.playing) {
      clearInterval(R.timer); R.playing = false;
      $("#replay-play").textContent = "▶";
      return;
    }
    R.playing = true;
    $("#replay-play").textContent = "❚❚";
    R.timer = setInterval(() => {
      if (!Game.replay) return;
      if (Game.replay.i >= Game.log.length - 1) { replayPlay(); return; }
      replayGoto(Game.replay.i + 1);
    }, 1100);
  }

  $("#replay-prev").onclick = () => replayGoto(Game.replay.i - 1);
  $("#replay-next").onclick = () => replayGoto(Game.replay.i + 1);
  $("#replay-play").onclick = replayPlay;
  $("#replay-exit").onclick = exitReplay;

  /* המאמן: הקשה על הציון פותחת את השידור החוזר */
  ratingEl.onclick = () => { if (Game.lastCoach) openCoach(); };
  $("#coach-mine").onclick = () => coachShow("mine");
  $("#coach-best").onclick = () => coachShow("best");
  $("#coach-close").onclick = closeCoach;

  /* ---------- פרישה ---------- */

  function resign() {
    if (!["playerMove", "playerRoll", "ai", "remote", "rolling", "auto", "blocked", "confirm"].includes(Game.phase)) return;
    hideSheet();
    if (!confirm("לפרוש מהמשחק? ההפסד ייספר בסטטיסטיקה.")) return;
    if (Game.mode === "online") netSend({ t: "resign" });
    gameOver(-Game.me, "resign");
  }

  /* ---------- הצעת תיקו (רק מול חבר) ---------- */

  const canOfferDraw = () =>
    Game.mode === "online" && Game.net && Game.net.started && Game.phase !== "over";

  function offerDraw() {
    if (!canOfferDraw() || Game.net.drawPending) return;
    hideSheet();
    Game.net.drawPending = "sent";
    netSend({ t: "drawoffer" });
    hideToast();
    ratingEl.className = "g-forced";
    $("#rating-score").textContent = "🤝";
    $("#rating-grade").textContent = "הצעת תיקו נשלחה";
    $("#rating-expl").textContent = `ממתין לתשובת ${Game.oppName}…`;
    $("#rating-best").hidden = true;
    ratingEl.hidden = false; statusEl.hidden = true;
  }

  function showDrawOfferModal() {
    showModal(`
      <h2>הצעת תיקו 🤝</h2>
      <div class="win-kind">${escapeHtml(Game.oppName)} מציע לסיים בתיקו</div>
      <p class="note">תיקו עוצר את המשחק בלי הפסד לאף אחד.</p>
      <div class="actions">
        <button class="pill-btn wide gold" id="m-draw-yes">אשר תיקו</button>
        <button class="pill-btn wide" id="m-draw-no">דחה והמשך</button>
      </div>`);
    $("#m-draw-yes").onclick = () => { netSend({ t: "drawaccept" }); drawEnd(); };
    $("#m-draw-no").onclick = () => { netSend({ t: "drawdecline" }); hideModal(); };
  }

  /* סיום בתיקו — בלי ניצחון או הפסד, עוצר את המשחק */
  function drawEnd() {
    if (Game.phase === "over") return;
    Game.phase = "over";
    Game.dice = [];
    stopTimer();
    clearTimeout(Game.rollTimer);
    if (Game.net) Game.net.drawPending = null;
    updateButtons();
    hideToast();
    render();

    const sum = summarizeRatings(Game.ratings);
    Stats.add("games");
    Stats.add("playMs", Math.max(0, Date.now() - Game.startedAt));
    Stats.add("onlineGames");
    Stats.add("draws");
    if (Game.oppName) {
      const vs = Stats.d.vs || (Stats.d.vs = {});
      const rec = vs[Game.oppName] || (vs[Game.oppName] = { w: 0, l: 0, d: 0, pf: 0, pa: 0 });
      rec.d = (rec.d || 0) + 1;
    }
    if (sum.count) {
      if (Stats.d.bestGame == null || sum.avg > Stats.d.bestGame) Stats.d.bestGame = sum.avg;
      if (Stats.d.worstGame == null || sum.avg < Stats.d.worstGame) Stats.d.worstGame = sum.avg;
    }
    Stats.save();

    Sfx.off();
    const rec = (Stats.d.vs || {})[Game.oppName];
    Game.lastResult = { draw: true, kindTxt: "תיקו בהסכמה 🤝", sum, online: true, rec };
    status("תיקו 🤝");
    showGameOverModal();
  }

  /* ==================== משחק מול חבר ====================
     שני הצדדים מריצים את אותו מנוע חוקים על אותו מצב התחלתי, ולכן די
     להעביר ברשת קוביות ומהלכים. המארח מגריל מי פותח ומודיע לאורח. */

  const myName = () => Profiles.active().name;

  function netSend(msg) {
    if (Game.net && Game.net.tr) { try { Game.net.tr.send(msg); } catch (_) {} }
  }

  function netTeardown() {
    if (!Game.net) return;
    clearInterval(Game.net.hbTimer);
    clearInterval(Game.net.watchTimer);
    try { Game.net.tr.send({ t: "bye" }); } catch (_) {}
    try { Game.net.tr.close(); } catch (_) {}
    Game.net = null;
  }

  function netAlive() {
    if (Game.net) Game.net.lastSeen = Date.now();
    $("#net-warn").hidden = true;
  }

  async function netOpen(role, room) {
    netTeardown();
    const tr = makeTransport();
    Game.net = { tr, role, room, lastSeen: Date.now(), started: false };
    tr.onMessage = onNetMessage;
    await tr.open(room);

    Game.net.hbTimer = setInterval(() => netSend({ t: "ping" }), 3000);
    Game.net.watchTimer = setInterval(() => {
      if (!Game.net || !Game.net.started) return;
      const gap = Date.now() - Game.net.lastSeen;
      $("#net-warn").hidden = gap < 12000;
    }, 2000);
    return tr;
  }

  function onNetMessage(m) {
    if (!m || !Game.net) return;
    netAlive();

    switch (m.t) {
      case "hello":
        /* רק המארח מגריל, וגם אם ההודעה חוזרת פעמיים לא מתחילים משחק שני */
        Game.net.theirName = m.name || "יריב";
        if (Game.net.role !== "host" || Game.net.started) {
          if (Game.net.role === "host") netSend({ t: "welcome", first: Game.net.first, name: myName() });
          return;
        }
        Game.net.first = Math.random() < 0.5 ? WHITE : BLACK;
        Game.net.started = true;
        netSend({ t: "welcome", first: Game.net.first, name: myName(), variant: Game.variant });
        startOnlineGame(WHITE, Game.net.first);
        break;

      case "welcome":
        if (Game.net.role !== "guest" || Game.net.started) return;
        Game.net.theirName = m.name || "יריב";
        Game.net.started = true;
        Game.variant = m.variant === "turkish" ? "turkish" : "regular";
        startOnlineGame(BLACK, m.first);
        break;

      /* היריב הטיל — מציגים את הקוביות שלו כבר עכשיו, לפני שבחר מהלך */
      case "roll":
        if (Game.phase !== "remote" || !m.dice) return;
        Game.dice = m.dice.slice();
        Game.diceWho = -Game.me;
        Game.diceUsed = [];
        Game.net.sawRoll = true;
        render();
        renderDice(true);
        Sfx.roll();
        status(`${Game.oppName} הטיל <b>${m.dice[0]}-${m.dice[1]}</b> — חושב…`);
        break;

      case "turn": {
        if (Game.phase !== "remote") return;      // הודעה כפולה או מאוחרת
        const preRolled = !!Game.net.sawRoll;
        Game.net.sawRoll = false;
        playOpponentTurn(m.dice, m.moves || [], Game.gen, Game.oppName, { preRolled, again: !!m.again });
        break;
      }

      /* היריב הוציא 1-2 בטורקי — מחליף צדדים, והתור עובר אליי */
      case "swap": {
        if (Game.phase !== "remote") return;
        Game.net.sawRoll = false;
        Sfx.hit();
        status(`${Game.oppName} הוציא 1-2 — מחליפים צדדים 🔄`);
        const gs = Game.gen;
        animateSwap(gs, () => {
          setTimeout(() => { if (!stale(gs) && Game.phase === "remote") playerRollPhase(); }, 700);
        });
        break;
      }

      case "resign":
        if (Game.net.started && Game.phase !== "over") gameOver(Game.me, "resign");
        break;

      /* הצעת תיקו: היריב מציע, אני מאשר או דוחה */
      case "drawoffer":
        if (Game.net.started && Game.phase !== "over") showDrawOfferModal();
        break;

      case "drawaccept":
        if (Game.phase !== "over") drawEnd();
        break;

      case "drawdecline":
        if (Game.net) Game.net.drawPending = null;
        hideToast();
        status(`${Game.oppName} דחה את הצעת התיקו — ממשיכים`);
        break;

      /* משחק חוזר: כל צד מסמן רצון, והמארח מכריז כששניהם מוכנים */
      case "rematch":
        Game.net.theirRematch = true;
        noteRematch();
        if (Game.net.role === "host" && Game.net.myRematch) hostStartRematch();
        break;

      case "rematchGo":
        if (Game.net.role !== "guest") return;
        Game.net.myRematch = Game.net.theirRematch = false;
        startOnlineGame(BLACK, m.first);
        break;

      case "bye":
        if (Game.net.started) {
          $("#net-warn").hidden = false;
          $("#net-warn-text").textContent = `${Game.oppName} עזב את המשחק`;
        }
        break;
    }
  }

  function requestRematch() {
    if (!Game.net) return goHome();
    Game.net.myRematch = true;
    netSend({ t: "rematch" });
    noteRematch();
    if (Game.net.role === "host" && Game.net.theirRematch) hostStartRematch();
  }

  function hostStartRematch() {
    const first = Math.random() < 0.5 ? WHITE : BLACK;
    Game.net.myRematch = Game.net.theirRematch = false;
    netSend({ t: "rematchGo", first });
    startOnlineGame(WHITE, first);
  }

  function noteRematch() {
    const n = $("#m-note");
    if (!n || !Game.net) return;
    n.hidden = false;
    n.textContent = Game.net.myRematch
      ? `ממתין ל${Game.oppName}…`
      : `${Game.oppName} רוצה משחק חוזר`;
  }

  function startOnlineGame(myColor, first) {
    Game.gen++;
    clearTimeout(Game.rollTimer);
    Game.mode = "online";
    Game.me = myColor;
    Game.silentCoach = true;
    Game.level = "medium";              // המנוע עדיין מדרג, רק בלי להציג
    Game.turkishAction = null; Game.naturalDouble = false;
    if (Game.net) Game.net.drawPending = null;
    Game.state = initialState();
    Game.view = Game.state;
    Game.ratings = []; Game.log = []; Game.replay = null;
    Game.turnNumber = 0;
    Game.dice = []; Game.diceWho = null; Game.diceUsed = [];
    Game.prefix = []; Game.chunks = [];
    Game.options = []; Game.sources = new Set(); Game.selected = null;
    Game.startedAt = Date.now();

    layoutPoints();                      // הלוח מסתובב לצד של השחקן
    applyStripColors();
    Game.oppName = (Game.net && Game.net.theirName) || "יריב";
    setOpponentLabel(Game.oppName, "🙋");
    setMeLabel();
    $("#title-level").textContent = Game.variant === "turkish" ? "טורקי · מול חבר" : "מול חבר";
    $("#net-warn").hidden = true;
    hideToast(); hideModal(); hideSheet();
    updateAvgChip();
    showScreen("game");
    fitBoard();
    maybeShowTurkishIntro();

    const rec = (Stats.d.vs || {})[Game.oppName];
    const head = rec ? ` · המאזן מולו <b>${rec.w}-${rec.l}</b>` : "";

    if (first === myColor) {
      Game.phase = "playerRoll";
      updateButtons(); render();
      status("אתה פותח" + head);
      armAutoRoll();
    } else {
      Game.phase = "remote";
      updateButtons(); render();
      status(`${Game.oppName} פותח${head}`);
    }
  }

  function setOpponentLabel(name, emoji) {
    $("#strip-ai .nm").textContent = name;
    $("#strip-ai .avatar").textContent = emoji;
  }

  function setMeLabel() {
    const p = Profiles.active();
    $("#strip-me .nm").textContent = p.name;
    $("#strip-me .avatar").textContent = p.avatar;
  }

  /* ---------- מסך הלובי ---------- */

  function lobbyState(name) {
    ["choose", "host", "join"].forEach(s =>
      $("#lobby-" + s).hidden = s !== name);
  }

  /* מציג שגיאת רשת יחד עם מוצא: מעבר למצב מקומי בלי לגעת בקוד */
  function netError(el, msg, retry) {
    el.textContent = "";
    el.appendChild(document.createTextNode(msg + " "));
    if (!netConfigured()) return;
    const b = document.createElement("button");
    b.className = "pill-btn";
    b.textContent = "נסה מצב מקומי";
    b.onclick = () => { setForceLocal(true); retry(); };
    el.appendChild(b);
  }

  async function hostRoom() {
    Game.variant = onlineVariant;        // המארח קובע את סוג המשחק
    const room = makeRoomCode();
    $("#room-code").textContent = room;
    $("#host-status").textContent = netConfigured()
      ? "ממתין שהחבר יצטרף…"
      : "ממתין… (מצב מקומי: פתחו לשונית שנייה באותו דפדפן)";
    lobbyState("host");
    try {
      await netOpen("host", room);
    } catch (e) {
      netError($("#host-status"), "החיבור נכשל: " + e.message, hostRoom);
    }
  }

  async function joinRoom() {
    const code = normalizeRoomCode($("#join-input").value);
    if (code.length !== 6) { $("#join-status").textContent = "צריך קוד בן 6 תווים"; return; }
    $("#join-status").textContent = "מתחבר…";
    try {
      await netOpen("guest", code);
      netSend({ t: "hello", name: myName() });
      /* אם אף אחד לא עונה, כנראה שאין חדר כזה */
      setTimeout(() => {
        if (Game.net && !Game.net.started) $("#join-status").textContent = "אין תשובה — בדקו את הקוד";
      }, 6000);
    } catch (e) {
      netError($("#join-status"), "החיבור נכשל: " + e.message, joinRoom);
    }
  }

  $("#btn-online").onclick = () => {
    $("#lobby-mode-note").textContent = netConfigured()
      ? "מחובר דרך Supabase — אפשר לשחק מכל מקום"
      : "מצב מקומי: עובד בין לשוניות באותו דפדפן. להוספת משחק דרך האינטרנט מלאו את NET_CONFIG ב-js/net.js";
    lobbyState("choose");
    showScreen("online");
  };
  $("#lobby-host-btn").onclick = hostRoom;
  $("#lobby-join-btn").onclick = () => { $("#join-status").textContent = ""; lobbyState("join"); };
  $("#join-go").onclick = joinRoom;
  $("#join-input").oninput = e => { e.target.value = normalizeRoomCode(e.target.value); };
  $("#join-input").onkeydown = e => { if (e.key === "Enter") joinRoom(); };
  document.querySelectorAll("[data-lobby-back]").forEach(b => b.onclick = () => {
    netTeardown(); lobbyState("choose");
  });

  $("#room-copy").onclick = async () => {
    const code = $("#room-code").textContent;
    try { await navigator.clipboard.writeText(code); $("#room-copy").textContent = "הועתק ✓"; }
    catch (_) { $("#room-copy").textContent = code; }
    setTimeout(() => { $("#room-copy").textContent = "העתק קוד"; }, 1800);
  };

  /* ---------- ניווט בין מסכים ---------- */

  const SCREENS = ["welcome", "home", "game", "stats", "online"];
  function showScreen(name) {
    /* שכבות צפות שייכות למסך שממנו יצאנו — אחרת הן נשארות תלויות מעליו */
    hideModal(); hideSheet(); hideProfiles();
    $("#dbl-bar").hidden = true;
    SCREENS.forEach(s => $("#screen-" + s).classList.toggle("on", s === name));
    if (name === "home") renderHomeQuick();
    if (name === "stats") renderStatsScreen();
    if (name === "game") fitBoard();
  }

  /* עוזב את המשחק הנוכחי: מבטל טיימרים תלויים כדי שהמחשב לא ימשיך לשחק ברקע */
  function goHome() {
    Game.gen++;
    stopTimer();
    clearTimeout(Game.rollTimer);
    netTeardown();
    Game.phase = "idle";
    hideSheet(); hideModal(); hideToast();
    showScreen("home");
  }

  function startGame(level) {
    netTeardown();
    Game.mode = "cpu";
    Game.me = WHITE;
    Game.silentCoach = false;
    Game.level = level;
    Game.variant = pendingVariant;
    Game.oppName = "המחשב";
    layoutPoints();
    applyStripColors();
    setOpponentLabel("מחשב", "🤖");
    setMeLabel();
    $("#net-warn").hidden = true;
    syncLevelUi(level);
    $("#level-backdrop").hidden = true;
    showScreen("game");

    /* המדריך רלוונטי רק לשש-בש רגיל; בטורקי מציגים הסבר חוקים נפרד */
    if (Game.variant === "regular" && level === "easy" && !Profiles.active().stats.tutorialDone) {
      Game.phase = "idle";
      Game.dice = [];
      Game.state = initialState();
      Game.view = Game.state;
      stopTimer();
      updateButtons();
      render();
      Tutorial.start(() => newGame());
      return;
    }
    newGame();
    maybeShowTurkishIntro();
  }

  function syncLevelUi(level) {
    [...$("#level-seg").children].forEach(c => c.classList.toggle("on", c.dataset.v === level));
    const base = LEVEL_NAME[level] || "מאמן אישי";
    $("#title-level").textContent = Game.variant === "turkish" ? "טורקי · " + base : base;
  }

  /* ---------- בחירת סוג משחק ---------- */

  let pendingVariant = "regular";       // הבחירה במסך רמת הקושי (מול המחשב)

  const VARIANT_NOTE = {
    regular: "שש-בש קלאסי — החוקים המוכרים.",
    turkish: "טורקי: 1-2 מחליף צדדים · 3-4 דאבל לבחירה · 5-6 מזיז 2 חיילים חופשי · דאבל = תור נוסף.",
  };

  function syncVariantNote() {
    $("#variant-note").textContent = VARIANT_NOTE[pendingVariant];
  }

  $("#variant-seg").onclick = e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    pendingVariant = b.dataset.v;
    [...e.currentTarget.children].forEach(c => c.classList.toggle("on", c === b));
    syncVariantNote();
  };

  let onlineVariant = "regular";
  $("#online-variant-seg").onclick = e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    onlineVariant = b.dataset.v;
    [...e.currentTarget.children].forEach(c => c.classList.toggle("on", c === b));
  };

  /* ---------- הסבר חוקי טורקי (פעם אחת לכל שחקן) ---------- */

  function maybeShowTurkishIntro() {
    if (Game.variant !== "turkish") return;
    if (Profiles.active().stats.turkishSeen) return;
    Profiles.active().stats.turkishSeen = true;
    Profiles.save();
    showModal(`
      <h2>שש-בש טורקי</h2>
      <div class="win-kind">ארבעה חוקים מיוחדים</div>
      <ul class="rules-list">
        <li><b dir="ltr">1-2</b> — מחליפים צדדים: היריב שלך הופך אליך ולהפך.</li>
        <li><b dir="ltr">3-4</b> — אתה בוחר איזה דאבל לשחק (1 עד 6).</li>
        <li><b dir="ltr">5-6</b> — אתה מעביר שני חיילים לכל מקום פנוי, קדימה או אחורה.</li>
        <li><b>דאבל</b> — כל דאבל מזכה בתור נוסף.</li>
      </ul>
      <p class="note">שאר החוקים כמו בשש-בש רגיל. בטורקי המאמן שקט בזריקות המיוחדות.</p>
      <div class="actions"><button class="pill-btn wide gold" id="m-turk-ok">הבנתי, יאללה</button></div>`);
    $("#m-turk-ok").onclick = hideModal;
  }

  /* ---------- בוחר הדאבל (זריקת 3-4) ---------- */

  function showDoubleChooser(cb) {
    const grid = $("#dbl-grid");
    grid.innerHTML = "";
    for (let d = 1; d <= 6; d++) {
      const btn = document.createElement("button");
      btn.className = "dbl-die";
      const on = PIPS[d];
      for (let i = 0; i < 9; i++) {
        const dot = document.createElement("span");
        if (on.includes(i)) dot.className = "dot";
        btn.appendChild(dot);
      }
      btn.onclick = () => {
        $("#dbl-bar").hidden = true;
        Sfx.place();
        cb(d);
      };
      grid.appendChild(btn);
    }
    $("#dbl-bar").hidden = false;
  }

  /* ---------- מסך הבית ---------- */

  function renderHomeQuick() {
    const d = Stats.d;
    const avg = Stats.avgScore();
    const p = Profiles.active();
    $("#who-av").textContent = p.avatar;
    $("#who-name").textContent = p.name;
    $("#home-quick").innerHTML = `
      <div class="q"><b>${d.games}</b><span>משחקים</span></div>
      <div class="q"><b>${Stats.winRate()}%</b><span>ניצחונות</span></div>
      <div class="q"><b>${avg == null ? "—" : avg}</b><span>ציון ממוצע</span></div>`;

    /* מאזן מול חברים ישר במסך הבית — לחיצה פותחת את הסטטיסטיקות */
    const rivals = rivalList();
    const host = $("#home-rivals");
    host.hidden = !rivals.length;
    if (rivals.length) {
      host.innerHTML =
        `<span class="rivals-cap">מול חברים · נקודות</span>` +
        rivals.slice(0, 4).map(([name, r]) => {
          const pt = recPts(r);
          return `<span class="rival ${pt.pf > pt.pa ? "lead" : pt.pf < pt.pa ? "trail" : ""}">` +
          `${escapeHtml(name)} <b dir="ltr">${pt.pf}-${pt.pa}</b></span>`;
        }).join("");
    }
  }

  /* יריבים לפי מספר המשחקים, הרב ביותר קודם */
  const rivalList = () =>
    Object.entries(Stats.d.vs || {}).sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l));

  /* נקודות המאזן מול יריב, עם המרה לאחור ממאזן ישן שספר רק משחקים */
  const recPts = r => ({
    pf: r.pf != null ? r.pf : (r.w || 0),
    pa: r.pa != null ? r.pa : (r.l || 0),
  });

  $("#home-rivals").onclick = () => showScreen("stats");

  /* ---------- מסך הפתיחה (הפעלה ראשונה) ---------- */

  let welcomeAvatar = AVATARS[0];

  function buildWelcome() {
    $("#av-picker").innerHTML = AVATARS.map((a, i) =>
      `<button class="av-opt${i === 0 ? " on" : ""}" data-av="${a}">${a}</button>`).join("");
  }

  $("#av-picker").onclick = e => {
    const b = e.target.closest("[data-av]");
    if (!b) return;
    welcomeAvatar = b.dataset.av;
    [...e.currentTarget.children].forEach(c => c.classList.toggle("on", c === b));
  };

  $("#welcome-name").oninput = e => {
    $("#welcome-go").disabled = !e.target.value.trim();
  };
  $("#welcome-name").onkeydown = e => {
    if (e.key === "Enter" && $("#welcome-name").value.trim()) finishWelcome();
  };
  $("#welcome-go").onclick = finishWelcome;

  function finishWelcome() {
    const name = $("#welcome-name").value.trim();
    if (!name) return;
    const p = Profiles.active();
    p.name = name.slice(0, 14);
    p.avatar = welcomeAvatar;
    Profiles.isNew = false;
    Profiles.save();
    Sfx.boot();                 // המחווה הראשונה — מרשה לדפדפן להשמיע צליל
    showScreen("home");
  }

  /* ---------- ניהול פרופילים ---------- */

  function renderProfiles() {
    const host = $("#profiles-list");
    host.innerHTML = Profiles.d.list.map(p => {
      const s = p.stats;
      const rate = Stats.winRate(s);
      return `<div class="prof-row ${p.id === Profiles.d.active ? "on" : ""}" data-id="${p.id}">
        <button class="prof-av" data-act="avatar">${p.avatar}</button>
        <button class="prof-main" data-act="pick">
          <span class="prof-name">${escapeHtml(p.name)}</span>
          <span class="prof-sub">${s.games} משחקים · ${rate}% ניצחון${s.rated ? ` · ציון ${Stats.avgScore(s)}` : ""}</span>
        </button>
        <button class="prof-ico" data-act="rename" aria-label="שנה שם">✏️</button>
        ${Profiles.d.list.length > 1 ? `<button class="prof-ico" data-act="del" aria-label="מחק">🗑</button>` : ""}
      </div>`;
    }).join("");
  }

  const escapeHtml = t => String(t).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function showProfiles() { renderProfiles(); $("#profiles-backdrop").hidden = false; }
  function hideProfiles() { $("#profiles-backdrop").hidden = true; }

  $("#who-chip").onclick = showProfiles;
  $("#profiles-backdrop").onclick = e => { if (e.target.id === "profiles-backdrop") hideProfiles(); };
  $("#profile-add").onclick = () => {
    const name = prompt("שם השחקן:", "");
    if (name && name.trim()) { Profiles.add(name.trim()); renderProfiles(); renderHomeQuick(); }
  };
  $("#profiles-list").onclick = e => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest(".prof-row").dataset.id;
    const act = btn.dataset.act;
    if (act === "pick") { Profiles.setActive(id); hideProfiles(); renderHomeQuick(); return; }
    if (act === "avatar") Profiles.cycleAvatar(id);
    if (act === "rename") {
      const cur = Profiles.d.list.find(p => p.id === id);
      const name = prompt("שם השחקן:", cur ? cur.name : "");
      if (name && name.trim()) Profiles.rename(id, name.trim());
    }
    if (act === "del" && confirm("למחוק את השחקן והסטטיסטיקה שלו?")) Profiles.remove(id);
    renderProfiles();
    renderHomeQuick();
  };

  $("#btn-play").onclick = () => { syncVariantNote(); $("#level-backdrop").hidden = false; };
  $("#btn-stats").onclick = () => showScreen("stats");

  $("#level-backdrop").onclick = e => { if (e.target.id === "level-backdrop") $("#level-backdrop").hidden = true; };
  $("#lvl-cards").onclick = e => {
    const b = e.target.closest(".lvl-card");
    if (b) startGame(b.dataset.v);
  };

  document.querySelectorAll("[data-home]").forEach(b => b.onclick = () => showScreen("home"));

  /* ---------- מסך הסטטיסטיקות ---------- */

  const GRADE_LABELS = [
    ["g-excellent", "מצוין"], ["g-verygood", "טוב מאוד"], ["g-good", "טוב"],
    ["g-ok", "סביר"], ["g-inaccurate", "לא מדויק"], ["g-mistake", "טעות"],
    ["g-blunder", "טעות חמורה"],
  ];

  function fmtDuration(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return min + " דק׳";
    return Math.floor(min / 60) + " שע׳ " + (min % 60) + " דק׳";
  }

  function card(v, label, gold) {
    return `<div class="stat-card"><b${gold ? ' class="gold"' : ""}>${v}</b><span>${label}</span></div>`;
  }
  function row(label, v) {
    return `<div class="stat-row"><span>${label}</span><b>${v}</b></div>`;
  }

  function renderStatsScreen() {
    const d = Stats.d;
    const host = $("#stats-body");
    if (!d.games && !d.rated) {
      host.innerHTML = `<p class="stat-empty">עוד לא שיחקת משחק.<br>הסטטיסטיקות ייאספו מעצמן תוך כדי משחק.</p>`;
      return;
    }
    const avg = Stats.avgScore();

    const vs = rivalList();
    const vsSection = vs.length ? `
      <div class="stat-sec">
        <h4>מאזן מול חברים · נקודות</h4>
        <div class="stat-rows">
          ${vs.map(([name, r]) => {
            const pt = recPts(r);
            const cls = pt.pf > pt.pa ? "lead" : pt.pf < pt.pa ? "trail" : "";
            const games = `<span class="vs-draw" dir="ltr">${r.w}–${r.l} משחקים${r.d ? ` · ${r.d} תיקו` : ""}</span>`;
            return `<div class="stat-row"><span>${escapeHtml(name)}</span>` +
                   `<span class="vs-rec">${games}<b class="${cls}" dir="ltr">${pt.pf}-${pt.pa}</b></span></div>`;
          }).join("")}
        </div>
      </div>` : "";

    let html = `
      <div class="stat-sec">
        <h4>סיכום</h4>
        <div class="stat-grid">
          ${card(d.games, "משחקים")}
          ${card(Stats.winRate() + "%", "אחוז ניצחון", true)}
          ${card(avg == null ? "—" : avg, "ציון ממוצע", true)}
          ${card(d.wins, "ניצחונות")}
          ${card(d.losses, "הפסדים")}
          ${card(d.pointsWon || 0, "נקודות", true)}
          ${d.draws ? card(d.draws, "תיקו") : card(d.streak, "רצף נוכחי")}
        </div>
      </div>

      ${vsSection}

      <div class="stat-sec">
        <h4>תוצאות</h4>
        <div class="stat-rows">
          ${row("ניצחון רגיל", d.winKind[1] || 0)}
          ${row("מארס (כפול)", d.winKind[2] || 0)}
          ${row("מארס טורקי (משולש)", d.winKind[3] || 0)}
          ${row("הפסד רגיל", d.lossKind[1] || 0)}
          ${row("הפסד במארס", d.lossKind[2] || 0)}
          ${row("הפסד במארס טורקי", d.lossKind[3] || 0)}
          ${row("נקודות זכית", d.pointsWon || 0)}
          ${row("נקודות הפסדת", d.pointsLost || 0)}
        </div>
      </div>

      <div class="stat-sec">
        <h4>לפי יריב</h4>
        <div class="stat-rows">
          ${["easy", "medium", "hard"].map(k => {
            const l = d.byLevel[k] || { g: 0, w: 0 };
            const pct = l.g ? Math.round(l.w / l.g * 100) : 0;
            return row(LEVEL_NAME[k], `${l.w}/${l.g}` + (l.g ? ` · ${pct}%` : ""));
          }).join("")}
          ${row("מול חבר", `${d.onlineWins || 0}/${d.onlineGames || 0}` +
            (d.onlineGames ? ` · ${Math.round((d.onlineWins || 0) / d.onlineGames * 100)}%` : ""))}
        </div>
      </div>`;

    if (d.rated) {
      const max = Math.max(...GRADE_LABELS.map(([c]) => d.dist[c] || 0), 1);
      html += `
        <div class="stat-sec">
          <h4>איכות המהלכים</h4>
          <div class="stat-rows">
            ${GRADE_LABELS.map(([cls, label]) => {
              const n = d.dist[cls] || 0;
              return `<div class="qbar ${cls}">
                <span class="lbl">${label}</span>
                <span class="track"><span class="fill" style="width:${n / max * 100}%"></span></span>
                <span class="val">${n}</span>
              </div>`;
            }).join("")}
          </div>
        </div>`;
    }

    html += `
      <div class="stat-sec">
        <h4>שיאים</h4>
        <div class="stat-grid">
          ${card(d.bestGame == null ? "—" : d.bestGame, "ציון הכי גבוה", true)}
          ${card(d.bestStreak, "רצף ניצחונות")}
          ${card(d.borneOff, "חיילים שהורדת")}
        </div>
      </div>

      <div class="stat-sec">
        <h4>מהלכים</h4>
        <div class="stat-rows">
          ${row("סה״כ תורות", d.turns)}
          ${row("מהלכים שנמדדו", d.rated)}
          ${row("מהלכים כפויים", d.forced)}
          ${row("ממוצע תורות למשחק", Stats.avgTurns())}
          ${row("הכאות שביצעת", d.hitsMade)}
          ${row("הכאות שספגת", d.hitsTaken)}
          ${row("כניסות מהבר", d.barEntries)}
          ${row("דאבלים שיצאו לך", d.doubles)}
          ${row("זמן משחק מצטבר", fmtDuration(d.playMs))}
        </div>
      </div>

      <button class="pill-btn wide" id="stats-reset">איפוס הסטטיסטיקות</button>`;

    host.innerHTML = html;
    $("#stats-reset").onclick = () => {
      if (confirm("לאפס את כל הסטטיסטיקות? הפעולה אינה הפיכה.")) {
        Stats.reset();
        renderStatsScreen();
      }
    };
  }

  /* ---------- גיליון הגדרות ---------- */

  function showSheet() {
    /* "הצע תיקו" רלוונטי רק במשחק פעיל מול חבר */
    $("#sheet-draw").hidden = !canOfferDraw();
    $("#sheet-backdrop").hidden = false;
  }
  function hideSheet() { $("#sheet-backdrop").hidden = true; }

  $("#menu-btn").onclick = showSheet;
  $("#sheet-draw").onclick = offerDraw;
  $("#sheet-backdrop").onclick = e => { if (e.target.id === "sheet-backdrop") hideSheet(); };
  $("#sheet-new").onclick = () => { hideSheet(); Game.mode === "online" ? goHome() : newGame(); };
  $("#sheet-home").onclick = goHome;
  $("#avg-chip").onclick = showStatsModal;

  $("#level-seg").onclick = e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    Game.level = b.dataset.v;
    syncLevelUi(b.dataset.v);
  };

  $("#sheet-resign").onclick = resign;

  /* פתיחת המדריך ידנית — עוצר את המשחק הנוכחי ומתחיל אותו מחדש אחריו */
  $("#sheet-tut").onclick = () => {
    hideSheet();
    Game.gen++;
    stopTimer();
    clearTimeout(Game.rollTimer);
    Game.phase = "idle";
    Game.dice = [];
    updateButtons();
    hideToast(); hideModal();
    Tutorial.start(() => newGame());
  };

  const BOARD_KEY = "shesh-besh-board";
  function setBoardTheme(v) {
    document.body.dataset.board = v;
    try { localStorage.setItem(BOARD_KEY, v); } catch (_) {}
    [...$("#board-seg").children].forEach(c => c.classList.toggle("on", c.dataset.v === v));
  }
  $("#board-seg").onclick = e => {
    const b = e.target.closest("button[data-v]");
    if (b) setBoardTheme(b.dataset.v);
  };
  try { setBoardTheme(localStorage.getItem(BOARD_KEY) || "night"); } catch (_) { setBoardTheme("night"); }

  $("#timer-seg").onclick = e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    Game.turnSecs = Number(b.dataset.v);
    [...e.currentTarget.children].forEach(c => c.classList.toggle("on", c === b));
    /* מחילים מיד על התור הנוכחי */
    if (Game.phase === "playerMove" || Game.phase === "confirm") startTimer(Game.me);
    else if (Game.phase === "remote") startTimer(-Game.me);
    else stopTimer();
  };

  $("#auto-toggle").onclick = e => {
    const t = e.currentTarget;
    Game.autoRoll = !Game.autoRoll;
    t.classList.toggle("on", Game.autoRoll);
    t.setAttribute("aria-checked", String(Game.autoRoll));
    updateButtons();
    armAutoRoll();
  };

  $("#sound-toggle").onclick = e => {
    const t = e.currentTarget;
    Sfx.on = !Sfx.on;
    t.classList.toggle("on", Sfx.on);
    t.setAttribute("aria-checked", String(Sfx.on));
    if (Sfx.on) Sfx.place();
  };

  $("#hint-toggle").onclick = e => {
    const t = e.currentTarget;
    Game.hints = !Game.hints;
    t.classList.toggle("on", Game.hints);
    t.setAttribute("aria-checked", String(Game.hints));
    render();
  };

  /* ---------- חיבור אירועים ---------- */

  rollBtn.addEventListener("click", playerRoll);
  undoBtn.addEventListener("click", undoChunk);
  confirmBtn.addEventListener("click", () => {
    if (Game.phase === "confirm") endPlayerTurn(false);
  });
  ratingEl.addEventListener("click", hideToast);

  boardEl.addEventListener("pointerdown", onPointerDown);
  boardEl.addEventListener("pointermove", onPointerMove);
  boardEl.addEventListener("pointerup", onPointerUp);
  boardEl.addEventListener("pointercancel", onPointerUp);

  if (window.ResizeObserver) new ResizeObserver(fitBoard).observe($("#board-area"));
  window.addEventListener("resize", fitBoard);
  window.addEventListener("orientationchange", () => setTimeout(fitBoard, 150));
  /* מדידה חוזרת אחרי שהפריסה והגופנים התייצבו */
  requestAnimationFrame(() => requestAnimationFrame(fitBoard));
  window.addEventListener("load", fitBoard);

  /* ---------- התקנה כאפליקציה ----------
     נרשם רק ב-http/https; מ-file:// דפדפנים חוסמים service worker. */
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  /* ---------- התחלה ---------- */
  buildBoard();
  buildWelcome();
  Game.state = initialState();
  Game.view = Game.state;
  render();
  showScreen(Profiles.isNew ? "welcome" : "home");

  window.__bg = {
    Game, GEO, Stats, Profiles, Sfx, render, newGame, playerRoll, aiTurn, endPlayerTurn,
    updateButtons, gameOver, showStatsModal, showScreen, startGame, fitBoard,
    startTimer, stopTimer, resign, requestRematch,
    enterReplay, exitReplay, replayGoto, drawSummaryCard, shareSummary, setBoardTheme,
    Tutorial, TUT_STEPS, performSwap, showDoubleChooser,
    offerDraw, drawEnd, showDrawOfferModal,
    openCoach, closeCoach, coachShow,
    setVariant: v => { pendingVariant = v; onlineVariant = v; Game.variant = v; },
  };

})();
