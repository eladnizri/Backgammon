"use strict";

/* ==========================================================================
   rules.js — חוקי שש-בש: ייצוג מצב, מהלכים חוקיים, יצירת כל התורות האפשריים
   ==========================================================================
   ייצוג הלוח: מערך של 24 נקודות (אינדקסים 0..23).
   ערך חיובי = חיילים לבנים, ערך שלילי = חיילים שחורים.
   לבן (השחקן) נע מאינדקס 23 לכיוון 0, ומוריד חיילים מהבית (אינדקסים 0..5).
   שחור (המחשב) נע מאינדקס 0 לכיוון 23, ומוריד חיילים מהבית (18..23).
   ========================================================================== */

const WHITE = 1;
const BLACK = -1;

function initialState() {
  const points = new Array(24).fill(0);
  // פריסה קלאסית — לבן
  points[23] = 2;   // נקודה 24
  points[12] = 5;   // נקודה 13
  points[7] = 3;    // נקודה 8
  points[5] = 5;    // נקודה 6
  // שחור (מראה)
  points[0] = -2;
  points[11] = -5;
  points[16] = -3;
  points[18] = -5;
  return {
    points,
    bar: { [WHITE]: 0, [BLACK]: 0 },
    off: { [WHITE]: 0, [BLACK]: 0 },
  };
}

function cloneState(s) {
  return {
    points: s.points.slice(),
    bar: { [WHITE]: s.bar[WHITE], [BLACK]: s.bar[BLACK] },
    off: { [WHITE]: s.off[WHITE], [BLACK]: s.off[BLACK] },
  };
}

function stateKey(s) {
  return s.points.join(",") + "|" + s.bar[WHITE] + "," + s.bar[BLACK] +
    "|" + s.off[WHITE] + "," + s.off[BLACK];
}

function ownCount(s, i, c) {
  const v = s.points[i];
  return v * c > 0 ? Math.abs(v) : 0;
}

function isBlocked(s, i, c) {
  const v = s.points[i];
  return v * c < 0 && Math.abs(v) >= 2;
}

// המרחק של נקודה מהיציאה, מנקודת המבט של הצבע הנתון (1..24)
function pipOf(i, c) {
  return c === WHITE ? i + 1 : 24 - i;
}

function pipCount(s, c) {
  let t = s.bar[c] * 25;
  for (let i = 0; i < 24; i++) {
    const n = ownCount(s, i, c);
    if (n) t += n * pipOf(i, c);
  }
  return t;
}

function allInHome(s, c) {
  if (s.bar[c] > 0) return false;
  if (c === WHITE) {
    for (let i = 6; i < 24; i++) if (s.points[i] > 0) return false;
  } else {
    for (let i = 0; i < 18; i++) if (s.points[i] < 0) return false;
  }
  return true;
}

/* כל המהלכים הבודדים החוקיים עבור קובייה אחת */
function legalSingleMoves(s, c, die) {
  const moves = [];
  if (s.bar[c] > 0) {
    // חובה להכניס מהבר קודם
    const dest = c === WHITE ? 24 - die : die - 1;
    if (!isBlocked(s, dest, c)) moves.push({ from: "bar", to: dest });
    return moves;
  }
  for (let i = 0; i < 24; i++) {
    if (ownCount(s, i, c) === 0) continue;
    const dest = c === WHITE ? i - die : i + die;
    if (dest >= 0 && dest <= 23) {
      if (!isBlocked(s, dest, c)) moves.push({ from: i, to: dest });
    } else {
      // הורדה מהלוח
      if (!allInHome(s, c)) continue;
      const pip = pipOf(i, c);
      if (pip === die) {
        moves.push({ from: i, to: "off" });
      } else if (pip < die) {
        // קובייה גדולה מהנקודה — מותר רק אם זו הנקודה הרחוקה ביותר
        let farther = false;
        if (c === WHITE) {
          for (let j = i + 1; j <= 5; j++) if (s.points[j] > 0) { farther = true; break; }
        } else {
          for (let j = 18; j < i; j++) if (s.points[j] < 0) { farther = true; break; }
        }
        if (!farther) moves.push({ from: i, to: "off" });
      }
    }
  }
  return moves;
}

