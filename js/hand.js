// hand.js - シャンテン数計算・和了判定・テンパイ牌列挙

function tileIndex(t) {
  if (t.suit === 'm') return t.num - 1;
  if (t.suit === 'p') return 9 + t.num - 1;
  if (t.suit === 's') return 18 + t.num - 1;
  return 27 + t.num - 1;
}

function idxToSuit(i) {
  if (i < 9)  return 'm';
  if (i < 18) return 'p';
  if (i < 27) return 's';
  return 'z';
}

function idxToNum(i) {
  return (i < 27) ? (i % 9) + 1 : (i - 27) + 1;
}

function tilesToCounts(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) c[tileIndex(t)]++;
  return c;
}

// ---- 通常形シャンテン数 ----
// meldCount: すでに完成している副露メンツ数（ポン・カン）
function shantenRegular(c, meldCount) {
  const maxMentsu = 4 - meldCount; // 閉じた手牌で作るべき残りメンツ数
  let best = 8;

  function dfs(i, mentsu, jantai, taatsu) {
    while (i < 34 && c[i] === 0) i++;

    if (i >= 34) {
      const p   = Math.min(taatsu, maxMentsu - mentsu);
      const val = 2 * (mentsu + meldCount) + (jantai ? 1 : 0) + p;
      if (8 - val < best) best = 8 - val;
      return;
    }

    // 上界プルーニング
    let rem = 0;
    for (let j = i; j < 34; j++) rem += c[j];
    const addMentsu = Math.min(Math.floor(rem / 3), maxMentsu - mentsu);
    const addPartial = Math.min(Math.floor((rem - addMentsu * 3) / 2), maxMentsu - mentsu - addMentsu);
    const currVal = 2 * (mentsu + meldCount) + (jantai ? 1 : 0) + Math.min(taatsu, maxMentsu - mentsu);
    if (8 - (currVal + 2 * addMentsu + addPartial) >= best) return;

    const suit   = Math.floor(i / 9);
    const inSuit = i % 9;

    // 刻子
    if (c[i] >= 3 && mentsu < maxMentsu) {
      c[i] -= 3;
      dfs(i, mentsu + 1, jantai, taatsu);
      c[i] += 3;
    }

    // 順子（数牌のみ）
    if (suit < 3 && inSuit <= 6 && mentsu < maxMentsu &&
        c[i] >= 1 && c[i+1] >= 1 && c[i+2] >= 1) {
      c[i]--; c[i+1]--; c[i+2]--;
      dfs(i, mentsu + 1, jantai, taatsu);
      c[i]++; c[i+1]++; c[i+2]++;
    }

    // 雀頭
    if (!jantai && c[i] >= 2) {
      c[i] -= 2;
      dfs(i, mentsu, true, taatsu);
      c[i] += 2;
    }

    // 対子（塔子）
    if (c[i] >= 2 && mentsu + taatsu < maxMentsu) {
      c[i] -= 2;
      dfs(i, mentsu, jantai, taatsu + 1);
      c[i] += 2;
    }

    // 連続塔子（数牌のみ）
    if (suit < 3 && mentsu + taatsu < maxMentsu) {
      if (inSuit <= 7 && c[i+1] >= 1) {
        c[i]--; c[i+1]--;
        dfs(i, mentsu, jantai, taatsu + 1);
        c[i]++; c[i+1]++;
      }
      if (inSuit <= 6 && c[i+2] >= 1) {
        c[i]--; c[i+2]--;
        dfs(i, mentsu, jantai, taatsu + 1);
        c[i]++; c[i+2]++;
      }
    }

    dfs(i + 1, mentsu, jantai, taatsu);
  }

  dfs(0, 0, false, 0);
  return best;
}

// ---- 七対子（副露なし専用・韓麻: 同一牌4枚=2対子）----
function shantenChiitoi(c) {
  let pairs = 0;
  for (let i = 0; i < 34; i++) pairs += Math.floor(c[i] / 2);
  return 6 - Math.min(pairs, 7);
}

// ---- 国士無双（副露なし専用）----
const KOKUSHI_IDX = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

function shantenKokushi(c) {
  let kinds = 0, hasPair = false;
  for (const i of KOKUSHI_IDX) {
    if (c[i] >= 1) { kinds++; if (c[i] >= 2) hasPair = true; }
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

// ---- 公開 API ----

/**
 * シャンテン数を返す（-1=和了）
 * @param {Array}  tiles      閉じた手牌（副露牌を除く）+ ツモ/ロン牌
 * @param {number} meldCount  副露済みメンツ数（ポン・カン）
 */
export function calcShanten(tiles, meldCount = 0) {
  if (tiles.length === 0) return 8;
  const c = tilesToCounts(tiles);
  const n = shantenRegular(c, meldCount);
  // 七対子・国士は副露なし専用
  if (meldCount > 0) return n;
  return Math.min(n, shantenChiitoi(c), shantenKokushi(c));
}

export function isWinningHand(tiles, meldCount = 0) {
  return calcShanten(tiles, meldCount) === -1;
}

/**
 * テンパイ待ち牌一覧
 * @param {Array}  tiles      閉じた手牌
 * @param {number} meldCount
 */
export function getTenpaiWaits(tiles, meldCount = 0) {
  if (calcShanten(tiles, meldCount) !== 0) return [];
  const waits = [];
  for (let i = 0; i < 34; i++) {
    const t = { suit: idxToSuit(i), num: idxToNum(i), isRed: false, id: -1 };
    if (calcShanten([...tiles, t], meldCount) === -1) {
      waits.push({ suit: t.suit, num: t.num });
    }
  }
  return waits;
}

export function getWinType(tiles, meldCount = 0) {
  const c = tilesToCounts(tiles);
  if (meldCount === 0 && shantenKokushi(c) === -1) return 'kokushi';
  if (meldCount === 0 && shantenChiitoi(c) === -1) return 'chiitoi';
  return 'normal';
}
