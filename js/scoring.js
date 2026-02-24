// scoring.js - 点数計算（Paradise City ルール）

import { tilesEqual } from './tiles.js';
import { getWinType } from './hand.js';

const CAP_PER_PLAYER = 20; // 封頂

/**
 * ドラ枚数をカウントする
 * @param {Array} tiles - 手牌（副露含む全14枚）
 * @param {Array} doras - ドラ牌リスト（getDoraFromIndicator で変換済み）
 * @param {boolean} includeRed - 赤ドラをカウントするか
 */
export function countDora(tiles, doras, includeRed = true) {
  let cnt = 0;
  for (const tile of tiles) {
    if (includeRed && tile.isRed) cnt++;
    for (const dora of doras) {
      if (tilesEqual(tile, dora)) cnt++;
    }
  }
  return cnt;
}

/**
 * 点数を計算して返す
 * @param {Object} params
 *   winType: 'ron'|'tsumo'
 *   handTiles: 全手牌（14枚 + 副露）
 *   isRiichi: boolean
 *   doras: 表ドラ牌リスト
 *   uraDoras: 裏ドラ牌リスト
 *   isRiichiWin: リーチ和了か（裏ドラ適用条件）
 * @returns { base, riichi, red, omote, ura, total, breakdown }
 */
export function calcScore({ winType, handTiles, isRiichi, doras, uraDoras, isRiichiWin }) {
  const winForm = getWinType(handTiles);

  // 国士無双は封頂（20点固定）
  if (winForm === 'kokushi') {
    return { base: 20, riichi: 0, red: 0, omote: 0, ura: 0, total: 20, kokushi: true };
  }

  const base = winType === 'ron' ? 6 : 2;
  const riichi = isRiichi ? 2 : 0;

  // 赤ドラ
  let red = 0;
  for (const t of handTiles) {
    if (t.isRed) red++;
  }

  // 表ドラ（赤ドラは別カウントなので isRed=false として扱う）
  let omote = 0;
  for (const t of handTiles) {
    for (const d of doras) {
      if (t.suit === d.suit && t.num === d.num) omote++;
    }
  }

  // 裏ドラ（リーチ和了のみ）
  let ura = 0;
  if (isRiichi && isRiichiWin) {
    for (const t of handTiles) {
      for (const d of uraDoras) {
        if (t.suit === d.suit && t.num === d.num) ura++;
      }
    }
  }

  const total = base + riichi + red + omote + ura;

  return { base, riichi, red, omote, ura, total, kokushi: false };
}

/**
 * 支払い計算（封頂適用済み）
 * @param {number} total - 和了点合計
 * @param {string} winType - 'ron'|'tsumo'
 * @param {number} playerCount - プレイヤー数（4人打ちなら4）
 * @returns { payments: {[playerIdx]: number}, winnerGain: number }
 *   ronはロンされた1人が支払い
 *   tsumoは他全員が同額支払い
 */
export function calcPayments(total, winType, playerCount, ronFromIdx = null, winnerIdx = null) {
  const payments = {};

  if (winType === 'ron') {
    const pay = Math.min(total, CAP_PER_PLAYER);
    payments[ronFromIdx] = pay;
  } else {
    // tsumo: 他全員から
    const payEach = Math.min(total, CAP_PER_PLAYER);
    for (let i = 0; i < playerCount; i++) {
      if (i !== winnerIdx) {
        payments[i] = payEach;
      }
    }
  }

  const winnerGain = Object.values(payments).reduce((s, v) => s + v, 0);
  return { payments, winnerGain };
}
