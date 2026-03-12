// train/apply.mjs
// weights.json の結果を js/ai.js に自動反映する
//
// 使い方:
//   node train/apply.mjs          # プレビューのみ
//   node train/apply.mjs --write  # 実際に ai.js を更新

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEIGHTS_PATH = join(__dir, 'weights.json');
const AI_PATH      = join(__dir, '..', 'js', 'ai.js');
const WRITE        = process.argv.includes('--write');

// weights.json 読み込み
let saved;
try {
  saved = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf8'));
} catch {
  console.error('weights.json が見つかりません。先に train.mjs を実行してください。');
  process.exit(1);
}

const w = saved.weights;
console.log('=== weights.json ===');
console.log(`学習日時: ${saved.timestamp}`);
console.log(`イテレーション: ${saved.iterations}, ゲーム数/評価: ${saved.gamesPerEval}`);
console.log(`ベースライン avgScore: ${saved.baselineAvgScore?.toFixed(2)}`);
console.log(`最良 avgScore:        ${saved.bestAvgScore?.toFixed(2)}`);
console.log(`改善回数: ${saved.improvements}`);
console.log('');
console.log('重み:');
for (const [k, v] of Object.entries(w)) console.log(`  ${k}: ${v}`);
console.log('');

// ai.js を読み込んで定数を置換
let src = readFileSync(AI_PATH, 'utf8');
const original = src;

// handValue: -(sh * 100) → -(sh * N)  (2箇所とも)
src = src.replaceAll(/-(sh \* \d+(?:\.\d+)?)/g, `-(sh * ${w.shantenPenalty})`);

// handValue tenpaiBonus: return 200 +
src = src.replaceAll(/return 200 \+/g, `return ${w.tenpaiBonus} +`);

// calcDiscardAnalysis の base 行も同様に更新
// (sh === 0) ? 200 + eff : -(sh * 100) + eff
src = src.replace(
  /\(sh === 0\) \? \d+(?:\.\d+)? \+ eff/,
  `(sh === 0) ? ${w.tenpaiBonus} + eff`
);

// 赤ドラペナルティ: if (tile.isRed) score -= 15;
src = src.replace(
  /if \(tile\.isRed\) score -= \d+(?:\.\d+)?;/,
  `if (tile.isRed) score -= ${w.redDoraPenalty};`
);

// 通常ドラペナルティ: else if (...) score -= 10;
src = src.replace(
  /\(doras\.some\([^)]+\)\) score -= \d+(?:\.\d+)?;/,
  `(doras.some(d => d.suit === tile.suit && d.num === tile.num)) score -= ${w.doraPenalty};`
);

// 安全牌ボーナス: score += 25;
src = src.replace(
  /safeKeys\.has\(tile\.suit \+ tile\.num\)\) score \+= \d+(?:\.\d+)?;/,
  `safeKeys.has(tile.suit + tile.num)) score += ${w.safeBonus};`
);

// 各パターンが ai.js に存在するか確認 (括弧はリテラルとして \( \) でエスケープ)
const checks = {
  shantenPenalty:  /sh \* \d+/.test(original),
  tenpaiBonus:     /return \d+ \+/.test(original),
  redDoraPenalty:  /isRed\) score -= \d+/.test(original),
  doraPenalty:     /doras\.some/.test(original) && /score -= \d+/.test(original),
  safeBonus:       /safeKeys\.has/.test(original) && /score \+= \d+/.test(original),
};
const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (missing.length > 0) {
  console.log(`警告: 以下のパターンが ai.js で見つかりませんでした: ${missing.join(', ')}`);
  console.log('ai.js の構造が変わった可能性があります。手動で反映してください。');
  process.exit(1);
}

// diff表示（変更箇所）
const origLines = original.split('\n');
const newLines  = src.split('\n');
console.log('--- 変更箇所 (ai.js) ---');
for (let i = 0; i < origLines.length; i++) {
  if (origLines[i] !== newLines[i]) {
    console.log(`行${i + 1}:`);
    console.log(`  - ${origLines[i].trim()}`);
    console.log(`  + ${newLines[i].trim()}`);
  }
}
console.log('');

if (WRITE) {
  // バックアップ
  writeFileSync(AI_PATH + '.bak', original);
  writeFileSync(AI_PATH, src);
  console.log('ai.js を更新しました。バックアップ: ai.js.bak');
} else {
  console.log('※ 実際に反映するには --write オプションを付けて実行してください:');
  console.log('   node train/apply.mjs --write');
}
