// train/rl-train.mjs
// REINFORCE self-play training for Korean Mahjong AI
//
// 仕組み:
//   - Player 0: 学習中RLプレイヤー (ε-greedy探索)
//   - Player 1-3: ベースラインプレイヤー (従来ヒューリスティック)
//   - ゲーム終了後: REINFORCE更新 (advantage = score - baseline)
//   - 12時間で約60万局、数百万の学習サンプル
//
// 使い方:
//   nohup node train/rl-train.mjs > train/rl-train.log 2>&1 &

import { runGameRL }    from './rl-engine.mjs';
import {
  initWeights, makeRLPlayer, makeBaselinePlayer,
  updateWeights, saveWeights, loadWeights, generateAiPatch,
  DISC_N, PON_N,
} from './rl-ai.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir  = dirname(fileURLToPath(import.meta.url));
const SAVE_PATH = join(__dir, 'weights-rl.json');

// ============================================================
// HYPERPARAMETERS
// ============================================================
const ALPHA_DISCARD = 0.0005;  // learning rate for discard (reduced to prevent divergence)
const ALPHA_PON     = 0.001;   // learning rate for pon
const EPSILON_START = 0.25;    // exploration rate (start)
const EPSILON_END   = 0.02;    // exploration rate (end)
const EPSILON_HALF  = 200_000; // games to halve epsilon (slower decay)
const SAVE_INTERVAL = 10_000;  // games between checkpoints
const LOG_INTERVAL  =  1_000;  // games between progress logs
const EVAL_INTERVAL = 20_000;  // games between eval runs
const EVAL_GAMES    =    200;  // games per evaluation (vs baseline only)
const BASELINE_DECAY = 0.9995; // for running mean of scores

// ============================================================
// LOAD OR INIT
// ============================================================
let saved = loadWeights(SAVE_PATH);
let weights, iteration, epsilonAtSave, runningMean, runningVar;

if (saved?.weights) {
  weights      = saved.weights;
  iteration    = saved.iteration || 0;
  epsilonAtSave = saved.epsilon || EPSILON_START;
  runningMean  = saved.runningMean || 0;
  runningVar   = saved.runningVar  || 1;
  console.log(`Resumed from checkpoint: ${iteration} games`);
} else {
  weights      = initWeights();
  iteration    = 0;
  epsilonAtSave = EPSILON_START;
  runningMean  = 0;
  runningVar   = 1;
  console.log('New training run starting...');
}

// ============================================================
// UTILITIES
// ============================================================
function currentEpsilon() {
  // Exponential decay: ε(n) = EPSILON_END + (ε0 - EPSILON_END) * 0.5^(n/HALF)
  const t = iteration + (epsilonAtSave > EPSILON_START ? 0 : 0);
  const decay = Math.pow(0.5, iteration / EPSILON_HALF);
  return EPSILON_END + (epsilonAtSave - EPSILON_END) * decay;
}

// Evaluate RL player against baseline only (no exploration)
function evaluate(games = EVAL_GAMES) {
  const bp = makeBaselinePlayer();
  let wins = 0, totalScore = 0;
  for (let i = 0; i < games; i++) {
    const trace = [];
    const rlPlayer = makeRLPlayer(weights, 0, trace); // no exploration
    const result = runGameRL([rlPlayer, bp, bp, bp]);
    totalScore += result.scores[0];
    if (result.winner === 0) wins++;
  }
  return {
    avgScore: totalScore / games,
    winRate:  wins / games,
  };
}

// ============================================================
// TRAINING LOOP
// ============================================================
const baseline = makeBaselinePlayer();
const startTime = Date.now();

let totalWins = 0, totalGames = 0;
let recentScores = [];

// Running stats for reward normalization
let scoreSum = 0, scoreSum2 = 0, scoreSamples = 0;

// Best evaluation score seen so far
let bestEvalScore = -Infinity;

