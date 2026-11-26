"use strict";

/* ==========================================================================
   engine.js — הערכת עמדות (היוריסטיקה), בינה מלאכותית, ודירוג מהלכים
   יחידות ההערכה מכוילות בקירוב ל"פיפים" (צעדי קובייה), כך שהפסד של
   נקודת הערכה אחת שקול בערך לפיגור של צעד אחד במרוץ.
   ========================================================================== */

/* ---- ספירת "יריות": בכמה מתוך 36 זריקות היריב יכול להכות חייל בודד ---- */

function singleDieHits(s, atk, blotIdx, d) {
  const ms = legalSingleMoves(s, atk, d);
  for (const m of ms) if (m.to === blotIdx) return true;
  return false;
}

function comboHits(s, atk, blotIdx, dA, dB) {
  // הכאה בשתי קוביות: קודם dA לנקודת ביניים, ואז dB אל החייל החשוף
  const inter = atk === WHITE ? blotIdx + dB : blotIdx - dB;
  if (inter < 0 || inter > 23) return false;
  const ms = legalSingleMoves(s, atk, dA);
  for (const m of ms) {
    if (m.to !== inter) continue;
    const r = applyMove(s, atk, m);
    const ms2 = legalSingleMoves(r.state, atk, dB);
    for (const m2 of ms2) if (m2.from === inter && m2.to === blotIdx) return true;
  }
  return false;
}

function doubleReach(s, atk, blotIdx, d, k) {
  // הכאה בדאבל: k צעדים של d מאותו חייל
  const dir = atk === WHITE ? 1 : -1;
  if (s.bar[atk] > 0) {
    const e = atk === WHITE ? 24 - d : d - 1;
    if (isBlocked(s, e, atk)) return false;
    if (e - dir * d * (k - 1) !== blotIdx) return false;
    for (let j = 1; j < k - 1; j++) {
      if (isBlocked(s, e - dir * d * j, atk)) return false;
    }
    return true;
  }
  const src = blotIdx + dir * d * k;
  if (src < 0 || src > 23) return false;
  if (ownCount(s, src, atk) === 0) return false;
  for (let j = 1; j < k; j++) {
    if (isBlocked(s, blotIdx + dir * d * j, atk)) return false;
  }
  return true;
}

function rollHits(s, atk, blotIdx, d1, d2) {
  if (d1 === d2) {
    for (let k = 1; k <= 4; k++) if (doubleReach(s, atk, blotIdx, d1, k)) return true;
    return false;
  }
  if (singleDieHits(s, atk, blotIdx, d1)) return true;
  if (singleDieHits(s, atk, blotIdx, d2)) return true;
  if (comboHits(s, atk, blotIdx, d1, d2)) return true;
  if (comboHits(s, atk, blotIdx, d2, d1)) return true;
  return false;
}

function countShots(s, blotIdx, atk) {
  let shots = 0;
  for (let d1 = 1; d1 <= 6; d1++) {
    for (let d2 = d1; d2 <= 6; d2++) {
      if (rollHits(s, atk, blotIdx, d1, d2)) shots += d1 === d2 ? 1 : 2;
    }
  }
  return shots;
}

/* ---- תכונות עזר ---- */

function homeBoardPoints(s, c) {
  let n = 0;
  if (c === WHITE) {
    for (let i = 0; i <= 5; i++) if (s.points[i] >= 2) n++;
  } else {
    for (let i = 18; i <= 23; i++) if (-s.points[i] >= 2) n++;
  }
  return n;
}

function longestPrime(s, c) {
  let best = 0, run = 0;
  for (let i = 0; i < 24; i++) {
    if (ownCount(s, i, c) >= 2) { run++; if (run > best) best = run; }
    else run = 0;
  }
  return best;
}

function madePointsCount(s, c) {
  let n = 0;
  for (let i = 0; i < 24; i++) if (ownCount(s, i, c) >= 2) n++;
  return n;
}

function totalShotsAgainst(s, c) {
  let t = 0;
  for (let i = 0; i < 24; i++) {
    if (ownCount(s, i, c) === 1) t += countShots(s, i, -c);
  }
  return t;
}

