"""
Gymnasium environment for Korean Mahjong RL training.

One "step" = one discard decision for Player 0.
Players 1-3 use the heuristic baseline AI.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import gymnasium as gym
from gymnasium import spaces
from typing import Optional

from km_engine import (
    Wall, Tile, tile_idx, tiles_to_counts,
    get_closed, get_meld_flat, do_discard,
    do_pon, do_ankan, do_shokan,
    find_shokan_tile, find_ankan_tile,
    is_winning, compute_score, apply_score, calc_shanten,
    ai_discard, ai_should_pon, ai_should_kan,
    tiles_equal, DEFAULT_WEIGHTS,
)

# ============================================================
# OBSERVATION LAYOUT  (246 dims total)
# [0:34]   closed hand tile counts  (/ 4)
# [34:68]  meld tile counts         (/ 4)
# [68:102] own discards             (/ 4)
# [102:136] opp1 discards           (/ 4)
# [136:170] opp2 discards           (/ 4)
# [170:204] opp3 discards           (/ 4)
# [204:238] doras (0/1 per tile type)
# [238]    own riichi
# [239]    opp1 riichi
# [240]    opp2 riichi
# [241]    opp3 riichi
# [242]    wall remaining (/ 122)
# [243]    shanten (/ 8, clamped 0-1)
# [244]    meld count (/ 4)
# [245]    red dora count in hand (/ 4)
# ============================================================
OBS_SIZE = 246


def _tile_counts_34(tiles) -> np.ndarray:
    c = np.zeros(34, dtype=np.float32)
    for t in tiles:
        c[tile_idx(t)] += 1
    return c


class KoreanMahjongEnv(gym.Env):
    """
    Single-player view: Player 0 is the RL agent.
    Players 1-3 use the heuristic baseline AI.

    Supports sb3-contrib MaskablePPO via action_masks().
    """

    metadata = {}

    def __init__(self, weights=None):
        super().__init__()
        self._ws = weights or [DEFAULT_WEIGHTS] * 4

        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(OBS_SIZE,), dtype=np.float32
        )
        # Action = which tile type (0-33) to discard
        self.action_space = spaces.Discrete(34)

        self._reset_state()

    # ----------------------------------------------------------
    # Gymnasium API
    # ----------------------------------------------------------

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._reset_state()
        self._gen = self._game_generator()
        self._last_obs = next(self._gen)  # advance to first P0 decision
        return self._last_obs, {}

    def step(self, action: int):
        try:
            obs = self._gen.send(int(action))
            self._last_obs = obs
            return obs, 0.0, False, False, {}
        except StopIteration as e:
            reward = float(e.value) if e.value is not None else 0.0
            return self._last_obs, reward, True, False, {}

    def action_masks(self) -> np.ndarray:
        """Return boolean mask of valid tile types to discard."""
        mask = np.zeros(34, dtype=bool)
        if self._riichi[0]:
            # In riichi: can only tsumogiri (discard drawn tile)
            if self._drawn_tile is not None:
                mask[tile_idx(self._drawn_tile)] = True
        else:
            closed = get_closed(self._hands, self._melds, 0)
            for t in closed:
                mask[tile_idx(t)] = True
        # Fallback: if somehow all False, allow everything in hand
        if not mask.any():
            closed = get_closed(self._hands, self._melds, 0)
            for t in closed:
                mask[tile_idx(t)] = True
        return mask

    # ----------------------------------------------------------
    # Internal helpers
    # ----------------------------------------------------------

    def _reset_state(self):
        self._wall: Optional[Wall] = None
        self._hands = None
        self._melds = None
        self._discards = None
        self._riichi = None
        self._scores = None
        self._drawn_tile: Optional[Tile] = None
        self._gen = None
        self._last_obs = np.zeros(OBS_SIZE, dtype=np.float32)

    def _build_obs(self) -> np.ndarray:
        obs = np.zeros(OBS_SIZE, dtype=np.float32)

        # Player 0 perspective
        closed = get_closed(self._hands, self._melds, 0)
        meld_flat = get_meld_flat(self._melds, 0)
        doras = self._wall.get_doras()

        obs[0:34]    = _tile_counts_34(closed) / 4.0
        obs[34:68]   = _tile_counts_34(meld_flat) / 4.0
        obs[68:102]  = _tile_counts_34(self._discards[0]) / 4.0
        obs[102:136] = _tile_counts_34(self._discards[1]) / 4.0
        obs[136:170] = _tile_counts_34(self._discards[2]) / 4.0
        obs[170:204] = _tile_counts_34(self._discards[3]) / 4.0

        for d in doras:
            obs[204 + tile_idx(d)] = 1.0

        obs[238] = 1.0 if self._riichi[0] else 0.0
        obs[239] = 1.0 if self._riichi[1] else 0.0
        obs[240] = 1.0 if self._riichi[2] else 0.0
        obs[241] = 1.0 if self._riichi[3] else 0.0
        obs[242] = self._wall.remaining / 122.0
        obs[243] = max(0, calc_shanten(closed, len(self._melds[0]))) / 8.0
        obs[244] = len(self._melds[0]) / 4.0
        obs[245] = sum(1 for t in closed if t.is_red) / 4.0

        return obs

    def _get_riichi_discards(self, exclude: int):
        return [self._discards[i] for i in range(4) if i != exclude and self._riichi[i]]

    def _resolve_discard(self, from_p: int, tile: Tile):
        """Handle ron / pon / kan after a discard. Returns result dict."""
        priority = [(from_p + n) % 4 for n in range(1, 4)]

        # Ron check
        for p in priority:
            mc = len(self._melds[p])
            if is_winning(self._hands[p] + [tile], mc):
                self._hands[p].append(tile)
                total = compute_score(
                    self._hands[p], 'ron', self._riichi[p],
                    self._wall.get_doras(),
                    self._wall.get_ura_doras() if self._riichi[p] else []
                )
                apply_score(self._scores, total, 'ron', p, from_p)
                return {'done': True}

        # Pon / Minkan check (heuristic for all players)
        for p in priority:
            if self._riichi[p]:
                continue
            closed = get_closed(self._hands, self._melds, p)
            same = sum(1 for t in closed if tiles_equal(t, tile))
            mc = len(self._melds[p])

            if same >= 3 and self._wall.kan_count < 4 and ai_should_kan(closed, tile, mc):
                do_pon(self._hands, self._melds, self._discards, p, from_p, tile, 'minkan')
                supp = self._wall.draw_kan()
                if supp:
                    self._hands[p].append(supp)
                mc_after = len(self._melds[p])
                if is_winning(self._hands[p], mc_after):
                    total = compute_score(self._hands[p], 'tsumo', self._riichi[p],
                                          self._wall.get_doras(), [])
                    apply_score(self._scores, total, 'tsumo', p, None)
                    return {'done': True}
                d = ai_discard(self._hands[p], get_meld_flat(self._melds, p),
                               self._wall.get_doras(), mc_after,
                               self._get_riichi_discards(p), self._ws[p])
                do_discard(self._hands, self._discards, p, d)
                return self._resolve_discard(p, d)

            if same >= 2 and ai_should_pon(closed, tile, mc):
                do_pon(self._hands, self._melds, self._discards, p, from_p, tile, 'pon')
                mc_after = len(self._melds[p])
                d = ai_discard(self._hands[p], get_meld_flat(self._melds, p),
                               self._wall.get_doras(), mc_after,
                               self._get_riichi_discards(p), self._ws[p])
                do_discard(self._hands, self._discards, p, d)
                return self._resolve_discard(p, d)

        return {'done': False, 'next_player': (from_p + 1) % 4}

    def _play_cpu_turn(self, p: int):
        """Execute one CPU player's full turn. Returns result dict or None (wall empty)."""
        tile = self._wall.draw()
        if tile is None:
            return None
        self._hands[p].append(tile)
        mc = len(self._melds[p])

        # Tsumo check
        if is_winning(self._hands[p], mc):
            total = compute_score(
                self._hands[p], 'tsumo', self._riichi[p],
                self._wall.get_doras(),
                self._wall.get_ura_doras() if self._riichi[p] else []
            )
            apply_score(self._scores, total, 'tsumo', p, None)
            return {'done': True}

        # Kan actions
        if not self._riichi[p] and self._wall.kan_count < 4:
            st = find_shokan_tile(self._hands, self._melds, p)
            if st and ai_should_kan(get_closed(self._hands, self._melds, p), st, mc):
                do_shokan(self._hands, self._melds, self._wall, p, st)
                mc = len(self._melds[p])
                if is_winning(self._hands[p], mc):
                    total = compute_score(self._hands[p], 'tsumo', self._riichi[p],
                                          self._wall.get_doras(), [])
                    apply_score(self._scores, total, 'tsumo', p, None)
                    return {'done': True}
            if self._wall.kan_count < 4:
                at = find_ankan_tile(self._hands, self._melds, p)
                if at and ai_should_kan(get_closed(self._hands, self._melds, p), at, mc):
                    do_ankan(self._hands, self._melds, self._wall, p, at)
                    mc = len(self._melds[p])
                    if is_winning(self._hands[p], mc):
                        total = compute_score(self._hands[p], 'tsumo', self._riichi[p],
                                              self._wall.get_doras(), [])
                        apply_score(self._scores, total, 'tsumo', p, None)
                        return {'done': True}

        # Riichi
        if not self._riichi[p] and len(self._melds[p]) == 0:
            closed = get_closed(self._hands, self._melds, p)
            if calc_shanten(closed, 0) == 0:
                self._riichi[p] = True

        # Discard
        if self._riichi[p]:
            discard_tile = tile  # tsumogiri
        else:
            discard_tile = ai_discard(
                self._hands[p], get_meld_flat(self._melds, p), self._wall.get_doras(),
                mc, self._get_riichi_discards(p), self._ws[p]
            )
        do_discard(self._hands, self._discards, p, discard_tile)
        return {'done': False, 'discard': discard_tile, 'from': p}

    def _game_generator(self):
        """
        Generator that yields obs when P0 needs to discard.
        Receives P0's action via send().
        Returns final normalized reward on game end.
        """
        self._wall = Wall()
        self._hands = self._wall.deal(4)
        self._melds = [[] for _ in range(4)]
        self._discards = [[] for _ in range(4)]
        self._riichi = [False] * 4
        self._scores = [0] * 4
        self._drawn_tile = None

        current_player = 0

        for _ in range(300):  # safety limit
            if current_player == 0:
                # --- Player 0's turn ---
                tile = self._wall.draw()
                if tile is None:
                    return 0.0  # draw

                self._hands[0].append(tile)
                self._drawn_tile = tile
                mc = len(self._melds[0])

                # Tsumo check
                if is_winning(self._hands[0], mc):
                    total = compute_score(
                        self._hands[0], 'tsumo', self._riichi[0],
                        self._wall.get_doras(),
                        self._wall.get_ura_doras() if self._riichi[0] else []
                    )
                    apply_score(self._scores, total, 'tsumo', 0, None)
                    return self._scores[0] / 20.0

                # Kan (heuristic)
                if not self._riichi[0] and self._wall.kan_count < 4:
                    st = find_shokan_tile(self._hands, self._melds, 0)
                    if st and ai_should_kan(get_closed(self._hands, self._melds, 0), st, mc):
                        do_shokan(self._hands, self._melds, self._wall, 0, st)
                        mc = len(self._melds[0])
                        if is_winning(self._hands[0], mc):
                            total = compute_score(self._hands[0], 'tsumo', self._riichi[0],
                                                  self._wall.get_doras(), [])
                            apply_score(self._scores, total, 'tsumo', 0, None)
                            return self._scores[0] / 20.0
                    if self._wall.kan_count < 4:
                        at = find_ankan_tile(self._hands, self._melds, 0)
                        if at and ai_should_kan(get_closed(self._hands, self._melds, 0), at, mc):
                            do_ankan(self._hands, self._melds, self._wall, 0, at)
                            mc = len(self._melds[0])
                            if is_winning(self._hands[0], mc):
                                total = compute_score(self._hands[0], 'tsumo', self._riichi[0],
                                                      self._wall.get_doras(), [])
                                apply_score(self._scores, total, 'tsumo', 0, None)
                                return self._scores[0] / 20.0

                # Riichi (auto)
                if not self._riichi[0] and len(self._melds[0]) == 0:
                    closed = get_closed(self._hands, self._melds, 0)
                    if calc_shanten(closed, 0) == 0:
                        self._riichi[0] = True

                # Yield obs to get action from RL agent
                obs = self._build_obs()
                action = yield obs

                # Apply P0's discard
                mc_now = len(self._melds[0])
                if self._riichi[0]:
                    discard_tile = self._drawn_tile
                else:
                    closed = get_closed(self._hands, self._melds, 0)
                    discard_tile = next(
                        (t for t in closed if tile_idx(t) == int(action)),
                        closed[0]
                    )
                do_discard(self._hands, self._discards, 0, discard_tile)

            else:
                # --- CPU player's turn ---
                result = self._play_cpu_turn(current_player)
                if result is None:
                    return 0.0  # wall empty
                if result.get('done'):
                    return self._scores[0] / 20.0
                discard_tile = result['discard']
                from_p = result['from']
                # Resolve P0 pon opportunity (heuristic for now)
                claim = self._resolve_discard(from_p, discard_tile)
                if claim['done']:
                    return self._scores[0] / 20.0
                current_player = claim['next_player']
                continue

            # Resolve P0's discard
            claim = self._resolve_discard(0, discard_tile)
            if claim['done']:
                return self._scores[0] / 20.0
            current_player = claim['next_player']

        return 0.0  # safety fallback


if __name__ == '__main__':
    import time
    from sb3_contrib import MaskablePPO
    from sb3_contrib.common.wrappers import ActionMasker

    def mask_fn(env):
        return env.action_masks()

    env = ActionMasker(KoreanMahjongEnv(), mask_fn)

    # Sanity check: run a few episodes manually
    print("Testing env manually...")
    raw_env = KoreanMahjongEnv()
    total_reward = 0.0
    t0 = time.time()
    N = 200
    for _ in range(N):
        obs, _ = raw_env.reset()
        done = False
        ep_reward = 0.0
        while not done:
            mask = raw_env.action_masks()
            valid = np.where(mask)[0]
            action = np.random.choice(valid)
            obs, reward, done, _, _ = raw_env.step(action)
            ep_reward += reward
        total_reward += ep_reward
    elapsed = time.time() - t0
    print(f"{N} episodes (random policy): {elapsed:.2f}s ({N/elapsed:.0f} eps/s)")
    print(f"Avg reward: {total_reward/N:.3f}")
