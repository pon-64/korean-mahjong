// ai.js - CPU AI（シャンテン数ベース）

import { tilesEqual } from './tiles.js';
import { calcShanten, isWinningHand } from './hand.js';

/**
 * 打牌決定（シャンテン数最小化）
 * @param {Array}  hand       手牌全体（副露牌含む）
 * @param {Array}  meldTiles  副露牌の配列（手牌から除外してシャンテン計算）
 * @param {Array}  doras      ドラ牌リスト
 * @param {number} meldCount  副露済みメンツ数
 */
export function chooseDiscard(hand, meldTiles = [], doras = [], meldCount = 0) {
  const meldIds = new Set(meldTiles.map(t => t.id));
  const closed  = hand.filter(t => !meldIds.has(t.id));

  let bestShanten = Infinity;
  let bestCandidates = [];

  for (let i = 0; i < closed.length; i++) {
    const rest = closed.filter((_, j) => j !== i);
    const s = calcShanten(rest, meldCount);
    if (s < bestShanten) {
      bestShanten = s;
      bestCandidates = [closed[i]];
    } else if (s === bestShanten) {
      bestCandidates.push(closed[i]);
    }
  }

  if (bestCandidates.length === 1) return bestCandidates[0];

  // 同シャンテン数の中で優先度付け（高い = 先に切る）
  return bestCandidates.sort((a, b) =>
    discardPriority(b, doras, closed) - discardPriority(a, doras, closed)
  )[0];
}

function discardPriority(tile, doras, hand) {
  let score = 0;
  if (tile.isRed) score -= 10;
  if (doras.some(d => d.suit === tile.suit && d.num === tile.num)) score -= 8;
  if (tile.suit === 'z') score += 5;
  if (tile.suit !== 'z' && (tile.num === 1 || tile.num === 9)) score += 2;
  // 孤立牌（隣接牌なし）は先切り
  if (tile.suit !== 'z') {
    const hasNeighbor = hand.some(t =>
      t !== tile && t.suit === tile.suit &&
      Math.abs(t.num - tile.num) <= 2
    );
    if (!hasNeighbor) score += 3;
  }
  return score;
}

/**
 * リーチすべきか（クローズ手でテンパイ）
 */
export function shouldRiichi(closedTiles, meldCount = 0) {
  return meldCount === 0 && calcShanten(closedTiles, 0) === 0;
}

/**
 * ポンすべきか（ポン後のシャンテン数が改善 or テンパイになる）
 */
export function shouldPon(closedTiles, ponTile, doras = [], meldCount = 0) {
  const currentShanten = calcShanten(closedTiles, meldCount);

  // ポン後：closedTilesから2枚除去、1枚捨てた後のシャンテン数を計算
  const afterRemove = [];
  let removed = 0;
  for (const t of closedTiles) {
    if (removed < 2 && tilesEqual(t, ponTile)) { removed++; continue; }
    afterRemove.push(t);
  }
  if (removed < 2) return false;

  const newMeldCount = meldCount + 1;
  let best = Infinity;
  for (let i = 0; i < afterRemove.length; i++) {
    const rest = afterRemove.filter((_, j) => j !== i);
    const s = calcShanten(rest, newMeldCount);
    if (s < best) best = s;
  }

  return best < currentShanten || best === 0;
}

/**
 * 暗槓すべきか（シャンテン数が悪化しない）
 */
export function shouldKan(closedTiles, kanTile, meldCount = 0) {
  const currentShanten = calcShanten(closedTiles, meldCount);
  const after = closedTiles.filter(t => !tilesEqual(t, kanTile));
  return calcShanten(after, meldCount + 1) <= currentShanten;
}