/* ==========================================================================
   Pubeval — Gerald Tesauro (1992)
   Linear evaluation with 122 contact weights + 122 race weights.
   Replaces the heuristic evaluate() for regular backgammon.
   ========================================================================== */

let _variant = "regular";
function setEngineVariant(v) { _variant = v; }

const PUBEVAL_WC = new Float64Array([
  0.25696,-0.66937,-1.66135,-2.02487,-2.53398,-0.16092,-1.11725,-1.06654,
  -0.92830,-1.99558,-1.10388,-0.80802, 0.09856,-0.62086,-1.27999,-0.59220,
  -0.73667, 0.89032,-0.38933,-1.59847,-1.50197,-0.60966, 1.56166,-0.47389,
  -1.80390,-0.83425,-0.97741,-1.41371, 0.24500, 0.10970,-1.36476,-1.05572,
   1.15420, 0.11069,-0.38319,-0.74816,-0.59244, 0.81116,-0.39511, 0.11424,
  -0.73169,-0.56074, 1.09792, 0.15977, 0.13786,-1.18435,-0.43363, 1.06169,
  -0.21329, 0.04798,-0.94373,-0.22982, 1.22737,-0.13099,-0.06295,-0.75882,
  -0.13658, 1.78389, 0.30416, 0.36797,-0.69851, 0.13003, 1.23070, 0.40868,
  -0.21081,-0.64073, 0.31061, 1.59554, 0.65718, 0.25429,-0.80789, 0.08240,
   1.78964, 0.54304, 0.41174,-1.06161, 0.07851, 2.01451, 0.49786, 0.91936,
  -0.90750, 0.05941, 1.83120, 0.58722, 1.28777,-0.83711,-0.33248, 2.64983,
   0.52698, 0.82132,-0.58897,-1.18223, 3.35809, 0.62017, 0.57353,-0.07276,
  -0.36214, 4.37655, 0.45481, 0.21746, 0.10504,-0.61977, 3.54001, 0.04612,
  -0.18108, 0.63211,-0.87046, 2.47673,-0.48016,-1.27157, 0.86505,-1.11342,
   1.24612,-0.82385,-2.77082, 1.23606,-1.59529, 0.10438,-1.30206,-4.11520,
   5.62596,-2.75800
]);

const PUBEVAL_WR = new Float64Array([
  0.00000,-0.17160, 0.27010, 0.29906,-0.08471, 0.00000,-1.40375,-1.05121,
  0.07217,-0.01351, 0.00000,-1.29506,-2.16183, 0.13246,-1.03508, 0.00000,
  -2.29847,-2.34631, 0.17253, 0.08302, 0.00000,-1.27266,-2.87401,-0.07456,
  -0.34240, 0.00000,-1.34640,-2.46556,-0.13022,-0.01591, 0.00000, 0.27448,
   0.60015, 0.48302, 0.25236, 0.00000, 0.39521, 0.68178, 0.05281, 0.09266,
   0.00000, 0.24855,-0.06844,-0.37646, 0.05685, 0.00000, 0.17405, 0.00430,
   0.74427, 0.00576, 0.00000, 0.12392, 0.31202,-0.91035,-0.16270, 0.00000,
   0.01418,-0.10839,-0.02781,-0.88035, 0.00000, 1.07274, 2.00366, 1.16242,
   0.22520, 0.00000, 0.85631, 1.06349, 1.49549, 0.18966, 0.00000, 0.37183,
  -0.50352,-0.14818, 0.12039, 0.00000, 0.13681, 0.13978, 1.11245,-0.12707,
   0.00000,-0.22082, 0.20178,-0.06285,-0.52728, 0.00000,-0.13597,-0.19412,
  -0.09308,-1.26062, 0.00000, 3.05454, 5.16874, 1.50680, 5.35000, 0.00000,
   2.19605, 3.85390, 0.88296, 2.30052, 0.00000, 0.92321, 1.08744,-0.11696,
  -0.78560, 0.00000,-0.09795,-0.83050,-1.09167,-4.94251, 0.00000,-1.00316,
  -3.66465,-2.56906,-9.67677, 0.00000,-2.77982,-7.26713,-3.40177,-12.32252,
   0.00000, 3.42040
]);

