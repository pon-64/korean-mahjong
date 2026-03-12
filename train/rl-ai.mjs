// train/rl-ai.mjs
// RL AI: linear function approximation + REINFORCE
//
// 学習対象の決定:
//   1. 打牌: どの牌を捨てるか  (12特徴量の線形モデル)
//   2. ポン: ポンするか否か    ( 7特徴量の線形モデル)
//
// 更新則 (REINFORCE with baseline):
//   w += α * (score - baseline) * features   (打牌: 選んだ牌の特徴)
//   w += α * (score - baseline) * features * (pon ? +1 : -1)  (ポン: 選択方向)

import { calcShanten, countEffective, tilesEqual, aiShouldKan } from './engine.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ============================================================
// FEATURE DIMENSIONS
// ============================================================
export const DISC_N = 12;  // discard features
export const PON_N  = 7;   // pon features

// ============================================================
// DISCARD FEATURES
// Represents the hand STATE after discarding a candidate tile.
// All features normalized to roughly [0, 1] or [-1, 1].
// ============================================================
//
// f[0]  shanten / 8            : 向聴数 (0=テンパイ, 1=8向聴)
// f[1]  effTiles / 34          : 有効牌数
// f[2]  isTenpai               : テンパイ=1
// f[3]  doraInHand / 12        : 残り手牌のドラ数
// f[4]  redInHand              : 残り赤ドラ数 (0-4)
// f[5]  wallRemaining / 100    : 残り牌山 (均等化)
// f[6]  riichiOpp / 3          : リーチ中の相手数
// f[7]  discIsHonor            : 捨て牌=字牌
// f[8]  discIsTerminal         : 捨て牌=端牌(1,9)
// f[9]  discIsDora             : 捨て牌=ドラ
// f[10] discIsRed              : 捨て牌=赤ドラ
// f[11] discIsSafe             : 捨て牌=現物(安全牌)

export function discardFeatures(hand13, meldCount, doras, riichiDiscards, wallRemaining, discardedTile) {
  const sh  = calcShanten(hand13, meldCount);
  const eff = sh >= 0 ? countEffective(hand13, meldCount) : 0;
  const tenpai = sh === 0 ? 1 : 0;

  let doraInHand = 0, redInHand = 0;
  for (const t of hand13) {
    if (t.isRed) redInHand++;
    for (const d of doras) if (tilesEqual(t, d)) doraInHand++;
  }

  const safeKeys = new Set();
  for (const ds of riichiDiscards) for (const t of ds) safeKeys.add(t.suit + t.num);

  const f = new Float64Array(DISC_N);
  f[0]  = Math.max(0, sh) / 8;
  f[1]  = eff / 34;
  f[2]  = tenpai;
  f[3]  = doraInHand / 12;
  f[4]  = redInHand / 4;
  f[5]  = Math.min(wallRemaining, 100) / 100;
  f[6]  = riichiDiscards.length / 3;
  f[7]  = discardedTile.suit === 'z' ? 1 : 0;
  f[8]  = (discardedTile.num === 1 || discardedTile.num === 9) && discardedTile.suit !== 'z' ? 1 : 0;
  f[9]  = doras.some(d => tilesEqual(d, discardedTile)) ? 1 : 0;
  f[10] = discardedTile.isRed ? 1 : 0;
  f[11] = safeKeys.has(discardedTile.suit + discardedTile.num) ? 1 : 0;
  return f;
}

// ============================================================
// PON FEATURES
// Represents the scenario of considering a pon.
// ============================================================
//
// g[0]  shantenAfterPon / 8    : ポン後のベスト向聴数
// g[1]  shantenBefore / 8      : ポン前の向聴数
// g[2]  shantenGain            : g[1]-g[0] (正=改善)
// g[3]  tenpaiAfterPon         : ポン後テンパイ=1
// g[4]  wallRemaining / 100    : 残り牌山
// g[5]  riichiOpp / 3          : リーチ中の相手数
// g[6]  loseRiichiOption       : 副露後にリーチ不可=1

