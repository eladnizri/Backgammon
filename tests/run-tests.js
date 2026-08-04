"use strict";
/* בדיקות ליבה: node tests/run-tests.js */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = ["js/rules.js", "js/engine.js"]
  .map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8"))
  .join("\n");
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src, ctx);

// top-level const אינו נצמד לאובייקט הקונטקסט — שולפים בהערכה מפורשת
const {
  WHITE, BLACK, initialState, cloneState, pipCount, generateTurns,
  uniqueFinalStates, legalSingleMoves, applyMove, isRace, evaluate,
  rateTurn, nextMoveOptions, chainOptionsFrom, winKind,
  classifyRoll, relocateSingleMoves, isBlocked, aiChooseDouble, aiRelocate,
} = vm.runInContext(`({
  WHITE, BLACK, initialState, cloneState, pipCount, generateTurns,
  uniqueFinalStates, legalSingleMoves, applyMove, isRace, evaluate,
  rateTurn, nextMoveOptions, chainOptionsFrom, winKind,
  classifyRoll, relocateSingleMoves, isBlocked, aiChooseDouble, aiRelocate,
})`, ctx);

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { failed++; console.error("  ✗ FAILED: " + msg); }
}

function emptyState() {
  return {
    points: new Array(24).fill(0),
    bar: { [WHITE]: 0, [BLACK]: 0 },
    off: { [WHITE]: 0, [BLACK]: 0 },
  };
}

console.log("בדיקות מצב פתיחה:");
{
  const s = initialState();
  const w = s.points.reduce((t, v) => t + (v > 0 ? v : 0), 0);
  const b = s.points.reduce((t, v) => t + (v < 0 ? -v : 0), 0);
  assert(w === 15 && b === 15, "15 חיילים לכל צד");
  assert(pipCount(s, WHITE) === 167 && pipCount(s, BLACK) === 167, "פיפ פתיחה 167");
  assert(!isRace(s), "מצב פתיחה אינו מרוץ");
}

console.log("יצירת תורות — זריקת 3-1:");
{
  const s = initialState();
  const tr = generateTurns(s, WHITE, [3, 1]);
  assert(tr.maxLen === 2, "שתי קוביות ניתנות לשימוש");
  const finals = uniqueFinalStates(tr);
  // המהלך הקלאסי 8/5 6/5: idx7->4, idx5->4
  const has = finals.some(f => f.state.points[4] === 2 && f.state.points[7] === 2 && f.state.points[5] === 4);
  assert(has, "המהלך 8/5 6/5 קיים בין האפשרויות");
}

console.log("דאבל 6-6 מהפתיחה:");
{
  const s = initialState();
  const tr = generateTurns(s, WHITE, [6, 6]);
  assert(tr.maxLen === 4, "דאבל מאפשר 4 מהלכים");
}

console.log("חוק הקובייה הגבוהה:");
{
  const s = emptyState();
  s.points[12] = 1;       // חייל לבן בודד
  s.off[WHITE] = 14;
  s.points[1] = -2;       // חסימה באינדקס 1
  s.points[0] = -13;
  // קוביות 6,5: אפשר 12->6 או 12->7, אבל אחרי כל אחת השנייה חסומה (יעד 1)
  const tr = generateTurns(s, WHITE, [6, 5]);
  assert(tr.maxLen === 1, "רק קובייה אחת ניתנת לשימוש");
  assert(tr.sequences.every(q => q.moves[0].die === 6), "חובה לשחק את הקובייה הגבוהה (6)");
}

console.log("הורדה מהלוח:");
{
  const s = emptyState();
  s.points[2] = 2;
  s.points[4] = 1;
  s.off[WHITE] = 12;
  s.points[23] = -15;
  const ms = legalSingleMoves(s, WHITE, 6);
  const offs = ms.filter(m => m.to === "off");
  assert(offs.length === 1 && offs[0].from === 4, "קובייה 6 מורידה רק מהנקודה הרחוקה ביותר");
  const ms3 = legalSingleMoves(s, WHITE, 3);
  assert(ms3.some(m => m.from === 2 && m.to === "off"), "הורדה מדויקת עם קובייה תואמת");
}

console.log("הכאה:");
{
  const s = emptyState();
  s.points[10] = 1;   // לבן
  s.points[7] = -1;   // חייל שחור בודד
  s.off[WHITE] = 14; s.off[BLACK] = 14;
  const r = applyMove(s, WHITE, { from: 10, to: 7 });
  assert(r.hit === true, "מזוהה הכאה");
  assert(r.state.bar[BLACK] === 1 && r.state.points[7] === 1, "החייל השחור עבר לבר");
}

console.log("כניסה מהבר:");
{
  const s = initialState();
  s.bar[WHITE] = 1;
  const ms6 = legalSingleMoves(s, WHITE, 6);
  assert(ms6.length === 0, "כניסה עם 6 חסומה (נקודת 18 של השחור)");
  const ms3 = legalSingleMoves(s, WHITE, 3);
  assert(ms3.length === 1 && ms3[0].from === "bar" && ms3[0].to === 21, "כניסה עם 3 לאינדקס 21");
}

console.log("אפשרויות המשך ושרשראות:");
{
  const s = initialState();
  const tr = generateTurns(s, WHITE, [6, 5]);
  const opts = nextMoveOptions(tr, []);
  assert(opts.length > 0, "יש אפשרויות מהלך ראשון");
  const chains = chainOptionsFrom(tr, [], 23);
  // המהלך הקלאסי "בריחה" 24/13: idx23 -> 17 -> 12
  assert(chains.some(ch => ch.dest === 12), "שרשרת 24/13 (בריחת חייל אחורי) קיימת");
}