function pubevalScore(s, c) {
  if (s.off[c] === 15) return 99999999;

  const race = isRace(s);
  const x = new Float64Array(122);

  for (let j = 1; j <= 24; j++) {
    const jm1 = j - 1;
    let n;
    if (c === WHITE) {
      n = s.points[j - 1];
    } else {
      n = -s.points[24 - j];
    }
    if (n !== 0) {
      if (n === -1)      x[5 * jm1]     = 1.0;
      else if (n === 1)  x[5 * jm1 + 1] = 1.0;
      if (n === 3)       x[5 * jm1 + 3] = 1.0;
      if (n >= 4)        x[5 * jm1 + 4] = (n - 3) / 2.0;
      if (n >= 2)        x[5 * jm1 + 2] = 1.0;
    }
  }

  x[120] = s.bar[-c] / 2.0;
  x[121] = s.off[c] / 15.0;

  const w = race ? PUBEVAL_WR : PUBEVAL_WC;
  let score = 0;
  for (let i = 0; i < 122; i++) score += w[i] * x[i];
  return score;
}

/* ---- הערכת צד ---- */

function sideEval(s, c, race, fast) {
  let score = -pipCount(s, c);
  score += s.off[c] * 1.5;

  // פיזור: קנס על ערימות גבוהות מדי
  for (let i = 0; i < 24; i++) {
    const n = ownCount(s, i, c);
    if (n > 4) score -= (n - 4) * 0.4;
  }
  if (race) return score;

  const oppHome = homeBoardPoints(s, -c);

  // חיילים חשופים
  for (let i = 0; i < 24; i++) {
    if (ownCount(s, i, c) !== 1) continue;
    if (fast) {
      score -= 2.5;
      continue;
    }
    const shots = countShots(s, i, -c);
    if (shots > 0) {
      const lossIfHit = (25 - pipOf(i, c)) + 5; // פיפים שאובדים + טמפו
      score -= (shots / 36) * lossIfHit * (1 + 0.12 * oppHome);
    }
  }

  // נקודות בנויות, לפי חשיבות מיקום
  for (let i = 0; i < 24; i++) {
    if (ownCount(s, i, c) < 2) continue;
    const p = pipOf(i, c);
    let b = 1.2;
    if (p >= 4 && p <= 7) b += 2.2;        // נקודת הזהב ונקודת הבר
    else if (p <= 6) b += 1.6;             // הבית
    else if (p <= 12) b += 0.7;
    else if (p >= 19) b += (p <= 21 ? 3.0 : 1.8); // עוגן בבית היריב
    score += b;
  }

  // חומה (פריים)
  const prime = longestPrime(s, c);
  if (prime >= 3) score += (prime - 2) * 2.5;

  // יריב על הבר מול הבית שלי
  score += s.bar[-c] * (2 + homeBoardPoints(s, c) * 1.3);
  // סכנת תקיעה שלי על הבר מול בית חזק של היריב
  score -= s.bar[c] * (oppHome * 1.1);

  return score;
}

function evaluateHeuristic(s, c) {
  const race = isRace(s);
  return sideEval(s, c, race, false) - sideEval(s, -c, race, false);
}

function evaluate(s, c) {
  if (_variant === "turkish") return evaluateHeuristic(s, c);
  return pubevalScore(s, c);
}

function evaluateFast(s, c) {
  if (_variant === "turkish") {
    const race = isRace(s);
    return sideEval(s, c, race, true) - sideEval(s, -c, race, true);
  }
  return pubevalScore(s, c);
}

/* ==========================================================================
   בינה מלאכותית — שלוש רמות
   ========================================================================== */

/* כל רמת קושי מכוונת לטווח ממוצע-ציון של המאמן:
   קל 50–70, בינוני 70–85, קשה 85–95, אלוף 95+. הבחירה נמדדת באותה
   נוסחה שבה המאמן מדרג את השחקן (ציון יחסי למהלך הסטטי הטוב ביותר). */
const LEVEL_BAND = {
  easy:     [50, 70],
  medium:   [70, 85],
  hard:     [85, 95],
  champion: [95, 100],
};

/* ציון-מאמן של מהלך לפי ההפסד מול המהלך הטוב ביותר (זהה ל-rateTurn) */
function scoreOfLoss(loss) {
  loss = Math.max(0, loss);
  return loss <= 0.25 ? 100 : Math.max(5, Math.round(100 - loss * 3.5));
}

