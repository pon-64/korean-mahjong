// train/engine.mjs
// Korean Mahjong headless engine for self-play training
// Node.js compatible — no browser APIs, no setTimeout

// ============================================================
// TILE UTILITIES
// ============================================================

function createTileSet() {
  const tiles = [];
  let id = 0;
  for (const suit of ['m', 'p', 's']) {
    for (let num = 1; num <= 9; num++) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({ id: id++, suit, num, isRed: num === 5 });
      }
    }
  }
  for (let num = 1; num <= 7; num++) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ id: id++, suit: 'z', num, isRed: false });
    }
  }
  return tiles; // 136 tiles
}

function tilesEqual(a, b) {
  return a.suit === b.suit && a.num === b.num;
}

function getDoraFromIndicator(ind) {
  if (ind.suit === 'z') {
    if (ind.num <= 4) return { suit: 'z', num: ind.num === 4 ? 1 : ind.num + 1 };
    return { suit: 'z', num: ind.num === 7 ? 5 : ind.num + 1 };
  }
  return { suit: ind.suit, num: ind.num === 9 ? 1 : ind.num + 1 };
}

// ============================================================
// WALL
// ============================================================

class Wall {
  constructor() {
    const all = createTileSet();
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    this.deadWall = all.splice(all.length - 14, 14);
    this.tiles = all; // 122 tiles
    this.drawIndex = 0;
    this.kanCount = 0;
    this.doraIndicators = [this.deadWall[0], this.deadWall[1]];
    this.uraDoraIndicators = [this.deadWall[2], this.deadWall[3]];
    this.kanDrawTiles = this.deadWall.slice(4, 8);
    this.kanDrawIndex = 0;
  }

  get remaining() { return this.tiles.length - this.drawIndex; }

  draw() {
    return this.drawIndex < this.tiles.length ? this.tiles[this.drawIndex++] : null;
  }

  drawKan() {
    if (this.kanCount >= 4 || this.kanDrawIndex >= this.kanDrawTiles.length) return null;
    this.kanCount++;
    return this.kanDrawTiles[this.kanDrawIndex++];
  }

  getDoras() { return this.doraIndicators.map(getDoraFromIndicator); }
  getUraDoras() { return this.uraDoraIndicators.map(getDoraFromIndicator); }

  deal(n = 4) {
    const hands = Array.from({ length: n }, () => []);
    for (let i = 0; i < 13; i++) {
      for (let p = 0; p < n; p++) hands[p].push(this.draw());
    }
    return hands;
  }
}

// ============================================================
// SHANTEN CALCULATION (copied from hand.js)
// ============================================================

function tileIdx(t) {
  if (t.suit === 'm') return t.num - 1;
  if (t.suit === 'p') return 9 + t.num - 1;
  if (t.suit === 's') return 18 + t.num - 1;
  return 27 + t.num - 1;
}

function idxToTile(i) {
  const suit = i < 9 ? 'm' : i < 18 ? 'p' : i < 27 ? 's' : 'z';
  const num = i < 27 ? (i % 9) + 1 : (i - 27) + 1;
  return { suit, num, isRed: false, id: -1000 - i };
}

function tilesToCounts(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) c[tileIdx(t)]++;
  return c;
}

function shantenRegular(c, meldCount) {
  const maxM = 4 - meldCount;
  let best = 8;

  function dfs(i, m, jantai, taatsu) {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) {
      const p = Math.min(taatsu, maxM - m);
      const val = 2 * (m + meldCount) + (jantai ? 1 : 0) + p;
      if (8 - val < best) best = 8 - val;
      return;
    }
    let rem = 0;
    for (let k = i; k < 34; k++) rem += c[k];
    const am = Math.min(Math.floor(rem / 3), maxM - m);
    const ap = Math.min(Math.floor((rem - am * 3) / 2), maxM - m - am);
    const cv = 2 * (m + meldCount) + (jantai ? 1 : 0) + Math.min(taatsu, maxM - m);
    if (8 - (cv + 2 * am + ap) >= best) return;

    const suit = Math.floor(i / 9);
    const pos = i % 9;

    if (c[i] >= 3 && m < maxM) { c[i] -= 3; dfs(i, m + 1, jantai, taatsu); c[i] += 3; }
    if (suit < 3 && pos <= 6 && m < maxM && c[i] && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      dfs(i, m + 1, jantai, taatsu);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (!jantai && c[i] >= 2) { c[i] -= 2; dfs(i, m, true, taatsu); c[i] += 2; }
    if (c[i] >= 2 && m + taatsu < maxM) { c[i] -= 2; dfs(i, m, jantai, taatsu + 1); c[i] += 2; }
    if (suit < 3 && m + taatsu < maxM) {
      if (pos <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; dfs(i, m, jantai, taatsu + 1); c[i]++; c[i + 1]++; }
      if (pos <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; dfs(i, m, jantai, taatsu + 1); c[i]++; c[i + 2]++; }
    }
    dfs(i + 1, m, jantai, taatsu);
  }

  dfs(0, 0, false, 0);
  return best;
}

