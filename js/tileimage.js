// tileimage.js - 個別タイル画像を使った背景設定
// images/tiles/ に 37枚の PNG が入っている
//   字牌: 1z〜7z.png
//   数牌: 1m〜9m.png, 5rm.png (赤5m), 1s〜9s.png, 5rs.png, 1p〜9p.png, 5rp.png

function tileFilename(tile) {
  const { suit, num, isRed } = tile;
  if (suit === 'z') return `${num}z.png`;
  if (num === 5 && isRed) return `5r${suit}.png`;
  return `${num}${suit}.png`;
}

export function applyTileBackground(el, tile) {
  const file = tileFilename(tile);
  el.style.backgroundImage    = `url('images/tiles/${file}')`;
  el.style.backgroundSize     = '100% 100%';
  el.style.backgroundRepeat   = 'no-repeat';
  el.style.backgroundPosition = '0 0';
}
