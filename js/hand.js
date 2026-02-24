// hand.js - シャンテン数計算・和了判定・テンパイ牌列挙

import { SUITS, tileKey, tilesEqual } from './tiles.js';

/**
 * 牌配列 → スーツ別カウントマップ { 'm': [0,cnt1..cnt9], 'p':..., 's':..., 'z':[0..cnt7] }
 */
function countBySuit(tiles) {
  const counts = {
    m: new Array(10).fill(0),
    p: new Array(10).fill(0),
    s: new Array(10).fill(0),
    z: new Array(8).fill(0),
  };
  for (const t of tiles) {
    counts[t.suit][t.num]++;
  }
  return counts;
}

// ---- 通常形シャンテン数 ----

function calcNormalShanten(counts) {
  let minShanten = 8;

  function trySuit(suit, arr, mentsu, jantai, partial) {
    // 雀頭候補（各スーツ）
    if (suit === 'z') {
      // 字牌は刻子・雀頭のみ
      return tryHonorSuit(arr.slice(), mentsu, jantai, partial);
    }
    return tryNumSuit(suit, arr.slice(), mentsu, jantai, partial);
  }

  function solve(suitIdx, mentsu, jantai, partial) {
    const suits = ['m', 'p', 's', 'z'];
    if (suitIdx === 4) {
      // 完成評価
      const s = 8 - 2 * mentsu - partial - (jantai ? 1 : 0);
      minShanten = Math.min(minShanten, Math.max(-1, s));
      return;
    }
    const suit = suits[suitIdx];
    const arr = counts[suit].slice();
    processSuit(suit, arr, suitIdx, mentsu, jantai, partial);
  }

  function processSuit(suit, arr, suitIdx, mentsu, jantai, partial) {
    const suits = ['m', 'p', 's', 'z'];
    // 雀頭を取る試み（まだ取っていない場合）
    const maxNum = suit === 'z' ? 7 : 9;
    for (let n = 1; n <= maxNum; n++) {
      if (arr[n] >= 2 && !jantai) {
        const arr2 = arr.slice();
        arr2[n] -= 2;
        extractMentsu(suit, arr2, suitIdx, mentsu, true, partial);
      }
    }
    // 雀頭なしでメンツ抽出
    extractMentsu(suit, arr.slice(), suitIdx, mentsu, jantai, partial);
  }

  function extractMentsu(suit, arr, suitIdx, mentsu, jantai, partial) {
    const suits = ['m', 'p', 's', 'z'];
    const maxNum = suit === 'z' ? 7 : 9;

    // 刻子
    for (let n = 1; n <= maxNum; n++) {
      if (arr[n] >= 3) {
        arr[n] -= 3;
        extractMentsu(suit, arr, suitIdx, mentsu + 1, jantai, partial);
        arr[n] += 3;
      }
    }

    // 順子（数牌のみ）
    if (suit !== 'z') {
      for (let n = 1; n <= 7; n++) {
        if (arr[n] > 0 && arr[n+1] > 0 && arr[n+2] > 0) {
          arr[n]--; arr[n+1]--; arr[n+2]--;
          extractMentsu(suit, arr, suitIdx, mentsu + 1, jantai, partial);
          arr[n]++; arr[n+1]++; arr[n+2]++;
        }
      }
    }

    // 塔子（partial）
    for (let n = 1; n <= maxNum; n++) {
      if (arr[n] >= 2) {
        arr[n] -= 2;
        const p = Math.min(partial + 1, 4 - mentsu);
        extractMentsu(suit, arr, suitIdx, mentsu, jantai, p);
        arr[n] += 2;
      }
    }
    if (suit !== 'z') {
      for (let n = 1; n <= 8; n++) {
        if (arr[n] > 0 && arr[n+1] > 0) {
          arr[n]--; arr[n+1]--;
          const p = Math.min(partial + 1, 4 - mentsu);
          extractMentsu(suit, arr, suitIdx, mentsu, jantai, p);
          arr[n]++; arr[n+1]++;
        }
      }
      for (let n = 1; n <= 7; n++) {
        if (arr[n] > 0 && arr[n+2] > 0) {
          arr[n]--; arr[n+2]--;
          const p = Math.min(partial + 1, 4 - mentsu);
          extractMentsu(suit, arr, suitIdx, mentsu, jantai, p);
          arr[n]++; arr[n+2]++;
        }
      }
    }

    // このスーツ完了 → 次へ
    const s = 8 - 2 * mentsu - partial - (jantai ? 1 : 0);
    // proceed to next suit
    solve(suitIdx + 1, mentsu, jantai, partial);
  }

  solve(0, 0, false, 0);
  return minShanten;
}