console.log("דירוג מהלכים:");
{
  const s = initialState();
  const tr = generateTurns(s, WHITE, [3, 1]);
  const finals = uniqueFinalStates(tr);
  const best = finals.map(f => ({ f, v: evaluate(f.state, WHITE) }))
    .sort((a, b) => b.v - a.v)[0];
  const rBest = rateTurn(s, WHITE, [3, 1], best.f.state);
  assert(rBest.score === 100, "המהלך הטוב ביותר מקבל 100");
  const worst = finals.map(f => ({ f, v: evaluate(f.state, WHITE) }))
    .sort((a, b) => a.v - b.v)[0];
  const rWorst = rateTurn(s, WHITE, [3, 1], worst.f.state);
  assert(rWorst.score < 100, "מהלך גרוע מקבל פחות מ-100 (קיבל " + rWorst.score + ")");
  assert(typeof rBest.explanation === "string" && rBest.explanation.length > 0, "יש הסבר מילולי");
}

console.log("סוג ניצחון:");
{
  const s = emptyState();
  s.off[WHITE] = 15; s.off[BLACK] = 3; s.points[20] = -12;
  assert(winKind(s, WHITE) === 1, "ניצחון רגיל");
  s.off[BLACK] = 0; s.points[20] = -15;
  assert(winKind(s, WHITE) === 2, "מארס");
  s.points[20] = -14; s.points[3] = -1;
  assert(winKind(s, WHITE) === 3, "מארס טורקי (חייל בבית המנצח)");
}

console.log("שש-בש טורקי — סיווג זריקות:");
{
  assert(classifyRoll([1, 2]) === "swap" && classifyRoll([2, 1]) === "swap", "1-2 → החלפת צדדים");
  assert(classifyRoll([3, 4]) === "choose" && classifyRoll([4, 3]) === "choose", "3-4 → בחירת דאבל");
  assert(classifyRoll([5, 6]) === "relocate" && classifyRoll([6, 5]) === "relocate", "5-6 → הזזה חופשית");
  assert(classifyRoll([4, 4]) === "double", "דאבל מזוהה");
  assert(classifyRoll([2, 5]) === "normal" && classifyRoll([1, 6]) === "normal", "זריקה רגילה");
}

console.log("שש-בש טורקי — הזזה חופשית (5-6):");
{
  const s = emptyState();
  s.points[23] = 1;         // חייל לבן בודד רחוק
  s.points[10] = 2;
  s.points[5] = -2;         // נקודה חסומה על ידי השחור
  s.points[8] = -1;         // חייל שחור בודד (ניתן להכאה)
  s.points[0] = -12; s.points[1] = 0;
  const ms = relocateSingleMoves(s, WHITE);
  assert(ms.every(m => m.to !== 5), "אי אפשר להעביר לנקודה חסומה");
  assert(ms.some(m => m.from === 23 && m.to === 20), "אפשר להעביר קדימה");
  assert(ms.some(m => m.from === 10 && m.to === 15), "אפשר להעביר גם אחורה");
  assert(ms.some(m => m.to === 8), "אפשר לנחות על חייל יריב בודד (הכאה)");
  assert(ms.every(m => m.to !== "off"), "בלי הורדה מהלוח כשלא כל החיילים בבית");
  // הכאה בפועל
  const r = applyMove(s, WHITE, { from: 10, to: 8 });
  assert(r.hit && r.state.bar[BLACK] === 1, "העברה לחייל בודד מכה אותו לבר");

  // בשלב ההוצאה (כל החיילים בבית) אפשר להוריד 2 חיילים ישירות
  const h = emptyState();
  h.points[2] = 2; h.points[4] = 3; h.off[WHITE] = 10;
  h.points[20] = -15;
  const hm = relocateSingleMoves(h, WHITE);
  assert(hm.some(m => m.from === 2 && m.to === "off"), "בשלב ההוצאה אפשר להוריד חייל דרך 5-6");
  const off1 = applyMove(h, WHITE, { from: 4, to: "off" });
  assert(off1.state.off[WHITE] === 11, "הורדה חופשית מגדילה את מונה ההורדה");
}

console.log("שש-בש טורקי — בחירות AI:");
{
  const s = initialState();
  const pick = aiChooseDouble(s, WHITE);
  assert(pick.die >= 1 && pick.die <= 6 && pick.final, "בחירת דאבל מחזירה ערך חוקי ועמדה");
  const rel = aiRelocate(s, WHITE);
  assert(rel.moves.length === 2, "הזזה חופשית של המחשב מעבירה שני חיילים");
  assert(rel.moves.every(m => m.relocate), "המהלכים מסומנים כהעברה חופשית");
  // הלוח נשאר עם 15 חיילים לכל צד אחרי ההעברה
  let w = 0, b = 0;
  for (const v of rel.state.points) { if (v > 0) w += v; else b += -v; }
  w += rel.state.bar[WHITE] + rel.state.off[WHITE];
  b += rel.state.bar[BLACK] + rel.state.off[BLACK];
  assert(w === 15 && b === 15, "המספר הכולל של החיילים נשמר");
}

console.log(failed === 0 ? "\nכל הבדיקות עברו ✓" : `\n${failed} בדיקות נכשלו ✗`);
process.exit(failed === 0 ? 0 : 1);
