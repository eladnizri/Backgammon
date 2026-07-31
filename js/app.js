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
  };

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

  function pointX(idx) {
    let col, baseX;
    if (idx >= 12 && idx <= 17) { col = idx - 12; baseX = GEO.leftQuadX; }
    else if (idx >= 18) { col = idx - 18; baseX = GEO.rightQuadX; }
    else if (idx >= 6) { col = 11 - idx; baseX = GEO.leftQuadX; }
    else { col = 5 - idx; baseX = GEO.rightQuadX; }
    return baseX + col * GEO.pointW;
  }
  const isTop = idx => idx >= 12;

  /* מיקום חייל מספר k מתוך n בנקודה */
  function slotPos(idx, k, n) {
    const D = dh();
    const left = pointX(idx) + GEO.pointW / 2 - GEO.checkerD / 2;
    const maxSpan = GEO.rowH - D;
    const spacing = n <= 1 ? D : Math.min(D, maxSpan / (n - 1));
    const top = isTop(idx)
      ? GEO.padY + k * spacing
      : (100 - GEO.padY) - D - k * spacing;
    return { left, top };
  }

  function barSlotPos(color, k) {
    const D = dh();
    const left = GEO.barX + GEO.barW / 2 - GEO.checkerD / 2;
    const step = D * 0.62;
    const top = color === WHITE ? 52 + k * step : 48 - D - k * step;
    return { left, top };
  }

  /* חיילים שהורדו מתכווצים לכיוון הרצועה של השחקן (מעל/מתחת ללוח) */
  function offPos(color) {
    return {
      left: GEO.rightEdge - GEO.checkerD,
      top: color === WHITE ? 100 - GEO.padY - dh() : GEO.padY,
    };
  }

  /* ---------- צליל ורטט ---------- */
  const Sfx = {
    on: true, ctx: null,
    boot() {
      if (!this.on) return null;
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === "suspended") this.ctx.resume();
        return this.ctx;
      } catch (_) { return null; }
    },
    blip(freq, dur, type, vol) {
      const c = this.boot(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g).connect(c.destination);
      o.start(); o.stop(c.currentTime + dur);
    },
    noise(dur, vol) {
      const c = this.boot(); if (!c) return;
      const n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800;
      const g = c.createGain(); g.gain.value = vol;
      src.connect(f).connect(g).connect(c.destination);
      src.start();
    },
    place() { this.blip(420, 0.07, "triangle", 0.07); buzz(8); },
    roll()  { this.noise(0.22, 0.13); buzz(14); },
    hit()   { this.blip(140, 0.20, "sawtooth", 0.10); buzz([12, 40, 22]); },
    off()   { this.blip(880, 0.13, "sine", 0.08); },
    win()   { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.24, "sine", 0.09), i * 105)); },
    lose()  { [392, 330, 262].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, "sine", 0.08), i * 130)); },
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
    dice: [], diceWho: null, diceUsed: [],
    turnStart: null, turnsResult: null,
    prefix: [], chunks: [],
    view: null,        // המצב המוצג (כולל מהלכים חלקיים בתור הנוכחי)
    options: [], sources: new Set(),
    selected: null,
    ratings: [], turnNumber: 0,
    gen: 0,            // מבטל טיימרים ישנים אחרי "משחק חדש"
    toastTimer: null,
  };

  const boardEl = $("#board");
  const statusEl = $("#status-text");
  const rollBtn = $("#roll-btn");
  const undoBtn = $("#undo-btn");
  const ratingEl = $("#rating");

  let pieceLayer, diceLayer, pointEls = [], borneEls = {}, stripEls = {};
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
      p.className = `point ${isTop(idx) ? "top" : "bottom"} c${idx % 2}`;
      p.style.left = pointX(idx) + "%";
      p.style.width = GEO.pointW + "%";
      boardEl.appendChild(p);
      pointEls[idx] = p;

      const num = document.createElement("div");
      num.className = `pnum ${isTop(idx) ? "top" : "bottom"}`;
      num.style.left = pointX(idx) + "%";
      num.style.width = GEO.pointW + "%";
      num.textContent = idx + 1;
      boardEl.appendChild(num);
    }

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

    borneEls[WHITE] = buildBorne($("#borne-white"));
    borneEls[BLACK] = buildBorne($("#borne-black"));
    stripEls[WHITE] = $("#strip-me");
    stripEls[BLACK] = $("#strip-ai");

    /* מגש ההורדה יושב מחוץ ללוח, ולכן צריך מאזין משלו כדי שאפשר יהיה
       להוריד חייל בלחיצה ולא רק בגרירה. */
    borneEls[WHITE].host.addEventListener("pointerdown", e => {
      if (Game.phase !== "playerMove" || !Game.selected) return;
      const chain = Game.selected.chains.find(c => c.dest === "off");
      if (!chain) return;
      e.preventDefault();
      applyChain(chain);
    });
  }

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
        const movable = Game.phase === "playerMove" && color === WHITE &&
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
      borneEls[color].pips.forEach((b, i) => b.classList.toggle("on", i < n));
    }
    $("#pip-white").textContent = pipCount(s, WHITE);
    $("#pip-black").textContent = pipCount(s, BLACK);

    const myTurn = Game.phase === "playerMove" || Game.phase === "playerRoll";
    stripEls[WHITE].classList.toggle("active", myTurn);
    stripEls[BLACK].classList.toggle("active", Game.phase === "ai");
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

    const usedList = Game.diceWho === WHITE ? Game.prefix.map(m => m.die) : Game.diceUsed;
    const left = usedList.slice();
    const usedFlags = values.map(v => {
      const i = left.indexOf(v);
      if (i >= 0) { left.splice(i, 1); return true; }
      return false;
    });

    const quadCenter = Game.diceWho === WHITE
      ? GEO.rightQuadX + 3 * GEO.pointW
      : GEO.leftQuadX + 3 * GEO.pointW;
    const gap = w * 0.26;
    const totalW = values.length * w + (values.length - 1) * gap;
    const y = 50 - (w * GEO.AR) / 2;

    values.forEach((v, i) => {
      makeDie(v, quadCenter - totalW / 2 + i * (w + gap), y, w, {
        ai: Game.diceWho === BLACK,
        used: usedFlags[i],
        throw: throwAnim,
      });
    });
  }

  function clearMarks() {
    diceLayer.parentNode.querySelectorAll(".dest").forEach(el => el.remove());
    pointEls.forEach(p => p.classList.remove("dest-hl", "src-hl"));
    borneEls[WHITE].host.classList.remove("target");
  }

  function renderSelection() {
    clearMarks();
    if (!Game.selected) return;
    const s = Game.view;
    const src = topPiece.get(String(Game.selected.from));
    if (src) src.el.classList.add("selected");

    for (const ch of Game.selected.chains) {
      if (ch.dest === "off") { borneEls[WHITE].host.classList.add("target"); continue; }
      const idx = ch.dest;
      pointEls[idx].classList.add("dest-hl");
      const n = Math.abs(s.points[idx]);
      const isHit = s.points[idx] === -1;
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
    const canRoll = Game.phase === "playerRoll";
    rollBtn.hidden = !canRoll;
    undoBtn.hidden = !(Game.phase === "playerMove" && Game.prefix.length > 0 && Game.options.length > 0);
  }

  /* ---------- זרימת המשחק ---------- */

  function newGame() {
    Game.gen++;
    Game.state = initialState();
    Game.view = Game.state;
    Game.ratings = [];
    Game.turnNumber = 0;
    Game.dice = []; Game.diceWho = null; Game.diceUsed = [];
    Game.prefix = []; Game.chunks = [];
    Game.options = []; Game.sources = new Set();
    Game.selected = null;
    Game.phase = "playerRoll";
    hideToast(); hideModal(); hideSheet();
    updateAvgChip();
    updateButtons();
    render();
    status("תורך לפתוח — <b>הטל קוביות</b>");
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
    Game.dice = dice;
    Game.diceWho = WHITE;
    Game.prefix = [];
    renderDice(true);
    await delay(T.move);
    if (stale(g)) return;

    startPlayerTurn(dice);
  }

  function startPlayerTurn(dice) {
    const g = Game.gen;
    Game.turnStart = Game.state;
    Game.view = Game.state;
    Game.prefix = []; Game.chunks = [];
    Game.selected = null;
    Game.turnNumber++;
    Game.turnsResult = generateTurns(Game.state, WHITE, dice);
    Game.phase = "playerMove";
    refreshOptions();

    if (Game.turnsResult.maxLen === 0) {
      Game.phase = "blocked";
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

    const dbl = dice[0] === dice[1] ? " דאבל — ארבעה מהלכים!" : "";
    const hint = Game.state.bar[WHITE] > 0
      ? "יש לך חייל על הבר — חובה להכניס אותו"
      : "בחר חייל";
    status(`יצא <b>${dice[0]}-${dice[1]}</b>.${dbl} ${hint}`);
    updateButtons();
    render();
  }

  async function autoPlay(moves, g) {
    Game.phase = "auto";          // חוסם קלט בזמן שהמהלך הכפוי משוחק
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
    Game.options = nextMoveOptions(Game.turnsResult, Game.prefix);
    Game.sources = new Set(Game.options.map(m => m.from));
  }

  function commitMove(m) {
    Game.view = applyMove(Game.view, WHITE, m).state;
    Game.prefix.push(m);
    refreshOptions();
  }

  function applyChain(chain) {
    const g = Game.gen;
    for (const m of chain.moves) commitMove(m);
    Game.chunks.push(chain.moves.length);
    Game.selected = null;

    const hit = chain.moves.some(m => m.hit);
    const bore = chain.moves.some(m => m.to === "off");
    updateButtons();
    render();
    if (hit) Sfx.hit(); else if (bore) Sfx.off(); else Sfx.place();

    if (Game.options.length === 0) {
      Game.phase = "committing";
      updateButtons();
      setTimeout(() => { if (!stale(g)) endPlayerTurn(false); }, T.move + T.settle);
    } else {
      status(`נותרו מהלכים — ${Game.options.length === 1 ? "מהלך אחד" : "בחר חייל"}`);
    }
  }

  function undoChunk() {
    if (!Game.chunks.length) return;
    Game.prefix.length -= Game.chunks.pop();
    let s = Game.turnStart;
    for (const m of Game.prefix) s = applyMove(s, WHITE, m).state;
    Game.view = s;
    Game.selected = null;
    refreshOptions();
    updateButtons();
    render();
    status("בוטל — נסה שוב");
  }

  function endPlayerTurn(noMoves) {
    const g = Game.gen;
    Game.state = Game.view;
    Game.selected = null;
    Game.phase = "ai";
    updateButtons();
    clearMarks();

    if (!noMoves) {
      const r = rateTurn(Game.turnStart, WHITE, Game.dice, Game.state);
      if (!r.noMoves) {
        r.turn = Game.turnNumber;
        r.dice = Game.dice.slice();
        Game.ratings.push(r);
        showToast(r);
        updateAvgChip();
      }
    }
    render();

    if (winner(Game.state) === WHITE) return gameOver(WHITE);
    setTimeout(() => { if (!stale(g)) aiTurn(); }, noMoves ? 400 : T.handoff);
  }

  async function aiTurn() {
    const g = Game.gen;
    const dice = [d6(), d6()];
    Game.phase = "ai";
    Game.dice = dice;
    Game.diceWho = BLACK;
    Game.diceUsed = [];
    updateButtons();
    render();
    renderDice(true);
    Sfx.roll();
    status(`המחשב הטיל <b>${dice[0]}-${dice[1]}</b>`);
    await delay(T.aiThink);
    if (stale(g)) return;

    const tr = generateTurns(Game.state, BLACK, dice);
    if (tr.maxLen === 0) {
      status(`המחשב הטיל <b>${dice[0]}-${dice[1]}</b> — אין לו מהלך`);
      await delay(1100);
      if (!stale(g)) playerRollPhase();
      return;
    }

    const choice = chooseAiTurn(Game.state, BLACK, dice, Game.level, tr);
    for (const m of choice.moves) {
      await delay(T.aiStep);
      if (stale(g)) return;
      Game.state = applyMove(Game.state, BLACK, m).state;
      Game.view = Game.state;
      Game.diceUsed.push(m.die);
      render();
      if (m.hit) { Sfx.hit(); flashHit(); } else Sfx.place();
    }
    await delay(T.move);
    if (stale(g)) return;

    const hit = choice.moves.some(m => m.hit);
    status(`המחשב שיחק ${movesHtml(choice.moves)}${hit ? " — הכה אותך" : ""}`);
    if (winner(Game.state) === BLACK) return gameOver(BLACK);
    playerRollPhase();
  }

  function flashHit() {
    const p = topPiece.get("bar");
    if (p) { p.el.classList.add("hit-flash"); setTimeout(() => p.el.classList.remove("hit-flash"), 450); }
  }

  function playerRollPhase() {
    Game.phase = "playerRoll";
    Game.selected = null;
    updateButtons();
    render();
    status("תורך — <b>הטל קוביות</b>");
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
    const idx = top ? (base === "L" ? 12 + col : 18 + col)
                    : (base === "L" ? 11 - col : 5 - col);
    return { loc: idx };
  }

  /* מגש ההורדה יושב מחוץ ללוח, ולכן נבדק מול הקואורדינטות במסך */
  function overBearOff(e) {
    if (!Game.selected || !Game.selected.chains.some(c => c.dest === "off")) return false;
    const r = borneEls[WHITE].host.getBoundingClientRect();
    const pad = 14;
    return e.clientX >= r.left - pad && e.clientX <= r.right + pad &&
           e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
  }

  const chainsFor = from => chainOptionsFrom(Game.turnsResult, Game.prefix, from);

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
    if (Game.phase !== "playerMove") return;

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
      borneEls[WHITE].host.classList.toggle("target",
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
    ratingEl.hidden = false;
    statusEl.hidden = true;
    Game.toastTimer = setTimeout(hideToast, (!r.forced && r.score < 70) ? 5200 : 3400);
  }

  function hideToast() {
    clearTimeout(Game.toastTimer);
    ratingEl.hidden = true;
    statusEl.hidden = false;
  }

  function updateAvgChip() {
    const sum = summarizeRatings(Game.ratings);
    $("#avg-badge").textContent = sum.count ? sum.avg : "—";
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

  function showStats() {
    hideSheet(); hideToast();
    const sum = summarizeRatings(Game.ratings);
    showModal(`<h2>סיכום ביניים</h2>${summaryHtml(sum)}
      <div class="actions"><button class="pill-btn wide gold" id="m-close">המשך משחק</button></div>`);
    $("#m-close").onclick = hideModal;
  }

  function gameOver(winColor) {
    Game.phase = "over";
    Game.dice = [];
    updateButtons();
    hideToast();
    render();
    const kind = winKind(Game.state, winColor);
    const kindTxt = { 1: "ניצחון רגיל", 2: "מארס — ניצחון כפול", 3: "מארס טורקי — ניצחון משולש" }[kind];
    const sum = summarizeRatings(Game.ratings);
    winColor === WHITE ? Sfx.win() : Sfx.lose();
    status(winColor === WHITE ? "ניצחת!" : "המחשב ניצח");
    showModal(`
      <h2>${winColor === WHITE ? "ניצחת! 🎉" : "המחשב ניצח"}</h2>
      <div class="win-kind">${kindTxt}</div>
      ${summaryHtml(sum)}
      <div class="actions">
        <button class="pill-btn wide gold" id="m-new">משחק חדש</button>
        <button class="pill-btn" id="m-close">סגור</button>
      </div>`);
    $("#m-new").onclick = newGame;
    $("#m-close").onclick = hideModal;
  }

  /* ---------- גיליון הגדרות ---------- */

  function showSheet() { $("#sheet-backdrop").hidden = false; }
  function hideSheet() { $("#sheet-backdrop").hidden = true; }

  $("#menu-btn").onclick = showSheet;
  $("#sheet-backdrop").onclick = e => { if (e.target.id === "sheet-backdrop") hideSheet(); };
  $("#sheet-new").onclick = newGame;
  $("#sheet-stats").onclick = showStats;
  $("#avg-chip").onclick = showStats;

  $("#level-seg").onclick = e => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    Game.level = b.dataset.v;
    [...e.currentTarget.children].forEach(c => c.classList.toggle("on", c === b));
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

  /* ---------- התחלה ---------- */
  buildBoard();
  fitBoard();
  newGame();

  window.__bg = { Game, GEO, render, newGame, playerRoll, aiTurn, endPlayerTurn, updateButtons, gameOver, showStats };

})();