export function ponFeatures(closed13, ponTile, meldCount, wallRemaining, riichiOppCount) {
  const shBefore = calcShanten(closed13, meldCount);

  // Simulate pon: remove 2 matching tiles, try all discards
  const after = [];
  let removed = 0;
  for (const t of closed13) {
    if (removed < 2 && tilesEqual(t, ponTile)) { removed++; continue; }
    after.push(t);
  }
  if (removed < 2) return null;

  const mc2 = meldCount + 1;
  let bestSh = Infinity;
  for (let i = 0; i < after.length; i++) {
    const rest = after.filter((_, j) => j !== i);
    const s = calcShanten(rest, mc2);
    if (s < bestSh) bestSh = s;
  }

  const g = new Float64Array(PON_N);
  g[0] = Math.max(0, bestSh) / 8;
  g[1] = Math.max(0, shBefore) / 8;
  g[2] = (shBefore - bestSh) / 8;  // gain (positive = better)
  g[3] = bestSh === 0 ? 1 : 0;
  g[4] = Math.min(wallRemaining, 100) / 100;
  g[5] = riichiOppCount / 3;
  g[6] = 1; // ponning always loses riichi option (closed hand assumed)
  return g;
}

// ============================================================
// LINEAR MODEL
// ============================================================

function dot(w, f) {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * f[i];
  return s;
}

// ============================================================
// INITIAL WEIGHTS (domain knowledge priors)
// ============================================================
export function initWeights() {
  // Discard weights: shanten is most important (negative = prefer lower shanten)
  // others start near 0 so the model can discover them
  const discard = new Float64Array(DISC_N);
  discard[0] = -10.0;  // shanten: strong penalty for high shanten
  discard[1] =  3.0;   // effective tiles: prefer many
  discard[2] =  5.0;   // tenpai bonus
  discard[3] =  2.0;   // keep dora
  discard[4] =  3.0;   // keep red dora
  // f[5..11]: start at 0, let RL discover importance

  // Pon weights: start at 0 (RL discovers when to pon)
  const pon = new Float64Array(PON_N);
  pon[2] = 2.0;  // shanten gain: slight prior that gaining shanten is good
  pon[3] = 5.0;  // tenpai after pon: meaningful prior

  return { discard: Array.from(discard), pon: Array.from(pon) };
}

// ============================================================
// RL PLAYER FACTORY
// Creates a player object that:
//   - uses current weights to make decisions
//   - logs decisions+features to the provided trace array
//   - uses ε-greedy exploration
// ============================================================
export function makeRLPlayer(weights, epsilon, trace) {
  return {
    discard(hand, meldFlat, doras, meldCount, riichiDiscards, wallRemaining) {
      const meldIds = new Set(meldFlat.map(t => t.id));
      const closed  = hand.filter(t => !meldIds.has(t.id));

      // Evaluate each candidate discard
      const candidates = closed.map((tile, i) => {
        const rest = closed.filter((_, j) => j !== i);
        const f    = discardFeatures(rest, meldCount, doras, riichiDiscards, wallRemaining, tile);
        const score = dot(weights.discard, f);
        return { tile, features: f, score };
      });

      if (!candidates.length) return closed[0];

      // ε-greedy: explore with probability epsilon
      let chosen;
      if (Math.random() < epsilon) {
        chosen = candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        chosen = candidates.reduce((best, c) => c.score > best.score ? c : best);
      }

      trace.push({ type: 'discard', features: chosen.features });
      return chosen.tile;
    },

    pon(closed, ponTile, meldCount, wallRemaining, riichiOppCount) {
      const f = ponFeatures(closed, ponTile, meldCount, wallRemaining, riichiOppCount);
      if (!f) return false;

      const score = dot(weights.pon, f);

      // ε-greedy for pon too
      let decision;
      if (Math.random() < epsilon) {
        decision = Math.random() < 0.5;
      } else {
        decision = score > 0;
      }

      trace.push({ type: 'pon', features: f, decision });
      return decision;
    },
  };
}