/* avgSoFar = ממוצע ציוני המהלכים הלא-כפויים של המחשב עד כה במשחק (או null).
   מאפשר לכוון: אם המחשב שיחק חזק מדי מהטווח — הפעם ישחק חלש יותר, ולהפך. */
function chooseAiTurn(state, color, dice, level, turnsResult, avgSoFar) {
  const tr = turnsResult || generateTurns(state, color, dice);
  const finals = uniqueFinalStates(tr);
  if (finals.length === 1) { finals[0].aiScore = null; return finals[0]; }  // כפוי — לא נספר

  const scored = finals.map(f => ({ f, v: evaluate(f.state, color) }));
  scored.sort((a, b) => b.v - a.v);
  const bestV = scored[0].v;

  if (level === "best") { scored[0].f.aiScore = 100; return scored[0].f; }

  // אלוף: expectimax בין המהלכים הכמעט-אופטימליים בלבד (ציון ≥95),
  // כך שהוא גם חזק טקטית וגם לא יורד מהטווח.
  if (level === "champion") {
    const near = scored.filter(x => scoreOfLoss(bestV - x.v) >= 95);
    const f = championMove(near.length ? near : [scored[0]], color);
    f.aiScore = scoreOfLoss(bestV - evaluate(f.state, color));
    return f;
  }

  const band = LEVEL_BAND[level] || LEVEL_BAND.medium;
  const mid = (band[0] + band[1]) / 2;
  /* בקר פרופורציונלי: מכוון את הממוצע אל מרכז הטווח — אם עד כה שיחקנו
     חזק מדי, היעד יורד מתחת למרכז, ולהפך. רעש קטן שומר על משחק טבעי. */
  let target = avgSoFar == null ? mid : mid + (mid - avgSoFar) * 1.5;
  target += Math.random() * 8 - 4 - 3;   // הטיה קטנה מטה — מרכזת את הממוצע בטווח
  target = Math.max(5, Math.min(100, target));

  /* בוחרים את המהלך שהציון שלו הכי קרוב ליעד */
  let pick = scored[0].f, pickScore = 100, bestDist = Infinity;
  for (const x of scored) {
    const sc = scoreOfLoss(bestV - x.v);
    const d = Math.abs(sc - target);
    if (d < bestDist) { bestDist = d; pick = x.f; pickScore = sc; }
  }
  pick.aiScore = pickScore;
  return pick;
}

/* אלוף — מאסטר שש-בש: expectimax מלא בעומק תור אחד עם הערכה מדויקת.
   לכל מועמד מדמים את כל 21 זריקות היריב, מניחים שהיריב יענה במיטבו
   (המהלך שהכי מזיק לי), ובוחרים את המהלך עם התוחלת הגבוהה ביותר —
   כלומר העמדה הכי טובה עבורי אחרי התשובה החזקה ביותר של היריב. */
function championMove(scored, color) {
  /* סינון מקדים לפי הערכה סטטית כדי לשמור על מהירות, אך רחב מספיק
     כדי לא לפספס מהלך שנראה חלש סטטית אך חזק אחרי תשובת היריב. */
  const cand = scored.slice(0, 8);
  let best = cand[0].f, bestV = -Infinity;
  for (const c0 of cand) {
    let exp = 0;
    for (let d1 = 1; d1 <= 6; d1++) {
      for (let d2 = d1; d2 <= 6; d2++) {
        const w = d1 === d2 ? 1 : 2;
        const oppFinals = uniqueFinalStates(generateTurns(c0.f.state, -color, [d1, d2]));
        if (oppFinals.length === 0) {
          exp += w * evaluate(c0.f.state, color);   // ליריב אין מהלך — מצוין עבורי
          continue;
        }
        let worst = Infinity;                        // היריב ממזער את ההערכה שלי
        for (const of_ of oppFinals) {
          const v = evaluate(of_.state, color);
          if (v < worst) worst = v;
        }
        exp += w * worst;
      }
    }
    const v = exp / 36;
    if (v > bestV) { bestV = v; best = c0.f; }
  }
  return best;
}

/* ---- בחירות AI לזריקות הטורקיות המיוחדות ---- */

