// tilesvg.js - 牌SVGグラフィック生成（雀魂スタイル）

const VW = 38, VH = 52; // viewBox寸法

// ===========================
// 萬子（Man）
// ===========================

const MAN_CHARS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function manSVG(num) {
  const color = '#cc1111';
  return (
    `<text x="${VW / 2}" y="34" text-anchor="middle" ` +
    `font-family="'Hiragino Mincho ProN','YuMincho','MS Mincho',serif" ` +
    `font-size="24" font-weight="bold" fill="${color}">${MAN_CHARS[num]}</text>` +
    `<text x="${VW / 2}" y="47" text-anchor="middle" ` +
    `font-family="'Hiragino Mincho ProN','YuMincho','MS Mincho',serif" ` +
    `font-size="11" fill="${color}">萬</text>`
  );
}

// ===========================
// 筒子（Pin）
// ===========================

// ドット配置 [cx%, cy%]（viewBox 38×52 基準）
const PIN_DOT_POS = [
  null,
  [[50, 50]],
  [[50, 33], [50, 67]],
  [[68, 27], [50, 53], [32, 78]],
  [[30, 30], [70, 30], [30, 70], [70, 70]],
  [[30, 24], [70, 24], [50, 50], [30, 76], [70, 76]],
  [[30, 24], [70, 24], [30, 50], [70, 50], [30, 76], [70, 76]],
  [[30, 19], [70, 19], [50, 39], [30, 59], [70, 59], [30, 79], [70, 79]],
  [[30, 17], [70, 17], [30, 41], [70, 41], [30, 63], [70, 63], [30, 84], [70, 84]],
  [[25, 17], [50, 17], [75, 17], [25, 50], [50, 50], [75, 50], [25, 83], [50, 83], [75, 83]],
];

function getDotR(count) {
  if (count === 1) return 9;
  if (count <= 2)  return 8.5;
  if (count <= 4)  return 8;
  if (count <= 6)  return 7.5;
  return 6.5;
}

function pinSVG(num, isRed) {
  const positions = PIN_DOT_POS[num];
  const r = getDotR(positions.length);
  let svg = '';
  for (let i = 0; i < positions.length; i++) {
    const [px, py] = positions[i];
    const cx = (px * VW / 100).toFixed(1);
    const cy = (py * VH / 100).toFixed(1);
    // 5p isRed: 中心ドットを赤に
    const centerRed = isRed && positions.length === 5 && i === 2;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#0a5a28"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${(r * 0.68).toFixed(1)}" fill="#ffffff"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${(r * 0.42).toFixed(1)}" fill="${centerRed ? '#cc1111' : '#1a8040'}"/>`;
  }
  return svg;
}

// ===========================
// 索子（Sou）
// ===========================

function makeBambooStick(cx, yTop, yBot, stickW) {
  const half  = stickW / 2;
  const segH  = (yBot - yTop) / 3;
  const colors = ['#2e7d32', '#1b5e20', '#2e7d32'];
  let svg = '';
  for (let i = 0; i < 3; i++) {
    const sy = yTop + i * segH;
    svg += `<rect x="${(cx - half).toFixed(1)}" y="${(sy + 0.5).toFixed(1)}" ` +
           `width="${stickW}" height="${(segH - 1.5).toFixed(1)}" rx="2" fill="${colors[i]}"/>`;
    if (i < 2) {
      const ny  = (sy + segH).toFixed(1);
      const rnx = Math.min(half + 1, 3).toFixed(1);
      svg += `<ellipse cx="${cx.toFixed(1)}" cy="${ny}" rx="${rnx}" ry="1.5" fill="#0d3d10"/>`;
    }
  }
  return svg;
}

// 本数ごとの竹の幅
const SOU_STICK_W = [0, 0, 8, 8, 6, 5, 5, 4, 3, 3];

function souSVG(num, isRed) {
  if (num === 1) {
    const innerColor = isRed ? '#cc1111' : '#1a8040';
    return (
      `<ellipse cx="${VW / 2}" cy="${VH / 2}" rx="13" ry="17" fill="#0a5a28"/>` +
      `<ellipse cx="${VW / 2}" cy="${VH / 2}" rx="9.5" ry="12.5" fill="#ffffff"/>` +
      `<ellipse cx="${VW / 2}" cy="${VH / 2}" rx="6" ry="8" fill="${innerColor}"/>`
    );
  }

  const stickW   = SOU_STICK_W[num];
  const spacing  = VW / (num + 1);
  let sticks = '';
  for (let i = 1; i <= num; i++) {
    sticks += makeBambooStick(i * spacing, 6, 46, stickW);
  }
  return sticks;
}

// ===========================
// 字牌（Honor）
// ===========================

const HONOR_CHARS  = ['', '東', '南', '西', '北', '白', '發', '中'];
const HONOR_COLORS = ['', '#1144cc', '#cc2222', '#117722', '#1111aa', '#888888', '#119922', '#cc2222'];

function honorSVG(num) {
  if (num === 5) {
    // 白: 縁取りのみ
    return `<rect x="6" y="10" width="26" height="32" rx="3" fill="none" stroke="#888888" stroke-width="2.5"/>`;
  }
  const color = HONOR_COLORS[num];
  const char  = HONOR_CHARS[num];
  return (
    `<text x="${VW / 2}" y="38" text-anchor="middle" ` +
    `font-family="'Hiragino Sans','Meiryo',sans-serif" ` +
    `font-size="26" font-weight="bold" fill="${color}">${char}</text>`
  );
}

// ===========================
// エクスポート
// ===========================

export function getTileSVG(tile) {
  const { suit, num, isRed } = tile;
  let inner = '';
  if      (suit === 'm') inner = manSVG(num);
  else if (suit === 'p') inner = pinSVG(num, isRed);
  else if (suit === 's') inner = souSVG(num, isRed);
  else                   inner = honorSVG(num);

  return (
    `<svg class="tile-svg" viewBox="0 0 ${VW} ${VH}" ` +
    `xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">` +
    inner +
    `</svg>`
  );
}