/* החלת מהלך בודד; מחזיר מצב חדש + האם הייתה הכאה */
function applyMove(s, c, move) {
  const ns = cloneState(s);
  let hit = false;
  if (move.from === "bar") ns.bar[c]--;
  else ns.points[move.from] -= c;
  if (move.to === "off") {
    ns.off[c]++;
  } else {
    if (ns.points[move.to] === -c) {
      // הכאת חייל בודד של היריב
      ns.points[move.to] = 0;
      ns.bar[-c]++;
      hit = true;
    }
    ns.points[move.to] += c;
  }
  return { state: ns, hit };
}

/* ==========================================================================
   יצירת כל התורות המלאים האפשריים עבור זריקת קוביות.
   מיישם את החוקים: חובה לשחק כמה שיותר קוביות; אם אפשר לשחק רק קובייה
   אחת (ושתיהן ניתנות לשחק בנפרד) — חובה לשחק את הגבוהה.
   מחזיר: { sequences: [{moves, state}], maxLen }
   ========================================================================== */
function generateTurns(state, color, dice) {
  const isDouble = dice[0] === dice[1];
  const dieSeqs = isDouble
    ? [[dice[0], dice[0], dice[0], dice[0]]]
    : [[dice[0], dice[1]], [dice[1], dice[0]]];

  const sequences = [];
  let maxLen = 0;

  function rec(s, dies, di, moves) {
    let extended = false;
    if (di < dies.length) {
      const ms = legalSingleMoves(s, color, dies[di]);
      for (const m of ms) {
        extended = true;
        const r = applyMove(s, color, m);
        rec(r.state, dies, di + 1, moves.concat([{ from: m.from, to: m.to, die: dies[di], hit: r.hit }]));
      }
    }
    if (!extended) {
      if (moves.length > maxLen) maxLen = moves.length;
      sequences.push({ moves, state: s });
    }
  }
  for (const seq of dieSeqs) rec(state, seq, 0, []);

  if (maxLen === 0) {
    return { sequences: [{ moves: [], state }], maxLen: 0 };
  }

  let maximal = sequences.filter(q => q.moves.length === maxLen);
  if (!isDouble && maxLen === 1) {
    const hi = Math.max(dice[0], dice[1]);
    const withHi = maximal.filter(q => q.moves[0].die === hi);
    if (withHi.length > 0) maximal = withHi;
  }

  // הסרת רצפים כפולים זהים
  const seen = new Set();
  const uniq = [];
  for (const q of maximal) {
    const k = q.moves.map(m => m.from + ">" + m.to + "#" + m.die).join(";");
    if (!seen.has(k)) { seen.add(k); uniq.push(q); }
  }
  return { sequences: uniq, maxLen };
}

/* מצבים סופיים ייחודיים מתוך תוצאת generateTurns */
function uniqueFinalStates(turnsResult) {
  const map = new Map();
  for (const q of turnsResult.sequences) {
    const k = stateKey(q.state);
    if (!map.has(k)) map.set(k, q);
  }
  return [...map.values()];
}

function movesMatchPrefix(seqMoves, prefix) {
  if (seqMoves.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    const a = seqMoves[i], b = prefix[i];
    if (a.from !== b.from || a.to !== b.to || a.die !== b.die) return false;
  }
  return true;
}

/* אפשרויות המהלך הבודד הבא, בהינתן מהלכים שכבר בוצעו בתור (prefix) */
function nextMoveOptions(turnsResult, prefix) {
  const opts = [];
  const seen = new Set();
  for (const q of turnsResult.sequences) {
    if (q.moves.length <= prefix.length) continue;
    if (!movesMatchPrefix(q.moves, prefix)) continue;
    const m = q.moves[prefix.length];
    const k = m.from + ">" + m.to + "#" + m.die;
    if (!seen.has(k)) { seen.add(k); opts.push(m); }
  }
  return opts;
}