/* חוק 3-4: בוחר את הדאבל (1..6) שנותן את העמדה הטובה ביותר */
function aiChooseDouble(state, color) {
  let bestDie = 6, bestV = -Infinity, bestFinal = null;
  for (let d = 1; d <= 6; d++) {
    const finals = uniqueFinalStates(generateTurns(state, color, [d, d]));
    for (const f of finals) {
      const v = evaluate(f.state, color);
      if (v > bestV) { bestV = v; bestDie = d; bestFinal = f; }
    }
  }
  return { die: bestDie, final: bestFinal };
}

/* חוק 5-6: בוחר בחמדנות שתי העברות חופשיות — הטובה ביותר, ואז השנייה */
function aiRelocate(state, color) {
  const moves = [];
  let s = state;
  for (let step = 0; step < 2; step++) {
    const cands = relocateSingleMoves(s, color);
    if (!cands.length) break;
    let best = null, bestV = -Infinity, bestState = null, bestHit = false;
    for (const m of cands) {
      const r = applyMove(s, color, m);
      const v = evaluateFast(r.state, color);
      if (v > bestV) { bestV = v; best = m; bestState = r.state; bestHit = r.hit; }
    }
    if (!best) break;
    moves.push({ from: best.from, to: best.to, die: 0, hit: bestHit, relocate: true });
    s = bestState;
  }
  return { moves, state: s };
}

/* ==========================================================================
   דירוג מהלכים + הסברים בעברית
   ========================================================================== */

const GRADES = [
  { min: 95, label: "מצוין", cls: "g-excellent" },
  { min: 85, label: "טוב מאוד", cls: "g-verygood" },
  { min: 70, label: "טוב", cls: "g-good" },
  { min: 55, label: "סביר", cls: "g-ok" },
  { min: 40, label: "לא מדויק", cls: "g-inaccurate" },
  { min: 25, label: "טעות", cls: "g-mistake" },
  { min: 0, label: "טעות חמורה", cls: "g-blunder" },
];

function gradeForScore(score) {
  return GRADES.find(g => score >= g.min);
}

function turnFeatures(s, c) {
  return {
    shots: totalShotsAgainst(s, c),
    oppBar: s.bar[-c],
    off: s.off[c],
    points: madePointsCount(s, c),
    prime: longestPrime(s, c),
    homePoints: homeBoardPoints(s, c),
  };
}

/* אילו נקודות-מפתח נבנו במהלך (לפי פיפ של השחקן) */
function newKeyPoints(prev, next, c) {
  const keys = [];
  for (let i = 0; i < 24; i++) {
    if (ownCount(next, i, c) >= 2 && ownCount(prev, i, c) < 2) {
      const p = pipOf(i, c);
      if (p >= 4 && p <= 7) keys.push(p);
    }
  }
  return keys;
}

function buildExplanation(prev, c, chosen, bestState, loss, score) {
  const fc = turnFeatures(chosen, c);
  const fb = turnFeatures(bestState, c);
  const hits = chosen.bar[-c] - prev.bar[-c];
  const bestHits = bestState.bar[-c] - prev.bar[-c];
  const offGain = chosen.off[c] - prev.off[c];

  if (score >= 95) {
    if (hits > 0) return hits > 1 ? "הכית שני חיילים של היריב ושלחת אותם לבר — מכה כפולה!" : "הכית חייל של היריב ושלחת אותו לבר. מהלך חזק!";
    const keys = newKeyPoints(prev, chosen, c);
    if (keys.length) return `בנית נקודה אסטרטגית (נקודה ${keys[0]}) — שליטה מצוינת בלוח.`;
    if (offGain >= 2) return `הורדת ${offGain} חיילים מהלוח בתור אחד — קצב מעולה.`;
    if (offGain === 1) return "הורדת חייל מהלוח — התקדמות יפה לסיום.";
    if (fc.shots === 0) return "מהלך בטוח ומדויק — לא השארת אף חייל חשוף.";
    return "המהלך הטוב ביותר האפשרי עם הקוביות האלה.";
  }

  const reasons = [];
  if (bestHits > hits) {
    reasons.push("פספסת הזדמנות להכות חייל של היריב");
  }
  if (fc.shots - fb.shots >= 4) {
    reasons.push(`המהלך משאיר חשיפה גבוהה (${fc.shots} דרכי פגיעה מתוך 36) — היה מהלך בטוח יותר`);
  }
  if (fb.prime > fc.prime) {
    reasons.push("היה עדיף להאריך את החומה שחוסמת את היריב");
  } else if (fb.points > fc.points) {
    reasons.push("היה עדיף לבנות נקודה במקום לפזר חיילים");
  }
  if (fb.off > fc.off) {
    reasons.push("היה אפשר להוריד יותר חיילים מהלוח");
  }
  if (fb.homePoints > fc.homePoints && chosen.bar[-c] > 0) {
    reasons.push("כשחייל של היריב על הבר כדאי לחזק את הבית שלך");
  }
  if (reasons.length === 0) {
    reasons.push("מבחינת המרוץ וחלוקת החיילים היה מהלך מדויק יותר");
  }
  return reasons.slice(0, 2).join(", וגם: ") + ".";
}

