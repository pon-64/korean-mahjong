// train/rl-engine.mjs
// RL training용 헤드리스 엔진 - AI decision functions are pluggable per player
//
// Player interface:
//   player.discard(hand, meldFlat, doras, meldCount, riichiDiscards, wallRemaining) => tile
//   player.pon(closed, ponTile, meldCount, wallRemaining, riichiOppCount) => boolean
//   player.kan(closed, kanTile, meldCount) => boolean  [optional]

import {
  Wall, tilesEqual, calcShanten, isWinning, computeScore, applyScore,
  aiShouldKan, getMeldFlat, getClosed, doDiscard, doPon, doAnkan, doShokan,
  findShokanTile, findAnkanTile,
} from './engine.mjs';

const CAP = 4; // 4 players

/**
 * Run one game with pluggable AI per player.
 * @param {Object[]} players  Array of 4 player objects (see above)
 * @returns {{ winner, winType, scores }}
 */
export function runGameRL(players) {
  const wall = new Wall();
  const hands   = wall.deal(4);
  const melds   = [[], [], [], []];
  const discards = [[], [], [], []];
  const riichi   = [false, false, false, false];
  const scores   = [0, 0, 0, 0];

  function riichiDiscards(excludeP) {
    const r = [];
    for (let i = 0; i < 4; i++) if (i !== excludeP && riichi[i]) r.push(discards[i]);
    return r;
  }

  function riichiOppCount(excludeP) {
    return riichi.reduce((n, r, i) => n + (i !== excludeP && r ? 1 : 0), 0);
  }

  // Resolve claims after a discard.  Returns { done, winner, winType } or { done: false, nextPlayer }
  function resolveDiscard(from, tile) {
    const prio = [1, 2, 3].map(n => (from + n) % 4);

    // Ron
    for (const p of prio) {
      if (isWinning([...hands[p], tile], melds[p].length)) {
        hands[p].push(tile);
        const total = computeScore(hands[p], 'ron', riichi[p], wall.getDoras(), riichi[p] ? wall.getUraDoras() : []);
        applyScore(scores, total, 'ron', p, from);
        return { done: true, winner: p, winType: 'ron' };
      }
    }

    // Pon / Minkan
    for (const p of prio) {
      if (riichi[p]) continue;
      const closed = getClosed(hands, melds, p);
      const same   = closed.filter(t => tilesEqual(t, tile)).length;
      const mc     = melds[p].length;
      const ropp   = riichiOppCount(p);

      if (same >= 3 && wall.kanCount < 4) {
        const shouldKan = players[p].kan
          ? players[p].kan(closed, tile, mc)
          : aiShouldKan(closed, tile, mc);
        if (shouldKan) {
          doPon(hands, melds, discards, p, from, tile, 'minkan');
          const supp = wall.drawKan();
          if (supp) hands[p].push(supp);
          if (isWinning(hands[p], melds[p].length)) {
            const total = computeScore(hands[p], 'tsumo', riichi[p], wall.getDoras(), []);
            applyScore(scores, total, 'tsumo', p, null);
            return { done: true, winner: p, winType: 'tsumo' };
          }
          const d = players[p].discard(hands[p], getMeldFlat(melds, p), wall.getDoras(), melds[p].length, riichiDiscards(p), wall.remaining);
          doDiscard(hands, discards, p, d);
          return resolveDiscard(p, d);
        }
      } else if (same >= 2) {
        const shouldPon = players[p].pon(closed, tile, mc, wall.remaining, ropp);
        if (shouldPon) {
          doPon(hands, melds, discards, p, from, tile, 'pon');
          const d = players[p].discard(hands[p], getMeldFlat(melds, p), wall.getDoras(), melds[p].length, riichiDiscards(p), wall.remaining);
          doDiscard(hands, discards, p, d);
          return resolveDiscard(p, d);
        }
      }
    }

    return { done: false, nextPlayer: (from + 1) % 4 };
  }

  // One player's draw turn.  Returns win or { discard, from } or null (wall empty)
  function playTurn(p) {
    const tile = wall.draw();
    if (!tile) return null;
    hands[p].push(tile);
    const drawnTile = tile;

    // Tsumo
    if (isWinning(hands[p], melds[p].length)) {
      const total = computeScore(hands[p], 'tsumo', riichi[p], wall.getDoras(), riichi[p] ? wall.getUraDoras() : []);
      applyScore(scores, total, 'tsumo', p, null);
      return { done: true, winner: p, winType: 'tsumo' };
    }

    // Shokan
    if (!riichi[p] && wall.kanCount < 4) {
      const shokan = findShokanTile(hands, melds, p);
      if (shokan) {
        const closed = getClosed(hands, melds, p);
        const shouldKan = players[p].kan ? players[p].kan(closed, shokan, melds[p].length) : aiShouldKan(closed, shokan, melds[p].length);
        if (shouldKan) {
          doShokan(hands, melds, wall, p, shokan);
          if (isWinning(hands[p], melds[p].length)) {
            const total = computeScore(hands[p], 'tsumo', riichi[p], wall.getDoras(), []);
            applyScore(scores, total, 'tsumo', p, null);
            return { done: true, winner: p, winType: 'tsumo' };
          }
        }
      }
    }

    // Ankan
    if (!riichi[p] && wall.kanCount < 4) {
      const ankan = findAnkanTile(hands, melds, p);
      if (ankan) {
        const closed = getClosed(hands, melds, p);
        const shouldKan = players[p].kan ? players[p].kan(closed, ankan, melds[p].length) : aiShouldKan(closed, ankan, melds[p].length);
        if (shouldKan) {
          doAnkan(hands, melds, wall, p, ankan);
          if (isWinning(hands[p], melds[p].length)) {
            const total = computeScore(hands[p], 'tsumo', riichi[p], wall.getDoras(), []);
            applyScore(scores, total, 'tsumo', p, null);
            return { done: true, winner: p, winType: 'tsumo' };
          }
        }
      }
    }

    // Riichi
    if (!riichi[p] && melds[p].length === 0) {
      const closed = getClosed(hands, melds, p);
      if (calcShanten(closed, 0) === 0) riichi[p] = true;
    }

    // Discard
    let discardTile;
    if (riichi[p]) {
      discardTile = drawnTile;
    } else {
      discardTile = players[p].discard(
        hands[p], getMeldFlat(melds, p), wall.getDoras(),
        melds[p].length, riichiDiscards(p), wall.remaining
      );
    }

    doDiscard(hands, discards, p, discardTile);
    return { discard: discardTile, from: p };
  }

  // Main loop
  let current = 0;
  for (let t = 0; t < 200; t++) {
    const r = playTurn(current);
    if (r === null)  return { winner: -1, winType: 'draw', scores: [...scores] };
    if (r.done)      return { winner: r.winner, winType: r.winType, scores: [...scores] };
    const claim = resolveDiscard(r.from, r.discard);
    if (claim.done)  return { winner: claim.winner, winType: claim.winType, scores: [...scores] };
    current = claim.nextPlayer;
  }
  return { winner: -1, winType: 'draw', scores: [...scores] };
}
