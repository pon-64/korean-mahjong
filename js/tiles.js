// tiles.js - 牌定義・ユーティリティ

export const SUITS = { MAN: 'm', PIN: 'p', SOU: 's', HONOR: 'z' };

// 字牌: 1=東 2=南 3=西 4=北 5=白 6=發 7=中
export const HONOR_NAMES = ['', '東', '南', '西', '北', '白', '發', '中'];
export const MAN_NAMES  = ['', '一萬', '二萬', '三萬', '四萬', '五萬', '六萬', '七萬', '八萬', '九萬'];
export const PIN_NAMES  = ['', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒'];
export const SOU_NAMES  = ['', '1索', '2索', '3索', '4索', '5索', '6索', '7索', '8索', '9索'];

export function tileName(tile) {
  if (tile.suit === SUITS.MAN)   return (tile.isRed ? '赤' : '') + MAN_NAMES[tile.num];
  if (tile.suit === SUITS.PIN)   return (tile.isRed ? '赤' : '') + PIN_NAMES[tile.num];
  if (tile.suit === SUITS.SOU)   return (tile.isRed ? '赤' : '') + SOU_NAMES[tile.num];
  return HONOR_NAMES[tile.num];
}

export function tileKey(tile) {
  return tile.suit + tile.num;
}

export function tilesEqual(a, b) {
  return a.suit === b.suit && a.num === b.num;
}

/** 136枚の牌セットを生成する */
export function createTileSet() {
  const tiles = [];
  let id = 0;

  for (const suit of [SUITS.MAN, SUITS.PIN, SUITS.SOU]) {
    for (let num = 1; num <= 9; num++) {
      for (let copy = 0; copy < 4; copy++) {
        // 5m/5p/5s は全4枚が赤ドラ
        const isRed = (num === 5);
        tiles.push({ id: id++, suit, num, isRed });
      }
    }
  }

  // 字牌（東南西北白發中）
  for (let num = 1; num <= 7; num++) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ id: id++, suit: SUITS.HONOR, num, isRed: false });
    }
  }

  return tiles; // 計136枚
}

/** ドラ表示牌 → ドラ牌に変換 */
export function getDoraFromIndicator(indicator) {
  if (indicator.suit === SUITS.HONOR) {
    // 風牌: 北→東, 中→東(白→發→中→白)
    const windCycle = [1, 2, 3, 4, 1]; // 東南西北→東
    const dragonCycle = [5, 6, 7, 5];  // 白發中→白
    if (indicator.num <= 4) {
      return { suit: SUITS.HONOR, num: windCycle[indicator.num] };
    } else {
      return { suit: SUITS.HONOR, num: dragonCycle[indicator.num - 5] };
    }
  }
  // 数牌: 9→1
  return { suit: indicator.suit, num: indicator.num === 9 ? 1 : indicator.num + 1 };
}

/** 手牌を suit, num でソートする */
export function sortTiles(tiles) {
  const suitOrder = { m: 0, p: 1, s: 2, z: 3 };
  return [...tiles].sort((a, b) => {
    const sd = suitOrder[a.suit] - suitOrder[b.suit];
    if (sd !== 0) return sd;
    return a.num - b.num;
  });
}
