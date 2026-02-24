// ai.js - CPU AI（シャンテン数ベース）

import { SUITS, tilesEqual, tileKey } from './tiles.js';
import { calcShanten, getTenpaiWaits, isWinningHand } from './hand.js';

/**
 * 捨て牌を決定する（シャンテン数最小化）
 * @param {Array} tiles - 手牌14枚（副露後は14-副露数*3+1枚 + 副露）
 * @param {Array} meldTiles - 副露している牌（除外してシャンテン計算）
 * @param {Array} doras - 現在のドラ牌リスト
 * @returns tile - 捨てる牌
 */
export function chooseDiscard(tiles, meldTiles = [], doras = []) {
  // 手牌から副露牌を除いた閉じた手牌
  const closedTiles = tiles.filter(t => !meldTiles.some(m => m.id === t.id));

  let bestShanten = Infinity;
  let bestTiles = [];

  for (let i = 0; i < closedTiles.length; i++) {
    const candidate = [...closedTiles.slice(0, i), ...closedTiles.slice(i + 1)];
    const s = calcShanten(candidate);
    if (s < bestShanten) {
      bestShanten = s;
      bestTiles = [closedTiles[i]];
    } else if (s === bestShanten) {
      bestTiles.push(closedTiles[i]);
    }
  }

  if (bestTiles.length === 1) return bestTiles[0];

  // 同シャンテン数の中から優先度で選ぶ
  // 優先度: 孤立字牌 > 孤立数牌端 > ドラ以外 > ドラ
  return bestTiles.sort((a, b) => {
    const aScore = discardPriority(a, doras, closedTiles);
    const bScore = discardPriority(b, doras, closedTiles);
    return bScore - aScore; // 高いほど捨てやすい
  })[0];
}

function discardPriority(tile, doras, hand) {
  let score = 0;

  // ドラは捨てにくい
  if (tile.isRed) score -= 10;
  if (doras.some(d => tilesEqual(d, tile))) score -= 8;

  // 字牌は捨てやすい
  if (tile.suit === SUITS.HONOR) score += 5;

  // 数牌の端（1,9）は孤立しやすい
  if (tile.suit !== SUITS.HONOR && (tile.num === 1 || tile.num === 9)) score += 2;

  // 手牌内に隣接牌があるか確認（ない=孤立牌）
  if (tile.suit !== SUITS.HONOR) {
    const hasNeighbor = hand.some(t =>
      t !== tile && t.suit === tile.suit &&
      (t.num === tile.num - 1 || t.num === tile.num + 1 ||
       t.num === tile.num - 2 || t.num === tile.num + 2)
    );
    if (!hasNeighbor) score += 3;
  }

  return score;
}

/**
 * リーチを宣言すべきか判断
 */
export function shouldRiichi(closedTiles) {
  return calcShanten(closedTiles) === 0; // テンパイならリーチ
}

/**
 * ポンすべきか判断（シャンテン数が下がるか）
 */
export function shouldPon(closedTiles, ponTile, doras = []) {
  const currentShanten = calcShanten(closedTiles);

  // ポン後の仮手牌（ponTileを2枚使ってメンツ確定）
  const remaining = [...closedTiles];
  let removed = 0;
  for (let i = remaining.length - 1; i >= 0 && removed < 2; i--) {
    if (tilesEqual(remaining[i], ponTile)) {
      remaining.splice(i, 1);
      removed++;
    }
  }

  // ポン後に1枚捨てた場合のシャンテン数
  let afterShanten = Infinity;
  for (let i = 0; i < remaining.length; i++) {
    const test = [...remaining.slice(0, i), ...remaining.slice(i + 1)];
    const s = calcShanten(test);
    if (s < afterShanten) afterShanten = s;
  }

  // シャンテン数が下がるかテンパイになる場合はポン
  return afterShanten <= currentShanten - 1 || afterShanten === 0;
}

/**
 * カン（暗槓）すべきか判断
 */
export function shouldKan(closedTiles, kanTile) {
  const currentShanten = calcShanten(closedTiles);

  // カン後（4枚除いてシャンテン計算）
  const remaining = closedTiles.filter(t => !tilesEqual(t, kanTile));
  const afterShanten = calcShanten(remaining);

  // シャンテン数が変わらない or 改善する場合のみカン
  return afterShanten <= currentShanten;
}