// ---- 七対子シャンテン数 ----
function calcChitoiShanten(counts) {
  let pairs = 0;
  let kinds = 0;
  for (const suit of ['m', 'p', 's', 'z']) {
    const max = suit === 'z' ? 7 : 9;
    for (let n = 1; n <= max; n++) {
      if (counts[suit][n] >= 2) {
        pairs++;
        kinds++;
      } else if (counts[suit][n] === 1) {
        kinds++;
      }
    }
  }
  // 韓麻: 同一牌4枚使い可（4枚は2対子として数える）
  let pairsWithQuad = 0;
  for (const suit of ['m', 'p', 's', 'z']) {
    const max = suit === 'z' ? 7 : 9;
    for (let n = 1; n <= max; n++) {
      const cnt = counts[suit][n];
      pairsWithQuad += Math.floor(cnt / 2);
    }
  }
  // 7対子: 7ペア必要、最大7種類
  const effectivePairs = Math.min(pairsWithQuad, 7);
  return 6 - effectivePairs;
}

// ---- 国士無双シャンテン数 ----
const KOKUSHI_TILES = [
  { suit: 'm', num: 1 }, { suit: 'm', num: 9 },
  { suit: 'p', num: 1 }, { suit: 'p', num: 9 },
  { suit: 's', num: 1 }, { suit: 's', num: 9 },
  { suit: 'z', num: 1 }, { suit: 'z', num: 2 }, { suit: 'z', num: 3 },
  { suit: 'z', num: 4 }, { suit: 'z', num: 5 }, { suit: 'z', num: 6 }, { suit: 'z', num: 7 },
];

function calcKokushiShanten(counts) {
  let kinds = 0;
  let hasPair = false;
  for (const t of KOKUSHI_TILES) {
    if (counts[t.suit][t.num] >= 1) {
      kinds++;
      if (counts[t.suit][t.num] >= 2) hasPair = true;
    }
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

// ---- 公開API ----

/** シャンテン数を計算（-1 = 和了, 0 = テンパイ）*/
export function calcShanten(tiles) {
  const counts = countBySuit(tiles);
  const n = calcNormalShanten(counts);
  const c = calcChitoiShanten(counts);
  const k = calcKokushiShanten(counts);
  return Math.min(n, c, k);
}

/** 和了判定（シャンテン数 === -1）*/
export function isWinningHand(tiles) {
  return calcShanten(tiles) === -1;
}

/**
 * テンパイ待ち牌一覧を返す
 * tiles: 13枚（または副露後の有効枚数）
 */
export function getTenpaiWaits(tiles) {
  if (calcShanten(tiles) !== 0) return [];
  const waits = [];
  const tried = new Set();
  // 全種の牌（スーツ × 数）を試す
  for (const suit of ['m', 'p', 's', 'z']) {
    const max = suit === 'z' ? 7 : 9;
    for (let num = 1; num <= max; num++) {
      const key = suit + num;
      if (tried.has(key)) continue;
      tried.add(key);
      const testHand = [...tiles, { suit, num, isRed: false, id: -1 }];
      if (isWinningHand(testHand)) {
        waits.push({ suit, num });
      }
    }
  }
  return waits;
}

/**
 * 和了形の種類を返す（スコアリング用）
 * 'normal' | 'chiitoi' | 'kokushi'
 */
export function getWinType(tiles) {
  const counts = countBySuit(tiles);
  if (calcKokushiShanten(counts) === -1) return 'kokushi';
  if (calcChitoiShanten(counts) === -1) return 'chiitoi';
  return 'normal';
}