/* שרשראות מהלכים של אותו חייל מנקודת מוצא נתונה (מאפשר גרירה מקוצרת
   של שתי קוביות ויותר בבת אחת). לכל יעד נבחרת השרשרת עם הכי הרבה הכאות. */
function chainOptionsFrom(turnsResult, prefix, from) {
  const best = new Map(); // destKey -> {dest, moves, hits}
  for (const q of turnsResult.sequences) {
    if (!movesMatchPrefix(q.moves, prefix)) continue;
    if (q.moves.length <= prefix.length) continue;
    if (q.moves[prefix.length].from !== from) continue;
    let pos = from;
    const acc = [];
    for (let i = prefix.length; i < q.moves.length; i++) {
      const m = q.moves[i];
      if (m.from !== pos) break;
      acc.push(m);
      pos = m.to;
      const hits = acc.reduce((t, x) => t + (x.hit ? 1 : 0), 0);
      const key = String(pos);
      const cur = best.get(key);
      if (!cur || hits > cur.hits || (hits === cur.hits && acc.length < cur.moves.length)) {
        best.set(key, { dest: pos, moves: acc.slice(), hits });
      }
      if (pos === "off") break;
    }
  }
  return [...best.values()];
}

/* ==========================================================================
   שש-בש טורקי — ארבעה חוקים מיוחדים לזריקות מסוימות (מעל החוקים הרגילים):
   1-2  → החלפת צדדים בין השחקנים
   3-4  → השחקן בוחר איזה דאבל לשחק (1..6)
   5-6  → השחקן מעביר שני חיילים לכל נקודה פנויה, קדימה או אחורה
   דאבל → תור נוסף אחרי שמסיימים אותו
   ========================================================================== */

function classifyRoll(dice) {
  if (dice[0] === dice[1]) return "double";
  const lo = Math.min(dice[0], dice[1]), hi = Math.max(dice[0], dice[1]);
  if (lo === 1 && hi === 2) return "swap";
  if (lo === 3 && hi === 4) return "choose";
  if (lo === 5 && hi === 6) return "relocate";
  return "normal";
}

/* חוק 5-6: כל ההעברות החופשיות האפשריות של חייל בודד —
   מכל מקור (נקודה או בר) לכל נקודה שאינה חסומה על ידי היריב. */
function relocateSingleMoves(s, c) {
  const dests = [];
  for (let i = 0; i < 24; i++) if (!isBlocked(s, i, c)) dests.push(i);
  const moves = [];
  const addFrom = from => {
    for (const to of dests) if (to !== from) moves.push({ from, to });
  };
  if (s.bar[c] > 0) addFrom("bar");
  for (let i = 0; i < 24; i++) if (ownCount(s, i, c) > 0) addFrom(i);
  return moves;
}

/* האם נותק המגע בין הצבאות (מרוץ טהור) */
function isRace(s) {
  let maxW = -1, minB = 24;
  if (s.bar[WHITE] > 0) maxW = 25;
  if (s.bar[BLACK] > 0) minB = -2;
  for (let i = 0; i < 24; i++) {
    if (s.points[i] > 0 && i > maxW) maxW = i;
    if (s.points[i] < 0 && i < minB) minB = i;
  }
  return maxW < minB;
}

function winner(s) {
  if (s.off[WHITE] === 15) return WHITE;
  if (s.off[BLACK] === 15) return BLACK;
  return 0;
}

/* סוג הניצחון: 1 רגיל, 2 מארס (היריב לא הוריד כלום), 3 מארס טורקי */
function winKind(s, winColor) {
  const loser = -winColor;
  if (s.off[loser] > 0) return 1;
  // חייל של המפסיד בבית של המנצח או על הבר => מארס טורקי
  if (s.bar[loser] > 0) return 3;
  if (winColor === WHITE) {
    for (let i = 0; i <= 5; i++) if (s.points[i] < 0) return 3;
  } else {
    for (let i = 18; i <= 23; i++) if (s.points[i] > 0) return 3;
  }
  return 2;
}
