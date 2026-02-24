// ai.js - CPU AI（シャンテン数 + 有効牌 + 防御）

import { tilesEqual } from './tiles.js';
import { calcShanten, isWinningHand } from './hand.js';

// tile インデックス → suit/num（hand.js の private と同じ変換）
function idxToSuit(i) {
  if (i < 9)  return 'm';
  if (i < 18) return 'p';
  if (i < 27) return 's';
  return 'z';
}
function idxToNum(i) {
  return (i < 27) ? (i % 9) + 1 : (i - 27) + 1;
}

/**
 * 有効牌の種類数（ツモってシャンテンが下がる牌の種類数）
 */
export function countEffectiveTiles(hand, meldCount = 0) {
  const sh = calcShanten(hand, meldCount);
  if (sh < 0) return 0;
  let count = 0;
  for (let i = 0; i < 34; i++) {
    const t = { suit: idxToSuit(i), num: idxToNum(i), isRed: false, id: -999 - i };
    if (calcShanten([...hand, t], meldCount) < sh) count++;
  }
  return count;
}

/**
 * 手牌評価値（高いほど良い状態）
 * テンパイ = 200 + 有効牌数, n向聴 = -n*100 + 有効牌数, 和了 = 500
 */
function handValue(hand, meldCount) {
  const sh = calcShanten(hand, meldCount);
  if (sh < 0)  return 500;
  if (sh === 0) return 200 + countEffectiveTiles(hand, meldCount);
  return -(sh * 100) + countEffectiveTiles(hand, meldCount);
}

/**
 * 打牌決定（シャンテン + 有効牌 + ドラ保持 + 防御）
 * @param {Array}  hand                  - 手牌全体（14枚）
 * @param {Array}  meldTiles             - 副露牌
 * @param {Array}  doras                 - ドラ牌リスト
 * @param {number} meldCount             - 副露数
 * @param {Array}  riichiPlayerDiscards  - リーチ中プレイヤーの捨て牌配列（防御用）
 */
export function chooseDiscard(
  hand, meldTiles = [], doras = [], meldCount = 0, riichiPlayerDiscards = []
) {
  const meldIds = new Set(meldTiles.map(t => t.id));
  const closed  = hand.filter(t => !meldIds.has(t.id));

  // 現物（リーチ者の捨て牌）= 安全牌
  const safeKeys = new Set();
  for (const discards of riichiPlayerDiscards) {
    for (const t of discards) safeKeys.add(t.suit + t.num);
  }
  const underAttack = riichiPlayerDiscards.length > 0;

  let bestScore = -Infinity;
  let bestCandidates = [];

  for (let i = 0; i < closed.length; i++) {
    const tile = closed[i];
    const rest = closed.filter((_, j) => j !== i);
    let score = handValue(rest, meldCount);

    // ドラを切るのはもったいない（ペナルティ）
    if (tile.isRed) score -= 15;
    else if (doras.some(d => d.suit === tile.suit && d.num === tile.num)) score -= 10;

    // リーチ中の防御：現物は優先的に切る
    if (underAttack && safeKeys.has(tile.suit + tile.num)) score += 25;

    if (score > bestScore) {
      bestScore = score;
      bestCandidates = [tile];
    } else if (score === bestScore) {
      bestCandidates.push(tile);
    }
  }

  if (bestCandidates.length === 1) return bestCandidates[0];

  // タイブレーク：孤立牌・端牌・字牌を優先して切る
  return bestCandidates.sort(
    (a, b) => isolationPriority(b, closed) - isolationPriority(a, closed)
  )[0];
}

function isolationPriority(tile, hand) {
  if (tile.suit === 'z') return 5;
  let score = 0;
  if (tile.num === 1 || tile.num === 9) score += 2;
  const hasNeighbor = hand.some(
    t => t !== tile && t.suit === tile.suit && Math.abs(t.num - tile.num) <= 2
  );
  if (!hasNeighbor) score += 3;
  return score;
}

/**
 * リーチすべきか
 */
export function shouldRiichi(closedTiles, meldCount = 0) {
  return meldCount === 0 && calcShanten(closedTiles, 0) === 0;
}

/**
 * ポンすべきか（ポン後のシャンテン数が改善 or テンパイになる）
 */
export function shouldPon(closedTiles, ponTile, doras = [], meldCount = 0) {
  const currentShanten = calcShanten(closedTiles, meldCount);

  const afterRemove = [];
  let removed = 0;
  for (const t of closedTiles) {
    if (removed < 2 && tilesEqual(t, ponTile)) { removed++; continue; }
    afterRemove.push(t);
  }
  if (removed < 2) return false;

  const newMeldCount = meldCount + 1;
  let bestShanten = Infinity;
  for (let i = 0; i < afterRemove.length; i++) {
    const rest = afterRemove.filter((_, j) => j !== i);
    const s = calcShanten(rest, newMeldCount);
    if (s < bestShanten) bestShanten = s;
  }
  return bestShanten < currentShanten || bestShanten === 0;
}

/**
 * 暗槓すべきか（シャンテン数が悪化しない）
 */
export function shouldKan(closedTiles, kanTile, meldCount = 0) {
  const currentShanten = calcShanten(closedTiles, meldCount);
  const after = closedTiles.filter(t => !tilesEqual(t, kanTile));
  return calcShanten(after, meldCount + 1) <= currentShanten;
}

/**
 * 振り返り用：打牌前の手牌から各打牌候補の評価と損失を計算
 * @param {Array}  handBefore  - 打牌前の手牌（14枚、副露牌含む）
 * @param {Array}  meldTiles   - 副露牌
 * @param {number} meldCount   - 副露数
 * @param {Array}  doras       - ドラ牌リスト
 * @returns {Array} [{tile, shanten, effective, score, loss, isOptimal}]
 */
export function calcDiscardAnalysis(handBefore, meldTiles, meldCount, doras = []) {
  const meldIds = new Set(meldTiles.map(t => t.id));
  const closed  = handBefore.filter(t => !meldIds.has(t.id));

  if (closed.length === 0) return [];

  const results = [];
  let bestScore = -Infinity;

  for (let i = 0; i < closed.length; i++) {
    const tile = closed[i];
    const rest = closed.filter((_, j) => j !== i);
    const sh   = calcShanten(rest, meldCount);
    const eff  = countEffectiveTiles(rest, meldCount);

    const base = (sh < 0) ? 500 : (sh === 0) ? 200 + eff : -(sh * 100) + eff;

    // ドラを切ったペナルティ
    let penalty = 0;
    if (tile.isRed) penalty = 15;
    else if (doras.some(d => d.suit === tile.suit && d.num === tile.num)) penalty = 10;

    const score = base - penalty;
    results.push({ tile, shanten: sh, effective: eff, score });
    if (score > bestScore) bestScore = score;
  }

  for (const r of results) {
    r.loss = bestScore - r.score;
    r.isOptimal = r.loss === 0;
  }
  return results;
}
