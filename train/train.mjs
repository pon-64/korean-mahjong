// train/train.mjs
// Self-play training for Korean Mahjong AI weights
//
// 仕組み:
//   Player 0 = 学習中の候補重み
//   Player 1-3 = ベースライン重み (DEFAULT_WEIGHTS)
//   Player 0 の平均スコアが改善したら候補重みを採用 (ヒルクライミング)
//
// 使い方:
//   node train/train.mjs
//   node train/train.mjs --games 200 --iters 2000
//
// 結果:
//   train/weights.json に最良重みを保存
//   終了後、ai.js の DEFAULT_WEIGHTS を更新すること

import { runGame, DEFAULT_WEIGHTS } from './engine.mjs';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEIGHTS_PATH = join(__dir, 'weights.json');

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  return i !== -1 ? Number(args[i + 1]) : def;
}
const GAMES_PER_EVAL = getArg('--games', 150);  // ゲーム数/評価
const ITERATIONS     = getArg('--iters', 1000); // 試行回数
const LOG_INTERVAL   = getArg('--log', 50);     // 何イテレーションごとにログ

// --- Weight perturbation ---
const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS);

// 各重みの探索範囲 [min, max] と摂動量
const WEIGHT_CONFIG = {
  shantenPenalty:  { min: 10,  max: 500,  delta: 15 },
  tenpaiBonus:     { min: 50,  max: 500,  delta: 20 },
  effectiveBonus:  { min: 0,   max: 10,   delta: 0.5 },
  redDoraPenalty:  { min: 0,   max: 80,   delta: 5 },
  doraPenalty:     { min: 0,   max: 80,   delta: 5 },
  safeBonus:       { min: 0,   max: 100,  delta: 8 },
};

function perturb(weights) {
  const key = WEIGHT_KEYS[Math.floor(Math.random() * WEIGHT_KEYS.length)];
  const cfg = WEIGHT_CONFIG[key];
  const sign = Math.random() < 0.5 ? 1 : -1;
  const delta = sign * (Math.random() * cfg.delta * 2);
  const newVal = Math.max(cfg.min, Math.min(cfg.max, weights[key] + delta));
  return { ...weights, [key]: Math.round(newVal * 10) / 10 };
}

// --- Evaluation ---
// Player 0 uses `weights`, players 1-3 use DEFAULT_WEIGHTS.
// Returns average score of Player 0 over `games` games.
function evaluate(weights, games) {
  const ws = [weights, DEFAULT_WEIGHTS, DEFAULT_WEIGHTS, DEFAULT_WEIGHTS];
  let total = 0;
  let wins = 0;
  let draws = 0;
  for (let i = 0; i < games; i++) {
    const result = runGame(ws);
    total += result.scores[0];
    if (result.winner === 0) wins++;
    if (result.winner === -1) draws++;
  }
  return { avgScore: total / games, winRate: wins / games, drawRate: draws / games };
}

// --- Load existing weights if available ---
function loadWeights() {
  if (existsSync(WEIGHTS_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf8'));
      if (saved.weights) {
        console.log('既存の weights.json をロードして継続学習します');
        return saved.weights;
      }
    } catch {}
  }
  return { ...DEFAULT_WEIGHTS };
}

// --- Main training loop ---
async function train() {
  console.log('=== Korean Mahjong AI 自己対局学習 ===');
  console.log(`評価ゲーム数: ${GAMES_PER_EVAL}, イテレーション: ${ITERATIONS}`);
  console.log('');

  let current = loadWeights();
  const baselineEval = evaluate(DEFAULT_WEIGHTS, GAMES_PER_EVAL);
  console.log(`ベースライン評価: avgScore=${baselineEval.avgScore.toFixed(2)}, winRate=${(baselineEval.winRate * 100).toFixed(1)}%`);

  let { avgScore: currentScore } = evaluate(current, GAMES_PER_EVAL);
  console.log(`初期スコア: ${currentScore.toFixed(2)}`);
  console.log('');

  let improvements = 0;
  let bestScore = currentScore;
  let bestWeights = { ...current };

  const startTime = Date.now();

  for (let iter = 1; iter <= ITERATIONS; iter++) {
    const candidate = perturb(current);
    const { avgScore: candidateScore, winRate } = evaluate(candidate, GAMES_PER_EVAL);

    if (candidateScore > currentScore) {
      current = candidate;
      currentScore = candidateScore;
      improvements++;

      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestWeights = { ...current };
      }

      if (iter % LOG_INTERVAL === 0 || improvements <= 5) {
        console.log(`[${iter}/${ITERATIONS}] 改善! score=${currentScore.toFixed(2)} winRate=${(winRate * 100).toFixed(1)}% improvements=${improvements}`);
        console.log(`  weights: ${JSON.stringify(current)}`);
      }
    } else if (iter % LOG_INTERVAL === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`[${iter}/${ITERATIONS}] score=${currentScore.toFixed(2)} 改善なし (${elapsed}秒経過, 改善回数=${improvements})`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`=== 完了 (${elapsed}秒) ===`);
  console.log(`改善回数: ${improvements}/${ITERATIONS}`);
  console.log(`最終スコア: ${currentScore.toFixed(2)} (ベースライン: ${baselineEval.avgScore.toFixed(2)})`);
  console.log(`最良スコア: ${bestScore.toFixed(2)}`);
  console.log('');
  console.log('最良重み:');
  console.log(JSON.stringify(bestWeights, null, 2));

  // Save
  const output = {
    timestamp: new Date().toISOString(),
    iterations: ITERATIONS,
    gamesPerEval: GAMES_PER_EVAL,
    improvements,
    baselineAvgScore: baselineEval.avgScore,
    bestAvgScore: bestScore,
    weights: bestWeights,
  };
  writeFileSync(WEIGHTS_PATH, JSON.stringify(output, null, 2));
  console.log(`\nweights.json に保存しました: ${WEIGHTS_PATH}`);

  console.log('\n--- ai.js への反映方法 ---');
  console.log('ai.js の chooseDiscard / handValue の定数を以下に更新してください:');
  for (const [k, v] of Object.entries(bestWeights)) {
    console.log(`  ${k}: ${v}`);
  }
}

train().catch(console.error);
