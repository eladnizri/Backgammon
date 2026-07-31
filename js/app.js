"use strict";

/* ==========================================================================
   app.js — ממשק המשתמש ובקרת המשחק
   השחקן הוא תמיד לבן ונע מנקודה 24 (למעלה-ימין) אל הבית (למטה-ימין).
   ========================================================================== */

(function () {

  const $ = sel => document.querySelector(sel);

  /* ---------- גאומטריה (אחוזים מתוך הלוח) ---------- */
  const GEO = {
    pointW: 6.55,
    leftQuadX: 2.4, barX: 41.7, barW: 8.6, rightQuadX: 50.3, trayX: 89.6, trayW: 8,
    topY: 3.8, rowH: 40, bottomEdge: 96.2,
    checkerD: 6.0, AR: 1.6,
  };
  const DH = GEO.checkerD * GEO.AR; // גובה חייל באחוזי גובה הלוח

  /* מיקום אופקי של נקודה לפי אינדקס */
  function pointX(idx) {
    let col, baseX;
    if (idx >= 12 && idx <= 17) { col = idx - 12; baseX = GEO.leftQuadX; }
    else if (idx >= 18) { col = idx - 18; baseX = GEO.rightQuadX; }
    else if (idx >= 6) { col = 11 - idx; baseX = GEO.leftQuadX; }
    else { col = 5 - idx; baseX = GEO.rightQuadX; }
    return baseX + col * GEO.pointW;
  }
  const isTop = idx => idx >= 12;

  /* מיקום חייל במחסנית של נקודה */
  function slotPos(idx, k, total) {
    const left = pointX(idx) + GEO.pointW / 2 - GEO.checkerD / 2;
    const maxSpan = GEO.rowH - DH;
    const spacing = (total <= 1) ? DH : Math.min(DH, maxSpan / (total - 1));
    const top = isTop(idx)
      ? GEO.topY + k * spacing
      : GEO.bottomEdge - DH - k * spacing;
    return { left, top };
  }

  function barSlotPos(color, k) {
    const left = GEO.barX + GEO.barW / 2 - GEO.checkerD / 2;
    const top = color === WHITE ? 12 + k * DH * 0.75 : 88 - DH - k * DH * 0.75;
    return { left, top };
  }

  /* ---------- מצב המשחק ---------- */
  const Game = {
    state: null,
    phase: "opening",       // opening | rolling | playerMove | ai | playerRoll | over
    level: "medium",
    dice: [],               // הזריקה הנוכחית [a,b]
    diceWho: null,          // WHITE | BLACK
    aiUsed: [],             // קוביות שהמחשב כבר השתמש בהן (לאנימציה)
    turnStart: null,
    turnsResult: null,
    prefix: [],             // מהלכים שבוצעו בתור הנוכחי
    chunks: [],             // גדלי צעדים לצורך "בטל"
    displayState: null,
    options: [],
    sources: new Set(),
    selected: null,         // { from, chains }
    ratings: [],
    turnNumber: 0,
    toastTimer: null,
  };

  const boardEl = $("#board");
  const statusEl = $("#status-text");
  const rollBtn = $("#roll-btn");
  const undoBtn = $("#undo-btn");
  const confirmBtn = $("#confirm-btn");
  const toastEl = $("#toast");

  let checkLayer, diceLayer, pointEls = [], trayEls = {};

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
      p.dataset.idx = idx;
      boardEl.appendChild(p);
      pointEls[idx] = p;

      const num = document.createElement("div");
      num.className = `pnum ${isTop(idx) ? "top" : "bottom"}`;
      num.style.left = pointX(idx) + "%";
      num.textContent = idx + 1; // מספור מנקודת מבט השחקן (לבן)
      boardEl.appendChild(num);
    }

    const bar = document.createElement("div");
    bar.className = "bar";
    boardEl.appendChild(bar);

    for (const [cls, color] of [["black", BLACK], ["white", WHITE]]) {
      const t = document.createElement("div");
      t.className = "tray " + cls;
      boardEl.appendChild(t);
      trayEls[color] = t;
    }

    diceLayer = document.createElement("div");
    boardEl.appendChild(diceLayer);

    checkLayer = document.createElement("div");
    boardEl.appendChild(checkLayer);
  }

  /* ---------- רינדור ---------- */

  function makeChecker(color, left, top, opts = {}) {
    const el = document.createElement("div");
    el.className = "checker " + (color === WHITE ? "w" : "b");
    el.style.left = left + "%";
    el.style.top = top + "%";
    el.style.width = GEO.checkerD + "%";
    if (opts.count) {
      const c = document.createElement("span");
      c.className = "cnt";
      c.textContent = opts.count;
      el.appendChild(c);
    }
    if (opts.src !== undefined) {
      el.dataset.src = opts.src;
      el.classList.add("movable");
    }
    checkLayer.appendChild(el);
    return el;
  }

  function makeDie(value, xPct, yPct, used, rolling, small) {
    const el = document.createElement("div");
    el.className = "die" + (used ? " used" : "") + (rolling ? " rolling" : "");
    if (small) el.style.width = "4.3%";
    el.style.left = xPct + "%";
    el.style.top = yPct + "%";
    const layout = {
      1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
    }[value] || [];
    const grid = document.createElement("div");
    grid.className = "die-grid";
    for (let i = 0; i < 9; i++) {
      const d = document.createElement("span");
      d.className = "pip-dot";
      if (layout.includes(i)) d.style.visibility = "visible";
      grid.appendChild(d);
    }
    el.appendChild(grid);
    diceLayer.appendChild(el);
    return el;
  }

  function renderDice(rolling = false) {
    diceLayer.innerHTML = "";
    if (!Game.dice.length) return;
    const isDouble = Game.dice[0] === Game.dice[1];
    const values = isDouble ? [Game.dice[0], Game.dice[0], Game.dice[0], Game.dice[0]] : Game.dice;

    // כמה שימושים בכל ערך כבר בוצעו
    const usedList = Game.diceWho === WHITE
      ? Game.prefix.map(m => m.die)
      : Game.aiUsed;
    let usedLeft = usedList.slice();
    const usedFlags = values.map(v => {
      const i = usedLeft.indexOf(v);
      if (i >= 0) { usedLeft.splice(i, 1); return true; }
      return false;
    });

    const quadCenter = Game.diceWho === WHITE
      ? GEO.rightQuadX + 6 * GEO.pointW / 2
      : GEO.leftQuadX + 6 * GEO.pointW / 2;
    const w = isDouble ? 4.3 : 5.2;
    const gap = 1.1;
    const totalW = values.length * w + (values.length - 1) * gap;
    const yPct = 50 - (w * GEO.AR) / 2;
    values.forEach((v, i) => {
      const x = quadCenter - totalW / 2 + i * (w + gap);
      makeDie(v, x, yPct, usedFlags[i], rolling, isDouble);
    });
  }

  function render(opts = {}) {
    const s = (Game.phase === "playerMove" && Game.displayState) ? Game.displayState : Game.state;
    if (!s) return;
    checkLayer.innerHTML = "";

    // נקודות
    for (let idx = 0; idx < 24; idx++) {
      const v = s.points[idx];
      if (v === 0) continue;
      const color = v > 0 ? WHITE : BLACK;
      const n = Math.abs(v);
      for (let k = 0; k < n; k++) {
        const pos = slotPos(idx, k, n);
        const topOfStack = k === n - 1;
        const markSrc = Game.phase === "playerMove" && color === WHITE &&
          topOfStack && Game.sources.has(idx);
        makeChecker(color, pos.left, pos.top, {
          count: (topOfStack && n > 5) ? n : null,
          src: markSrc ? idx : undefined,
        });
      }
    }

    // חיילים על הבר
    for (const color of [WHITE, BLACK]) {
      const n = s.bar[color];
      for (let k = 0; k < n; k++) {
        const pos = barSlotPos(color, k);
        const topOfStack = k === n - 1;
        const markSrc = Game.phase === "playerMove" && color === WHITE &&
          topOfStack && Game.sources.has("bar");
        makeChecker(color, pos.left, pos.top, {
          count: (topOfStack && n > 1) ? n : null,
          src: markSrc ? "bar" : undefined,
        });
      }
    }

    // מגשי הורדה
    for (const color of [WHITE, BLACK]) {
      const t = trayEls[color];
      t.innerHTML = "";
      t.classList.remove("dest-hl");
      const n = s.off[color];
      for (let k = 0; k < Math.min(n, 15); k++) {
        const piece = document.createElement("div");
        piece.className = "off-piece " + (color === WHITE ? "w" : "b");
        if (color === WHITE) piece.style.bottom = (2 + k * 6.2) + "%";
        else piece.style.top = (2 + k * 6.2) + "%";
        t.appendChild(piece);
      }
      if (n > 0) {
        const cnt = document.createElement("div");
        cnt.className = "off-count";
        cnt.textContent = n;
        t.appendChild(cnt);
      }
    }

    renderDice(opts.diceRolling);
    renderSelection();

    $("#pip-white").textContent = pipCount(s, WHITE);
    $("#pip-black").textContent = pipCount(s, BLACK);
  }

  function clearDestHighlights() {
    document.querySelectorAll(".dest-marker").forEach(el => el.remove());
    pointEls.forEach(p => p.classList.remove("dest-hl"));
    trayEls[WHITE].classList.remove("dest-hl");
  }

  function renderSelection() {
    clearDestHighlights();
    if (!Game.selected) return;
    const s = Game.displayState;
    // סימון החייל הנבחר
    const srcEl = checkLayer.querySelector(`[data-src="${Game.selected.from}"]`);
    if (srcEl) srcEl.classList.add("selected");
    for (const ch of Game.selected.chains) {
      if (ch.dest === "off") {
        trayEls[WHITE].classList.add("dest-hl");
        trayEls[WHITE].dataset.dest = "off";
        continue;
      }
      const idx = ch.dest;
      pointEls[idx].classList.add("dest-hl");
      const n = Math.abs(s.points[idx]);
      const pos = slotPos(idx, Math.min(n, 4), Math.max(n + 1, 1));
      const mk = document.createElement("div");
      mk.className = "dest-marker" + (s.points[idx] === -1 ? " hit" : "");
      mk.style.left = pos.left + "%";
      mk.style.top = pos.top + "%";
      mk.dataset.dest = idx;
      checkLayer.appendChild(mk);
    }
  }

  /* ---------- סטטוס וכפתורים ---------- */

  function status(html) { statusEl.innerHTML = html; }

  function updateButtons() {
    rollBtn.hidden = !(Game.phase === "opening" || Game.phase === "playerRoll");
    undoBtn.hidden = !(Game.phase === "playerMove" && Game.prefix.length > 0);
    confirmBtn.hidden = !(Game.phase === "playerMove" &&
      Game.turnsResult && Game.turnsResult.maxLen > 0 && Game.options.length === 0);
  }

  /* ---------- עזרי טקסט ---------- */

  const d6 = () => 1 + Math.floor(Math.random() * 6);
  const delay = ms => new Promise(res => setTimeout(res, ms));

  /* פורמט מהלך בודד, בטוח לכיווניות RTL. המספרים תואמים למספרי הלוח. */
  function moveHtml(m) {
    const hit = m.hit ? " ✱" : "";
    if (m.from === "bar") return `כניסה ל־${m.to + 1}${hit}`;
    if (m.to === "off") return `הורדה מ־${m.from + 1}`;
    return `<span dir="ltr">${m.from + 1}➜${m.to + 1}</span>${hit}`;
  }

  function movesHtml(moves) {
    return moves.map(moveHtml).join(" · ");
  }

  /* ---------- זרימת המשחק ---------- */

  function newGame() {
    Game.state = initialState();
    Game.displayState = null;
    Game.ratings = [];
    Game.turnNumber = 0;
    Game.dice = [];
    Game.diceWho = null;
    Game.prefix = [];
    Game.chunks = [];
    Game.options = [];
    Game.sources = new Set();
    Game.selected = null;
    Game.phase = "opening";
    Game.level = $("#level").value;
    hideToast();
    hideModal();
    updateAvgChip();
    status("זריקת פתיחה — מי שמוציא מספר גבוה יותר מתחיל. בהצלחה! 🎲");
    updateButtons();
    render();
  }

  async function openingRoll() {
    Game.phase = "rolling";
    updateButtons();
    const p = d6(), a = d6();
    // מציגים את שתי הקוביות: של השחקן מימין, של המחשב משמאל
    diceLayer.innerHTML = "";
    const y = 50 - (5.2 * GEO.AR) / 2;
    makeDie(p, GEO.rightQuadX + 6 * GEO.pointW / 2 - 2.6, y, false, true);
    makeDie(a, GEO.leftQuadX + 6 * GEO.pointW / 2 - 2.6, y, false, true);
    await delay(800);
    if (p === a) {
      status(`תיקו (${p}-${a}) — זורקים שוב...`);
      await delay(900);
      Game.phase = "opening";
      openingRoll();
      return;
    }
    if (p > a) {
      status(`הוצאת <b>${p}</b> מול <b>${a}</b> — אתה מתחיל!`);
      await delay(700);
      startPlayerTurn([p, a], false);
    } else {
      status(`הוצאת <b>${p}</b> מול <b>${a}</b> — המחשב מתחיל.`);
      await delay(700);
      aiTurn([p, a]);
    }
  }

  function startPlayerTurn(dice, withRollAnim = true) {
    Game.dice = dice;
    Game.diceWho = WHITE;
    Game.turnStart = Game.state;
    Game.displayState = Game.state;
    Game.prefix = [];
    Game.chunks = [];
    Game.selected = null;
    Game.turnNumber++;
    Game.turnsResult = generateTurns(Game.state, WHITE, dice);
    Game.phase = "playerMove";
    updateOptions();

    if (Game.turnsResult.maxLen === 0) {
      status(`יצא <b>${dice[0]}-${dice[1]}</b> — אין לך מהלכים אפשריים 😕`);
      updateButtons();
      render({ diceRolling: withRollAnim });
      setTimeout(() => endPlayerTurn(true), 1700);
      return;
    }

    let hint = "גרור חייל מסומן או לחץ עליו כדי לראות יעדים.";
    if (Game.state.bar[WHITE] > 0) hint = "יש לך חייל על הבר — חובה להכניס אותו קודם!";
    const doubleTxt = dice[0] === dice[1] ? " דאבל! ארבעה מהלכים." : "";
    status(`יצא <b>${dice[0]}-${dice[1]}</b>.${doubleTxt} ${hint}`);
    updateButtons();
    render({ diceRolling: withRollAnim });
  }

  function updateOptions() {
    Game.options = nextMoveOptions(Game.turnsResult, Game.prefix);
    Game.sources = new Set(Game.options.map(m => m.from));
  }

  function applyChain(chain) {
    for (const m of chain.moves) {
      const r = applyMove(Game.displayState, WHITE, m);
      Game.displayState = r.state;
      Game.prefix.push(m);
    }
    Game.chunks.push(chain.moves.length);
    Game.selected = null;
    updateOptions();
    updateButtons();
    render();
    if (Game.options.length === 0) {
      status("סיימת את המהלכים — לחץ <b>סיים תור</b> לאישור, או בטל וחשוב שוב.");
    }
  }

  function undoChunk() {
    if (!Game.chunks.length) return;
    const n = Game.chunks.pop();
    Game.prefix.length -= n;
    let s = Game.turnStart;
    for (const m of Game.prefix) s = applyMove(s, WHITE, m).state;
    Game.displayState = s;
    Game.selected = null;
    updateOptions();
    updateButtons();
    render();
    status("המהלך בוטל — נסה שוב.");
  }

  function endPlayerTurn(noMoves = false) {
    Game.state = Game.displayState;
    Game.selected = null;
    Game.phase = "ai";
    updateButtons();
    clearDestHighlights();

    if (!noMoves) {
      const r = rateTurn(Game.turnStart, WHITE, Game.dice, Game.state);
      if (!r.noMoves) {
        r.turn = Game.turnNumber;
        r.dice = Game.dice.slice();
        r.moves = Game.prefix.slice();
        Game.ratings.push(r);
        showToast(r);
        updateAvgChip();
      }
    }
    render();

    if (winner(Game.state) === WHITE) return gameOver(WHITE);
    setTimeout(() => aiTurn([d6(), d6()]), noMoves ? 500 : 1200);
  }

  async function aiTurn(dice) {
    Game.phase = "ai";
    Game.dice = dice;
    Game.diceWho = BLACK;
    Game.aiUsed = [];
    updateButtons();
    render({ diceRolling: true });
    status(`המחשב הטיל <b>${dice[0]}-${dice[1]}</b>... חושב 🤔`);
    await delay(750);

    const tr = generateTurns(Game.state, BLACK, dice);
    if (tr.maxLen === 0) {
      status(`המחשב הטיל <b>${dice[0]}-${dice[1]}</b> — אין לו מהלכים!`);
      await delay(1300);
      return playerRollPhase();
    }

    const choice = await new Promise(res =>
      setTimeout(() => res(chooseAiTurn(Game.state, BLACK, dice, Game.level, tr)), 30));

    for (const m of choice.moves) {
      Game.state = applyMove(Game.state, BLACK, m).state;
      Game.aiUsed.push(m.die);
      render();
      await delay(560);
    }
    status(`המחשב שיחק: ${movesHtml(choice.moves)}${choice.moves.some(m => m.hit) ? " — הכה חייל שלך! 😬" : ""}`);
    if (winner(Game.state) === BLACK) return gameOver(BLACK);
    playerRollPhase();
  }

  function playerRollPhase() {
    Game.phase = "playerRoll";
    updateButtons();
    render();
    const cur = statusEl.innerHTML;
    status(cur + " <b>תורך — הטל קוביות!</b>");
  }

  /* ---------- אינטראקציה: גרירה ולחיצה ---------- */

  let drag = null;

  function pctCoords(e) {
    const r = boardEl.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * 100,
      y: (e.clientY - r.top) / r.height * 100,
    };
  }

  function hitTest(x, y) {
    if (x >= GEO.trayX && x <= GEO.trayX + GEO.trayW) {
      return { type: "off" };
    }
    if (x >= GEO.barX && x <= GEO.barX + GEO.barW) return { type: "bar" };
    let col = -1, base = null;
    if (x >= GEO.leftQuadX && x < GEO.barX) { base = "L"; col = Math.floor((x - GEO.leftQuadX) / GEO.pointW); }
    else if (x >= GEO.rightQuadX && x < GEO.trayX) { base = "R"; col = Math.floor((x - GEO.rightQuadX) / GEO.pointW); }
    if (col < 0 || col > 5) return null;
    const top = y < 50;
    let idx;
    if (top) idx = base === "L" ? 12 + col : 18 + col;
    else idx = base === "L" ? 11 - col : 5 - col;
    return { type: "point", idx };
  }

  function chainsFor(from) {
    return chainOptionsFrom(Game.turnsResult, Game.prefix, from);
  }

  function onPointerDown(e) {
    if (Game.phase !== "playerMove") return;
    const t = e.target;

    // לחיצה על סמן יעד
    const destEl = t.closest ? t.closest("[data-dest]") : null;
    if (destEl && Game.selected) {
      const dest = destEl.dataset.dest === "off" ? "off" : Number(destEl.dataset.dest);
      const chain = Game.selected.chains.find(c => c.dest === dest);
      if (chain) { applyChain(chain); return; }
    }

    // לחיצה על חייל שאפשר להזיז — תחילת גרירה אפשרית
    const srcEl = t.closest ? t.closest("[data-src]") : null;
    if (srcEl) {
      const from = srcEl.dataset.src === "bar" ? "bar" : Number(srcEl.dataset.src);
      const p = pctCoords(e);
      drag = {
        from, el: srcEl,
        startX: p.x, startY: p.y,
        moved: false,
        chains: chainsFor(from),
      };
      boardEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // לחיצה על נקודת יעד מודגשת (המשולש עצמו)
    if (Game.selected) {
      const p = pctCoords(e);
      const ht = hitTest(p.x, p.y);
      if (ht) {
        const dest = ht.type === "off" ? "off" : (ht.type === "point" ? ht.idx : null);
        const chain = Game.selected.chains.find(c => c.dest === dest);
        if (chain) { applyChain(chain); return; }
      }
      // לחיצה במקום אחר — ביטול בחירה
      Game.selected = null;
      renderSelection();
    }
  }

  function onPointerMove(e) {
    if (!drag) return;
    const p = pctCoords(e);
    if (!drag.moved && Math.hypot(p.x - drag.startX, (p.y - drag.startY) / GEO.AR) > 1.1) {
      drag.moved = true;
      drag.el.classList.add("dragging");
      // הצגת יעדים בזמן גרירה
      Game.selected = { from: drag.from, chains: drag.chains };
      renderSelection();
      drag.el.classList.add("dragging"); // renderSelection לא נוגע באלמנט עצמו
    }
    if (drag.moved) {
      drag.el.style.left = (p.x - GEO.checkerD / 2) + "%";
      drag.el.style.top = (p.y - DH / 2) + "%";
    }
  }

  function onPointerUp(e) {
    if (!drag) return;
    const cur = drag;
    drag = null;
    try { boardEl.releasePointerCapture(e.pointerId); } catch (_) { }

    if (!cur.moved) {
      // לחיצה — בחירה/ביטול בחירה
      if (Game.selected && Game.selected.from === cur.from) Game.selected = null;
      else Game.selected = { from: cur.from, chains: cur.chains };
      renderSelection();
      // סימון selected על החייל
      if (Game.selected) {
        const el = checkLayer.querySelector(`[data-src="${cur.from}"]`);
        if (el) el.classList.add("selected");
      }
      return;
    }

    // שחרור גרירה
    const p = pctCoords(e);
    const ht = hitTest(p.x, p.y);
    let chain = null;
    if (ht) {
      const dest = ht.type === "off" ? "off" : (ht.type === "point" ? ht.idx : null);
      chain = cur.chains.find(c => c.dest === dest) || null;
    }
    Game.selected = null;
    if (chain) applyChain(chain);
    else render(); // החזרה למקום
  }

  /* ---------- טוסט דירוג ---------- */

  function showToast(r) {
    clearTimeout(Game.toastTimer);
    const cls = r.forced ? "g-forced" : r.grade.cls;
    toastEl.className = cls;
    $("#toast-score").textContent = r.forced ? "✓" : r.score;
    $("#toast-grade").textContent = r.forced ? "מהלך כפוי" : `${r.grade.label} (${r.score})`;
    $("#toast-expl").textContent = r.explanation;
    const bestEl = $("#toast-best");
    if (r.bestMoves) {
      bestEl.innerHTML = "המהלך המומלץ היה: " + movesHtml(r.bestMoves);
      bestEl.hidden = false;
    } else {
      bestEl.hidden = true;
    }
    toastEl.hidden = false;
    const ms = (!r.forced && r.score < 70) ? 6500 : 4000;
    Game.toastTimer = setTimeout(hideToast, ms);
  }

  function hideToast() {
    toastEl.hidden = true;
    clearTimeout(Game.toastTimer);
  }

  function updateAvgChip() {
    const sum = summarizeRatings(Game.ratings);
    $("#avg-badge").textContent = sum.count ? sum.avg : "—";
    $("#avg-chip").title = sum.count
      ? `ממוצע מהלכים: ${sum.avg} — לחץ לסיכום ביניים`
      : "עוד אין מהלכים שנמדדו — לחץ לסיכום ביניים";
  }

  /* ---------- מודאל סיכום ---------- */

  function summaryHtml(sum, final) {
    if (!sum.count) return `<p class="note">עוד לא בוצעו מהלכים שנמדדו.</p>`;
    let html = `
      <div class="overall ${sum.grade.cls}"><span class="num">${sum.avg}</span><span class="lbl">ציון כולל</span></div>
      <div class="overall-grade ${sum.grade.cls}">${overallText(sum.avg)}</div>
      <div class="dist">
        ${sum.dist.map(d => `<span class="chip ${d.cls}">${d.label} ×${d.count}</span>`).join("")}
      </div>
      <p class="note">${sum.count} מהלכים נמדדו (מהלכים כפויים אינם נספרים)</p>`;
    if (sum.worst.length) {
      html += `<div class="worst"><h3>מהלכים לשיפור:</h3><ul>` +
        sum.worst.map(r =>
          `<li>תור ${r.turn} (קוביות ${r.dice[0]}-${r.dice[1]}) — <span class="sc ${r.grade.cls}" style="color:var(--grade-color)">${r.score}</span>. ${r.explanation}</li>`
        ).join("") + `</ul></div>`;
    }
    return html;
  }

  function overallText(avg) {
    if (avg >= 95) return "משחק ברמת אלוף! 🏆";
    if (avg >= 85) return "משחק מצוין!";
    if (avg >= 70) return "משחק טוב מאוד";
    if (avg >= 55) return "משחק סביר — יש לאן להשתפר";
    return "כדאי להתאמן — המאמן כאן בשבילך";
  }

  function showModal(html) {
    $("#modal").innerHTML = html;
    $("#modal-backdrop").hidden = false;
  }
  function hideModal() { $("#modal-backdrop").hidden = true; }

  function showMidSummary() {
    hideToast();
    const sum = summarizeRatings(Game.ratings);
    showModal(`
      <h2>סיכום ביניים</h2>
      ${summaryHtml(sum, false)}
      <div class="actions"><button class="btn primary" id="modal-close">המשך משחק</button></div>
    `);
    $("#modal-close").onclick = hideModal;
  }

  function gameOver(winColor) {
    Game.phase = "over";
    updateButtons();
    hideToast();
    const kind = winKind(Game.state, winColor);
    const kindTxt = { 1: "ניצחון רגיל", 2: "מארס! (ניצחון כפול)", 3: "מארס טורקי! (ניצחון משולש)" }[kind];
    const sum = summarizeRatings(Game.ratings);
    const title = winColor === WHITE ? "🎉 ניצחת!" : "המחשב ניצח 🤖";
    const sub = winColor === WHITE ? kindTxt : `${kindTxt} — לא נורא, נסה שוב!`;
    showModal(`
      <h2>${title}</h2>
      <div class="win-kind">${sub}</div>
      ${summaryHtml(sum, true)}
      <div class="actions">
        <button class="btn primary big" id="modal-new">משחק חדש 🎲</button>
        <button class="btn" id="modal-close">סגור</button>
      </div>
    `);
    $("#modal-new").onclick = newGame;
    $("#modal-close").onclick = hideModal;
  }

  /* ---------- חיבור אירועים ---------- */

  rollBtn.addEventListener("click", () => {
    if (Game.phase === "opening") openingRoll();
    else if (Game.phase === "playerRoll") startPlayerTurn([d6(), d6()]);
  });
  undoBtn.addEventListener("click", undoChunk);
  confirmBtn.addEventListener("click", () => endPlayerTurn(false));
  $("#new-game").addEventListener("click", newGame);
  $("#avg-chip").addEventListener("click", showMidSummary);
  $("#level").addEventListener("change", e => { Game.level = e.target.value; });
  toastEl.addEventListener("click", hideToast);

  boardEl.addEventListener("pointerdown", onPointerDown);
  boardEl.addEventListener("pointermove", onPointerMove);
  boardEl.addEventListener("pointerup", onPointerUp);
  boardEl.addEventListener("pointercancel", onPointerUp);

  /* ---------- התחלה ---------- */
  buildBoard();
  newGame();

  // חשוף לצורכי בדיקות אוטומטיות בלבד
  window.__bg = { Game, render, startPlayerTurn, aiTurn, newGame, endPlayerTurn, updateButtons };

})();