// Baseline player (uses existing heuristic AI from engine)
import { aiDiscard, aiShouldPon, DEFAULT_WEIGHTS } from './engine.mjs';
export function makeBaselinePlayer() {
  return {
    discard: (hand, meldFlat, doras, meldCount, riichiDiscards) =>
      aiDiscard(hand, meldFlat, doras, meldCount, riichiDiscards, DEFAULT_WEIGHTS),
    pon: (closed, ponTile, meldCount) =>
      aiShouldPon(closed, ponTile, meldCount),
  };
}

// ============================================================
// WEIGHT UPDATE (REINFORCE with baseline + fixes)
// ============================================================
const MAX_WEIGHT   = 50;   // weight clamp (prevent divergence)
const MAX_GRAD_NORM = 2.0; // max per-game gradient L2 norm

export function updateWeights(weights, trace, score, baseline, std, alpha) {
  const rawAdv  = score - baseline;
  const advantage = rawAdv / Math.max(std, 0.5); // normalize by std
  if (Math.abs(advantage) < 1e-6) return;

  // Accumulate gradient over the whole game first
  const discGrad = new Float64Array(weights.discard.length);
  const ponGrad  = new Float64Array(weights.pon.length);

  for (const entry of trace) {
    if (entry.type === 'discard') {
      const f = entry.features;
      for (let i = 0; i < discGrad.length; i++) discGrad[i] += advantage * f[i];
    } else if (entry.type === 'pon') {
      const f = entry.features;
      const dir = entry.decision ? 1 : -1;
      for (let i = 0; i < ponGrad.length; i++) ponGrad[i] += advantage * dir * f[i];
    }
  }

  // Gradient clipping by L2 norm
  let norm = 0;
  for (const g of discGrad) norm += g * g;
  for (const g of ponGrad)  norm += g * g;
  norm = Math.sqrt(norm);
  const scale = norm > MAX_GRAD_NORM ? MAX_GRAD_NORM / norm : 1;

  // Apply update with weight clamping
  for (let i = 0; i < weights.discard.length; i++) {
    weights.discard[i] += alpha * discGrad[i] * scale;
    weights.discard[i] = Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, weights.discard[i]));
  }
  for (let i = 0; i < weights.pon.length; i++) {
    weights.pon[i] += alpha * ponGrad[i] * scale;
    weights.pon[i] = Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, weights.pon[i]));
  }
}

// ============================================================
// SAVE / LOAD
// ============================================================
export function saveWeights(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function loadWeights(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ============================================================
// GENERATE ai.js PATCH
// Converts learned weights back into ai.js-compatible heuristic code
// ============================================================
export function generateAiPatch(weights) {
  const w = weights.discard;
  // Map learned weights to the constants in ai.js
  // The model: score = w[0]*shanten/8 + w[1]*eff/34 + w[2]*tenpai + w[3]*doraInHand/12 + ...
  // Rescale to match ai.js scale:
  //   shantenPenalty ≈ -w[0] * (some scale)
  //   effectiveBonus ≈  w[1] * (some scale)
  //   doraPenalty for discarding = -w[9] (discIsDora in feature is negative of "keep")
  //   safeBOnus = w[11]
  // These are approximate; the exact mapping is non-trivial.

  return {
    shantenPenalty: Math.max(10, Math.round(-w[0] * 8 * 1.5)),
    tenpaiBonus:    Math.max(50, Math.round(w[2] * 8 * 25)),
    effectiveBonus: Math.max(0.1, Math.round(w[1] * 34 * 3) / 10),
    doraPenalty:    Math.max(0, Math.round(-w[9] * 12)),
    redDoraPenalty: Math.max(0, Math.round(-w[10] * 12)),
    safeBonus:      Math.max(0, Math.round(w[11] * 50)),
  };
}