console.log('=== Korean Mahjong RL Training ===');
console.log(`Discard features: ${DISC_N}, Pon features: ${PON_N}`);
console.log(`Alpha_discard: ${ALPHA_DISCARD}, Alpha_pon: ${ALPHA_PON}`);
console.log(`Epsilon: ${EPSILON_START} → ${EPSILON_END} over ${EPSILON_HALF} games`);
console.log('');

// Initial evaluation
{
  const ev = evaluate();
  console.log(`[0] Baseline eval: avgScore=${ev.avgScore.toFixed(2)}, winRate=${(ev.winRate*100).toFixed(1)}%`);
  bestEvalScore = ev.avgScore;
}

while (true) {
  const epsilon = currentEpsilon();
  const trace   = [];
  const rlPlayer = makeRLPlayer(weights, epsilon, trace);

  const result = runGameRL([rlPlayer, baseline, baseline, baseline]);
  const score  = result.scores[0];

  // Update running stats
  scoreSum  += score;
  scoreSum2 += score * score;
  scoreSamples++;

  // Update running mean and variance (exponential moving average)
  const prevMean = runningMean;
  runningMean = runningMean * BASELINE_DECAY + score * (1 - BASELINE_DECAY);
  const delta = score - prevMean;
  runningVar  = runningVar  * BASELINE_DECAY + delta * delta * (1 - BASELINE_DECAY);

  recentScores.push(score);
  if (recentScores.length > 500) recentScores.shift();
  if (result.winner === 0) totalWins++;
  totalGames++;
  iteration++;

  // REINFORCE update (with std normalization)
  const runningStd = Math.sqrt(Math.max(runningVar, 0.01));
  updateWeights(weights, trace, score, runningMean, runningStd, ALPHA_DISCARD);

  // ============================================================
  // LOGGING
  // ============================================================
  if (iteration % LOG_INTERVAL === 0) {
    const elapsed = ((Date.now() - startTime) / 3600000).toFixed(2);
    const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
    const recentWin = recentScores.filter(s => s > 0).length / recentScores.length;
    const allAvg    = scoreSum / scoreSamples;
    const allStd    = Math.sqrt(scoreSum2 / scoreSamples - allAvg ** 2);

    console.log(
      `[${iteration.toLocaleString()}] ${elapsed}h | ` +
      `ε=${epsilon.toFixed(3)} | ` +
      `recent500: avg=${recentAvg.toFixed(2)} win=${(recentWin*100).toFixed(1)}% | ` +
      `all: avg=${allAvg.toFixed(2)} σ=${allStd.toFixed(2)}`
    );

    // Print current weights periodically
    if (iteration % (LOG_INTERVAL * 10) === 0) {
      console.log(`  discard_w: [${weights.discard.map(v => v.toFixed(2)).join(', ')}]`);
      console.log(`  pon_w:     [${weights.pon.map(v => v.toFixed(2)).join(', ')}]`);
    }
  }

  // ============================================================
  // PERIODIC EVALUATION (vs pure baseline, no exploration)
  // ============================================================
  if (iteration % EVAL_INTERVAL === 0) {
    const ev = evaluate();
    const tag = ev.avgScore > bestEvalScore ? ' *** NEW BEST ***' : '';
    console.log(
      `\n[EVAL ${iteration.toLocaleString()}] avgScore=${ev.avgScore.toFixed(2)}, ` +
      `winRate=${(ev.winRate*100).toFixed(1)}%${tag}\n`
    );
    if (ev.avgScore > bestEvalScore) {
      bestEvalScore = ev.avgScore;
      // Save best weights separately
      saveWeights(join(__dir, 'weights-rl-best.json'), {
        weights,
        iteration,
        evalScore: ev.avgScore,
        evalWinRate: ev.winRate,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ============================================================
  // CHECKPOINT SAVE
  // ============================================================
  if (iteration % SAVE_INTERVAL === 0) {
    saveWeights(SAVE_PATH, {
      weights,
      iteration,
      epsilon: currentEpsilon(),
      runningMean,
      runningVar,
      bestEvalScore,
      timestamp: new Date().toISOString(),
    });
  }
}
