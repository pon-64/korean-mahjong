// hand.js - シャンテン数計算・和了判定・テンパイ牌列挙

// 牌→インデックス変換 (0-8=萬, 9-17=筒, 18-26=索, 27-33=字牌)
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
// DFS で左から順に牌を処理し、mentsu/jantai/taatsu を最大化する
function shantenRegular(c) {
  let best = 8;

  function dfs(i, mentsu, jantai, taatsu) {
    // 次の非ゼロ位置まで進む
    while (i < 34 && c[i] === 0) i++;

    if (i >= 34) {
      // mentsu+taatsu の合計は 4 まで
      const p = Math.min(taatsu, 4 - mentsu);
      const val = 2 * mentsu + (jantai ? 1 : 0) + p;
      if (8 - val < best) best = 8 - val;
      return;
    }

    // 上界プルーニング: 残り牌を全部メンツにしても best を超えられないなら中断
    let rem = 0;
    for (let j = i; j < 34; j++) rem += c[j];
    const maxMore = 2 * Math.floor(rem / 3) + Math.min(rem % 3, 2);
    const currVal = 2 * mentsu + (jantai ? 1 : 0) + Math.min(taatsu, 4 - mentsu);
    if (8 - (currVal + maxMore) >= best) return;

    const suit    = Math.floor(i / 9);   // 0=萬 1=筒 2=索 3=字
    const inSuit  = i % 9;               // スーツ内の位置 (0-8)

    // 刻子（mentsu）
    if (c[i] >= 3 && mentsu < 4) {
      c[i] -= 3;
      dfs(i, mentsu + 1, jantai, taatsu);
      c[i] += 3;
    }

    // 順子（mentsu）- 数牌のみ
    if (suit < 3 && inSuit <= 6 && mentsu < 4 &&
        c[i] >= 1 && c[i+1] >= 1 && c[i+2] >= 1) {
      c[i]--; c[i+1]--; c[i+2]--;
      dfs(i, mentsu + 1, jantai, taatsu);
      c[i]++; c[i+1]++; c[i+2]++;
    }

    // 雀頭（jantai）
    if (!jantai && c[i] >= 2) {
      c[i] -= 2;
      dfs(i, mentsu, true, taatsu);
      c[i] += 2;
    }

    // 塔子：対子
    if (c[i] >= 2 && mentsu + taatsu < 4) {
      c[i] -= 2;
      dfs(i, mentsu, jantai, taatsu + 1);
      c[i] += 2;
    }

    // 塔子：順子候補（数牌のみ）
    if (suit < 3 && mentsu + taatsu < 4) {
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

    // この牌をスキップ（使わない）
    dfs(i + 1, mentsu, jantai, taatsu);
  }

  dfs(0, 0, false, 0);
  return best;
}

// ---- 七対子シャンテン数（韓麻：同一牌4枚=2対子）----
function shantenChiitoi(c) {
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    pairs += Math.floor(c[i] / 2);
  }
  return 6 - Math.min(pairs, 7);
}

// ---- 国士無双シャンテン数 ----
const KOKUSHI_IDX = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

function shantenKokushi(c) {
  let kinds = 0;
  let hasPair = false;
  for (const i of KOKUSHI_IDX) {
    if (c[i] >= 1) {
      kinds++;
      if (c[i] >= 2) hasPair = true;
    }
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

// ---- 公開 API ----

export function calcShanten(tiles) {
  if (tiles.length === 0) return 8;
  const c = tilesToCounts(tiles);
  return Math.min(
    shantenRegular(c),
    shantenChiitoi(c),
    shantenKokushi(c)
  );
}

export function isWinningHand(tiles) {
  return calcShanten(tiles) === -1;
}

export function getTenpaiWaits(tiles) {
  if (calcShanten(tiles) !== 0) return [];
  const waits = [];
  for (let i = 0; i < 34; i++) {
    const testTile = { suit: idxToSuit(i), num: idxToNum(i), isRed: false, id: -1 };
    if (calcShanten([...tiles, testTile]) === -1) {
      waits.push({ suit: testTile.suit, num: testTile.num });
    }
  }
  return waits;
}

export function getWinType(tiles) {
  const c = tilesToCounts(tiles);
  if (shantenKokushi(c) === -1) return 'kokushi';
  if (shantenChiitoi(c) === -1) return 'chiitoi';
  return 'normal';
}