function shantenChiitoi(c) {
  let pairs = 0;
  for (let i = 0; i < 34; i++) pairs += Math.floor(c[i] / 2);
  return 6 - Math.min(pairs, 7);
}

const KOKUSHI_IDX = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

function shantenKokushi(c) {
  let kinds = 0, hasPair = false;
  for (const i of KOKUSHI_IDX) {
    if (c[i] >= 1) { kinds++; if (c[i] >= 2) hasPair = true; }
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

function calcShanten(tiles, meldCount = 0) {
  if (!tiles.length) return 8;
  const c = tilesToCounts(tiles);
  const n = shantenRegular(c, meldCount);
  if (meldCount > 0) return n;
  return Math.min(n, shantenChiitoi(c), shantenKokushi(c));
}

function isWinning(tiles, meldCount = 0) {
  return calcShanten(tiles, meldCount) === -1;
}

function getWinForm(tiles) {
  const c = tilesToCounts(tiles);
  if (shantenKokushi(c) === -1) return 'kokushi';
  if (shantenChiitoi(c) === -1) return 'chiitoi';
  return 'normal';
}

// ============================================================
// SCORING (Paradise City rules, cap=20)
// ============================================================

const CAP = 20;

function computeScore(hand, winType, isRiichi, doras, uraDoras) {
  if (getWinForm(hand) === 'kokushi') return 20;
  const base = winType === 'ron' ? 6 : 2;
  const riichiPt = isRiichi ? 2 : 0;
  let red = 0, omote = 0, ura = 0;
  for (const t of hand) {
    if (t.isRed) red++;
    for (const d of doras) if (tilesEqual(t, d)) omote++;
    if (isRiichi) for (const d of uraDoras) if (tilesEqual(t, d)) ura++;
  }
  return base + riichiPt + red + omote + ura;
}

function applyScore(scores, total, winType, winner, from) {
  if (winType === 'ron') {
    const pay = Math.min(total, CAP);
    scores[from] -= pay;
    scores[winner] += pay;
  } else {
    const each = Math.min(total, CAP);
    for (let i = 0; i < 4; i++) {
      if (i !== winner) { scores[i] -= each; scores[winner] += each; }
    }
  }
}

// ============================================================
// AI — parametric weights
// ============================================================

export const DEFAULT_WEIGHTS = {
  shantenPenalty: 100,  // multiplied by shanten level
  tenpaiBonus:    200,  // flat bonus when tenpai
  effectiveBonus:   1,  // per effective tile
  redDoraPenalty:  15,  // penalty for discarding red dora
  doraPenalty:     10,  // penalty for discarding normal dora
  safeBonus:       25,  // bonus for discarding safe tile under riichi attack
};

function countEffective(hand, meldCount) {
  const sh = calcShanten(hand, meldCount);
  if (sh < 0) return 0;
  let count = 0;
  for (let i = 0; i < 34; i++) {
    if (calcShanten([...hand, idxToTile(i)], meldCount) < sh) count++;
  }
  return count;
}

function evalHand(hand, meldCount, w) {
  const sh = calcShanten(hand, meldCount);
  if (sh < 0) return 99999;
  const eff = countEffective(hand, meldCount);
  if (sh === 0) return w.tenpaiBonus + eff * w.effectiveBonus;
  return -(sh * w.shantenPenalty) + eff * w.effectiveBonus;
}

function aiDiscard(hand, meldFlat, doras, meldCount, riichiDiscardSets, w) {
  const meldIds = new Set(meldFlat.map(t => t.id));
  const closed = hand.filter(t => !meldIds.has(t.id));

  const safeKeys = new Set();
  for (const ds of riichiDiscardSets) for (const t of ds) safeKeys.add(t.suit + t.num);
  const underAttack = riichiDiscardSets.length > 0;

  let best = -Infinity;
  let cands = [];

  for (let i = 0; i < closed.length; i++) {
    const tile = closed[i];
    const rest = closed.filter((_, j) => j !== i);
    let score = evalHand(rest, meldCount, w);

    if (tile.isRed) score -= w.redDoraPenalty;
    else if (doras.some(d => d.suit === tile.suit && d.num === tile.num)) score -= w.doraPenalty;
    if (underAttack && safeKeys.has(tile.suit + tile.num)) score += w.safeBonus;

    if (score > best) { best = score; cands = [tile]; }
    else if (score === best) cands.push(tile);
  }

  if (cands.length === 1) return cands[0];
  return cands.sort((a, b) => isolation(b, closed) - isolation(a, closed))[0];
}

function isolation(tile, hand) {
  if (tile.suit === 'z') return 5;
  let s = tile.num === 1 || tile.num === 9 ? 2 : 0;
  if (!hand.some(t => t !== tile && t.suit === tile.suit && Math.abs(t.num - tile.num) <= 2)) s += 3;
  return s;
}

function aiShouldPon(closed, tile, meldCount) {
  const sh = calcShanten(closed, meldCount);
  const after = [];
  let removed = 0;
  for (const t of closed) {
    if (removed < 2 && tilesEqual(t, tile)) { removed++; continue; }
    after.push(t);
  }
  if (removed < 2) return false;
  const mc2 = meldCount + 1;
  let bestSh = Infinity;
  for (let i = 0; i < after.length; i++) {
    const s = calcShanten(after.filter((_, j) => j !== i), mc2);
    if (s < bestSh) bestSh = s;
  }
  return bestSh < sh || bestSh === 0;
}

function aiShouldKan(closed, tile, meldCount) {
  const sh = calcShanten(closed, meldCount);
  const after = closed.filter(t => !tilesEqual(t, tile));
  return calcShanten(after, meldCount + 1) <= sh;
}

// ============================================================
// GAME STATE HELPERS
// ============================================================

function getMeldFlat(melds, p) { return melds[p].flatMap(m => m.tiles); }

function getClosed(hands, melds, p) {
  const ids = new Set(getMeldFlat(melds, p).map(t => t.id));
  return hands[p].filter(t => !ids.has(t.id));
}

function doDiscard(hands, discards, p, tile) {
  const i = hands[p].findIndex(t => t.id === tile.id);
  if (i !== -1) hands[p].splice(i, 1);
  discards[p].push(tile);
}

function doAnkan(hands, melds, wall, p, tile) {
  const closed = getClosed(hands, melds, p);
  const tiles4 = closed.filter(t => tilesEqual(t, tile));
  for (const t of tiles4) {
    const i = hands[p].findIndex(x => x.id === t.id);
    if (i !== -1) hands[p].splice(i, 1);
  }
  melds[p].push({ type: 'ankan', tiles: tiles4, from: p });
  const supp = wall.drawKan();
  if (supp) hands[p].push(supp);
  return supp;
}

function doShokan(hands, melds, wall, p, tile) {
  const mi = melds[p].findIndex(m => m.type === 'pon' && tilesEqual(m.tiles[0], tile));
  if (mi === -1) return null;
  const hi = hands[p].findIndex(t => t.id === tile.id);
  if (hi === -1) return null;
  hands[p].splice(hi, 1);
  melds[p][mi] = { ...melds[p][mi], type: 'shokan', tiles: [...melds[p][mi].tiles, tile] };
  const supp = wall.drawKan();
  if (supp) hands[p].push(supp);
  return supp;
}

function doPon(hands, melds, discards, p, from, tile, type) {
  // Remove from discarder's discard pile
  for (let i = discards[from].length - 1; i >= 0; i--) {
    if (discards[from][i].id === tile.id) { discards[from].splice(i, 1); break; }
  }
  const needed = type === 'minkan' ? 3 : 2;
  const meldIds = new Set(getMeldFlat(melds, p).map(t => t.id));
  let removed = 0;
  const taken = [];
  for (let i = hands[p].length - 1; i >= 0 && removed < needed; i--) {
    const t = hands[p][i];
    if (!meldIds.has(t.id) && tilesEqual(t, tile)) {
      taken.push(t); hands[p].splice(i, 1); removed++;
    }
  }
  melds[p].push({ type, tiles: [...taken, tile], from });
}

function findShokanTile(hands, melds, p) {
  const closed = getClosed(hands, melds, p);
  for (const meld of melds[p]) {
    if (meld.type !== 'pon') continue;
    const match = closed.find(t => tilesEqual(t, meld.tiles[0]));
    if (match) return match;
  }
  return null;
}

function findAnkanTile(hands, melds, p) {
  const closed = getClosed(hands, melds, p);
  const cnt = {};
  for (const t of closed) { const k = t.suit + t.num; cnt[k] = (cnt[k] || 0) + 1; }
  for (const [k, n] of Object.entries(cnt)) {
    if (n >= 4) return closed.find(t => t.suit + t.num === k);
  }
  return null;
}

// ============================================================
// MAIN GAME ENGINE
// ============================================================

/**
 * Run one complete game of 4-player CPU Korean Mahjong.
 * @param {Object[]} weights  Array of 4 weight objects (one per player).
 *                            Pass null to use DEFAULT_WEIGHTS for all.
 * @returns {{ winner: number, winType: string, scores: number[] }}
 *          winner = -1 for draw game
 */
export function runGame(weights = null) {
  const ws = weights || [DEFAULT_WEIGHTS, DEFAULT_WEIGHTS, DEFAULT_WEIGHTS, DEFAULT_WEIGHTS];

  const wall = new Wall();
  const hands = wall.deal(4);
  const melds = [[], [], [], []];
  const discards = [[], [], [], []];
  const riichi = [false, false, false, false];
  const scores = [0, 0, 0, 0];

  function getRiichiDiscards(excludePlayer) {
    const result = [];
    for (let i = 0; i < 4; i++) {
      if (i !== excludePlayer && riichi[i]) result.push(discards[i]);
    }
    return result;
  }

  // After a discard, resolve ron/pon/kan claims.
  // Returns: { done: true, winner, winType } | { done: false, nextPlayer }
  function resolveDiscard(from, tile) {
    const priority = [1, 2, 3].map(n => (from + n) % 4);

    // --- Ron check (priority: left → across → right) ---
    for (const p of priority) {
      const mc = melds[p].length;
      if (isWinning([...hands[p], tile], mc)) {
        // CPU always rons when it can
        hands[p].push(tile);
        const total = computeScore(
          hands[p], 'ron', riichi[p],
          wall.getDoras(), riichi[p] ? wall.getUraDoras() : []
        );
        applyScore(scores, total, 'ron', p, from);
        return { done: true, winner: p, winType: 'ron' };
      }
    }

    // --- Pon / Minkan check ---
    for (const p of priority) {
      if (riichi[p]) continue;
      const closed = getClosed(hands, melds, p);
      const same = closed.filter(t => tilesEqual(t, tile)).length;
      const mc = melds[p].length;

      if (same >= 3 && wall.kanCount < 4 && aiShouldKan(closed, tile, mc)) {
        doPon(hands, melds, discards, p, from, tile, 'minkan');
        const supp = wall.drawKan();
        if (supp) hands[p].push(supp);
        // After minkan: check tsumo, then discard
        const mcAfter = melds[p].length;
        if (isWinning(hands[p], mcAfter)) {
          const total = computeScore(hands[p], 'tsumo', riichi[p], wall.getDoras(), []);
          applyScore(scores, total, 'tsumo', p, null);
          return { done: true, winner: p, winType: 'tsumo' };
        }
        const d = aiDiscard(hands[p], getMeldFlat(melds, p), wall.getDoras(), mcAfter, getRiichiDiscards(p), ws[p]);
        doDiscard(hands, discards, p, d);
        return resolveDiscard(p, d);
      }

      if (same >= 2 && aiShouldPon(closed, tile, mc)) {
        doPon(hands, melds, discards, p, from, tile, 'pon');
        const mcAfter = melds[p].length;
        const d = aiDiscard(hands[p], getMeldFlat(melds, p), wall.getDoras(), mcAfter, getRiichiDiscards(p), ws[p]);
        doDiscard(hands, discards, p, d);
        return resolveDiscard(p, d);
      }
    }

    return { done: false, nextPlayer: (from + 1) % 4 };
  }

  // Handle one player's draw turn.
  // Returns win result or null (game continues).
  function playTurn(p) {
    const tile = wall.draw();
    if (!tile) return null; // wall empty → draw game
    hands[p].push(tile);
    const drawnTile = tile;
    const w = ws[p];

    // --- Tsumo check ---
    const mc = melds[p].length;
    if (isWinning(hands[p], mc)) {
      const total = computeScore(hands[p], 'tsumo', riichi[p], wall.getDoras(), riichi[p] ? wall.getUraDoras() : []);
      applyScore(scores, total, 'tsumo', p, null);
      return { done: true, winner: p, winType: 'tsumo' };
    }

    // --- Kan actions (skip if in riichi) ---
    if (!riichi[p] && wall.kanCount < 4) {
      // Shokan (add to existing pon)
      const shokanTile = findShokanTile(hands, melds, p);
      if (shokanTile) {
        const closed = getClosed(hands, melds, p);
        if (aiShouldKan(closed, shokanTile, mc)) {
          doShokan(hands, melds, wall, p, shokanTile);
          const mcAfter = melds[p].length;
          if (isWinning(hands[p], mcAfter)) {
            const total = computeScore(hands[p], 'tsumo', riichi[p], wall.getDoras(), []);
            applyScore(scores, total, 'tsumo', p, null);
            return { done: true, winner: p, winType: 'tsumo' };
          }
          // Fall through to discard
        }
      }

      // Ankan (4 in hand)
      if (wall.kanCount < 4) {
        const ankanTile = findAnkanTile(hands, melds, p);
        if (ankanTile) {
          const closed = getClosed(hands, melds, p);
          if (aiShouldKan(closed, ankanTile, mc)) {
            doAnkan(hands, melds, wall, p, ankanTile);
            const mcAfter = melds[p].length;
            if (isWinning(hands[p], mcAfter)) {
              const total = computeScore(hands[p], 'tsumo', riichi[p], wall.getDoras(), []);
              applyScore(scores, total, 'tsumo', p, null);
              return { done: true, winner: p, winType: 'tsumo' };
            }
            // Fall through to discard
          }
        }
      }
    }

    // --- Riichi declaration ---
    if (!riichi[p] && melds[p].length === 0) {
      const closed = getClosed(hands, melds, p);
      if (calcShanten(closed, 0) === 0) {
        riichi[p] = true;
      }
    }

    // --- Discard ---
    let discardTile;
    if (riichi[p]) {
      // In riichi: tsumogiri (always discard drawn tile)
      discardTile = drawnTile;
    } else {
      const mcNow = melds[p].length;
      discardTile = aiDiscard(hands[p], getMeldFlat(melds, p), wall.getDoras(), mcNow, getRiichiDiscards(p), w);
    }

    doDiscard(hands, discards, p, discardTile);
    return { discard: discardTile, from: p };
  }

  // Main loop
  let currentPlayer = 0;
  for (let turn = 0; turn < 200; turn++) { // 200 = safety limit
    const result = playTurn(currentPlayer);

    // Wall empty → draw game
    if (result === null) {
      return { winner: -1, winType: 'draw', scores: [...scores] };
    }

    // Tsumo win (resolved inside playTurn)
    if (result.done) {
      return { winner: result.winner, winType: result.winType, scores: [...scores] };
    }

    // Resolve discard claims
    const claim = resolveDiscard(result.from, result.discard);
    if (claim.done) {
      return { winner: claim.winner, winType: claim.winType, scores: [...scores] };
    }

    currentPlayer = claim.nextPlayer;
  }

  // Should not reach here
  return { winner: -1, winType: 'draw', scores: [...scores] };
}

// ---- Additional exports for RL training ----
export {
  Wall, tilesEqual, getDoraFromIndicator,
  calcShanten, isWinning, getWinForm,
  computeScore, applyScore, idxToTile, countEffective, evalHand,
  aiDiscard, aiShouldPon, aiShouldKan,
  getMeldFlat, getClosed, doDiscard, doPon, doAnkan, doShokan,
  findShokanTile, findAnkanTile,
};
