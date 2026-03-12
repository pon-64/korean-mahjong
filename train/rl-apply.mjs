// train/rl-apply.mjs
// RL学習結果 (weights-rl-best.json) を ai.js に反映する
//
// 使い方:
//   node train/rl-apply.mjs          # プレビュー
//   node train/rl-apply.mjs --write  # ai.js を更新

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateAiPatch } from './rl-ai.mjs';

const __dir   = dirname(fileURLToPath(import.meta.url));
const BEST    = join(__dir, 'weights-rl-best.json');
const AI_PATH = join(__dir, '..', 'js', 'ai.js');
const WRITE   = process.argv.includes('--write');

// ---- Load best weights ----
if (!existsSync(BEST)) {
  console.error('weights-rl-best.json が見つかりません。学習がまだ完了していない可能性があります。');
  console.error('weights-rl.json (チェックポイント) がある場合はそれを使用します...');
  const cp = join(__dir, 'weights-rl.json');
  if (!existsSync(cp)) { console.error('チェックポイントも見つかりません。'); process.exit(1); }
  console.error('weights-rl.json を使用します');
}

const path   = existsSync(BEST) ? BEST : join(__dir, 'weights-rl.json');
const saved  = JSON.parse(readFileSync(path, 'utf8'));
const w      = saved.weights;

console.log('=== RL学習結果 ===');
console.log(`ファイル: ${path}`);
console.log(`学習局数: ${(saved.iteration || 0).toLocaleString()}`);
console.log(`評価スコア: ${(saved.evalScore ?? 'N/A')}`);
console.log(`勝率: ${saved.evalWinRate ? (saved.evalWinRate * 100).toFixed(1) + '%' : 'N/A'}`);
console.log(`タイムスタンプ: ${saved.timestamp || 'N/A'}`);
console.log('');

// ---- Generate patch ----
const patch = generateAiPatch(w);
console.log('=== 変換された ai.js パラメータ ===');
console.log(JSON.stringify(patch, null, 2));
console.log('');

// ---- Apply to ai.js ----
let src = readFileSync(AI_PATH, 'utf8');
const original = src;

src = src.replaceAll(/sh \* \d+(?:\.\d+)?/g, `sh * ${patch.shantenPenalty}`);
src = src.replaceAll(/return \d+(?:\.\d+)? \+/g, `return ${patch.tenpaiBonus} +`);
src = src.replace(
  /\(sh === 0\) \? \d+(?:\.\d+)? \+ eff/,
  `(sh === 0) ? ${patch.tenpaiBonus} + eff`
);
src = src.replace(
  /if \(tile\.isRed\) score -= \d+(?:\.\d+)?;/,
  `if (tile.isRed) score -= ${patch.redDoraPenalty};`
);
src = src.replace(
  /\(doras\.some\([^)]+\)\) score -= \d+(?:\.\d+)?;/,
  `(doras.some(d => d.suit === tile.suit && d.num === tile.num)) score -= ${patch.doraPenalty};`
);
src = src.replace(
  /safeKeys\.has\(tile\.suit \+ tile\.num\)\) score \+= \d+(?:\.\d+)?;/,
  `safeKeys.has(tile.suit + tile.num)) score += ${patch.safeBonus};`
);

// Diff
const ol = original.split('\n');
const nl = src.split('\n');
console.log('=== ai.js 変更箇所 ===');
let changed = 0;
for (let i = 0; i < ol.length; i++) {
  if (ol[i] !== nl[i]) {
    console.log(`行${i + 1}:`);
    console.log(`  - ${ol[i].trim()}`);
    console.log(`  + ${nl[i].trim()}`);
    changed++;
  }
}

if (changed === 0) {
  console.log('変更なし（学習結果がデフォルト値と同じ、またはパターンが見つからない）');
} else {
  console.log(`\n${changed} 箇所変更`);
}

if (WRITE) {
  writeFileSync(AI_PATH + '.bak', original);
  writeFileSync(AI_PATH, src);
  console.log('\nai.js を更新しました (バックアップ: ai.js.bak)');
  console.log('\n次のステップ:');
  console.log('  git add js/ai.js');
  console.log('  git commit -m "ai: apply RL self-play trained weights"');
  console.log('  git push');
} else {
  console.log('\n適用するには:');
  console.log('  node train/rl-apply.mjs --write');
}