/* דירוג תור שלם של השחקן */
function rateTurn(prevState, color, dice, finalState) {
  const tr = generateTurns(prevState, color, dice);
  if (tr.maxLen === 0) return { noMoves: true, score: null };

  const finals = uniqueFinalStates(tr);
  const scored = finals.map(f => ({ f, v: evaluate(f.state, color) }));
  scored.sort((a, b) => b.v - a.v);

  const bestV = scored[0].v;
  const chosenKey = stateKey(finalState);
  const found = scored.find(x => stateKey(x.f.state) === chosenKey);
  const chosenV = found ? found.v : evaluate(finalState, color);
  const loss = Math.max(0, bestV - chosenV);
  const forced = finals.length === 1;

  let score;
  if (forced) score = 100;
  else if (loss <= 0.25) score = 100;
  else score = Math.max(5, Math.round(100 - loss * 3.5));

  const grade = gradeForScore(score);
  const explanation = forced
    ? "הייתה רק אפשרות אחת — מהלך כפוי."
    : buildExplanation(prevState, color, finalState, scored[0].f.state, loss, score);
  const bestMoves = (!forced && loss > 0.25) ? scored[0].f.moves : null;

  return { score, grade, loss, forced, explanation, bestMoves };
}

/* סיכום דירוגים לסוף המשחק */
function summarizeRatings(ratings) {
  const rated = ratings.filter(r => r.score != null && !r.forced && !r.noMoves);
  if (rated.length === 0) {
    return { count: 0, avg: null, grade: null, dist: [], worst: [] };
  }
  const avg = Math.round(rated.reduce((t, r) => t + r.score, 0) / rated.length);
  const grade = gradeForScore(avg);
  const dist = GRADES.map(g => ({
    label: g.label, cls: g.cls,
    count: rated.filter(r => r.grade.label === g.label).length,
  })).filter(d => d.count > 0);
  const worst = rated.slice().sort((a, b) => a.score - b.score).slice(0, 3)
    .filter(r => r.score < 70);
  return { count: rated.length, avg, grade, dist, worst };
}

/* ==========================================================================
   קוביית הכפלה — החלטת AI: האם להכפיל, והאם לקבל הכפלה
   ========================================================================== */
function winProbability(state, color) {
  if (isRace(state)) {
    const my = pipCount(state, color);
    const opp = pipCount(state, -color);
    if (my === 0 && opp === 0) return 0.5;
    const diff = opp - my;
    return 1 / (1 + Math.exp(-0.08 * diff));
  }
  const ev = evaluate(state, color);
  if (_variant === "turkish") return 1 / (1 + Math.exp(-2.5 * ev));
  return 1 / (1 + Math.exp(-0.6 * ev));
}

function shouldDouble(state, color) {
  const ev = evaluate(state, color);
  if (_variant === "turkish") {
    return { shouldDouble: ev > 0.12, shouldTake: ev > -0.35 };
  }
  if (isRace(state)) {
    const myPips = pipCount(state, color);
    const oppPips = pipCount(state, -color);
    if (myPips >= oppPips - 8) return { shouldDouble: false, shouldTake: ev > -1.5 };
  }
  return { shouldDouble: ev > 0.5, shouldTake: ev > -1.5 };
}
