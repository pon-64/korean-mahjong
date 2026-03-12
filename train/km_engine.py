"""
Korean Mahjong headless game engine (Python)
Paradise City v8.9 rules

Direct port of train/engine.mjs
"""
import random
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from km_shanten import calc_shanten_numba, warmup as _warmup, KOKUSHI_IDX

# Warm up numba JIT on import
_warmup()

# ============================================================
# TILE
# ============================================================

@dataclass
class Tile:
    id: int
    suit: str   # 'm', 'p', 's', 'z'
    num: int    # 1-9 for mps, 1-7 for z
    is_red: bool = False

    def __repr__(self):
        r = '★' if self.is_red else ''
        return f"{self.num}{self.suit}{r}"

def create_tile_set() -> List[Tile]:
    tiles = []
    tid = 0
    for suit in ['m', 'p', 's']:
        for num in range(1, 10):
            for _ in range(4):
                tiles.append(Tile(id=tid, suit=suit, num=num, is_red=(num == 5)))
                tid += 1
    for num in range(1, 8):
        for _ in range(4):
            tiles.append(Tile(id=tid, suit='z', num=num))
            tid += 1
    return tiles  # 136 tiles

def tiles_equal(a: Tile, b: Tile) -> bool:
    return a.suit == b.suit and a.num == b.num

def get_dora_from_indicator(ind: Tile) -> Tile:
    if ind.suit == 'z':
        if ind.num <= 4:
            return Tile(-1, 'z', 1 if ind.num == 4 else ind.num + 1)
        return Tile(-1, 'z', 5 if ind.num == 7 else ind.num + 1)
    return Tile(-1, ind.suit, 1 if ind.num == 9 else ind.num + 1)

def tile_idx(t: Tile) -> int:
    if t.suit == 'm': return t.num - 1
    if t.suit == 'p': return 9 + t.num - 1
    if t.suit == 's': return 18 + t.num - 1
    return 27 + t.num - 1

def idx_to_tile(i: int) -> Tile:
    if i < 9:   return Tile(-1000 - i, 'm', i + 1)
    if i < 18:  return Tile(-1000 - i, 'p', i - 9 + 1)
    if i < 27:  return Tile(-1000 - i, 's', i - 18 + 1)
    return Tile(-1000 - i, 'z', i - 27 + 1)

def tiles_to_counts(tiles: List[Tile]) -> np.ndarray:
    c = np.zeros(34, dtype=np.int64)
    for t in tiles:
        c[tile_idx(t)] += 1
    return c

# ============================================================
# WALL
# ============================================================

@dataclass
class Wall:
    tiles: List[Tile] = field(default_factory=list)
    dead_wall: List[Tile] = field(default_factory=list)
    draw_index: int = 0
    kan_count: int = 0
    kan_draw_index: int = 0

    def __post_init__(self):
        all_tiles = create_tile_set()
        random.shuffle(all_tiles)
        self.dead_wall = all_tiles[-14:]
        self.tiles = all_tiles[:-14]  # 122 tiles
        self._kan_draw_tiles = self.dead_wall[4:8]

    @property
    def remaining(self) -> int:
        return len(self.tiles) - self.draw_index

    def draw(self) -> Optional[Tile]:
        if self.draw_index < len(self.tiles):
            t = self.tiles[self.draw_index]
            self.draw_index += 1
            return t
        return None

    def draw_kan(self) -> Optional[Tile]:
        if self.kan_count >= 4 or self.kan_draw_index >= len(self._kan_draw_tiles):
            return None
        self.kan_count += 1
        t = self._kan_draw_tiles[self.kan_draw_index]
        self.kan_draw_index += 1
        return t

    def get_doras(self) -> List[Tile]:
        return [get_dora_from_indicator(self.dead_wall[0]),
                get_dora_from_indicator(self.dead_wall[1])]

    def get_ura_doras(self) -> List[Tile]:
        return [get_dora_from_indicator(self.dead_wall[2]),
                get_dora_from_indicator(self.dead_wall[3])]

    def deal(self, n: int = 4) -> List[List[Tile]]:
        hands = [[] for _ in range(n)]
        for _ in range(13):
            for p in range(n):
                t = self.draw()
                if t:
                    hands[p].append(t)
        return hands

# ============================================================
# SHANTEN (numba-accelerated via km_shanten.py)
# ============================================================

def calc_shanten(tiles: List[Tile], meld_count: int = 0) -> int:
    if not tiles:
        return 8
    c = tiles_to_counts(tiles)
    return int(calc_shanten_numba(c, meld_count))

def is_winning(tiles: List[Tile], meld_count: int = 0) -> bool:
    return calc_shanten(tiles, meld_count) == -1

def get_win_form(tiles: List[Tile]) -> str:
    c = tiles_to_counts(tiles)
    # Kokushi check
    kinds = sum(1 for i in KOKUSHI_IDX if c[i] >= 1)
    has_pair = any(c[i] >= 2 for i in KOKUSHI_IDX)
    if 13 - kinds - (1 if has_pair else 0) == -1:
        return 'kokushi'
    # Korean chiitoi: 4-of-a-kind = 2 pairs
    pairs = sum(x // 2 for x in c)
    if 6 - min(pairs, 7) == -1:
        return 'chiitoi'
    return 'normal'

def count_effective(tiles: List[Tile], meld_count: int) -> int:
    sh = calc_shanten(tiles, meld_count)
    if sh < 0:
        return 0
    count = 0
    for i in range(34):
        if calc_shanten(tiles + [idx_to_tile(i)], meld_count) < sh:
            count += 1
    return count

# ============================================================
# SCORING (Paradise City rules, cap=20)
# ============================================================

CAP = 20

def compute_score(hand: List[Tile], win_type: str, is_riichi: bool,
                  doras: List[Tile], ura_doras: List[Tile]) -> int:
    if get_win_form(hand) == 'kokushi':
        return 20
    base = 6 if win_type == 'ron' else 2
    riichi_pt = 2 if is_riichi else 0
    red = omote = ura = 0
    for t in hand:
        if t.is_red:
            red += 1
        for d in doras:
            if tiles_equal(t, d):
                omote += 1
        if is_riichi:
            for d in ura_doras:
                if tiles_equal(t, d):
                    ura += 1
    return base + riichi_pt + red + omote + ura

def apply_score(scores: List[int], total: int, win_type: str, winner: int, from_player: Optional[int]):
    if win_type == 'ron':
        pay = min(total, CAP)
        scores[from_player] -= pay
        scores[winner] += pay
    else:  # tsumo
        each = min(total, CAP)
        for i in range(4):
            if i != winner:
                scores[i] -= each
                scores[winner] += each

# ============================================================
# AI — heuristic baseline
# ============================================================

DEFAULT_WEIGHTS = {
    'shanten_penalty': 100,
    'tenpai_bonus':    200,
    'effective_bonus':   1,
    'red_dora_penalty': 15,
    'dora_penalty':     10,
    'safe_bonus':       25,
}

def eval_hand(tiles: List[Tile], meld_count: int, w: Dict) -> float:
    """Fast hand evaluation using shanten only (no effective tiles count)."""
    sh = calc_shanten(tiles, meld_count)
    if sh < 0:
        return 99999
    if sh == 0:
        return w['tenpai_bonus']
    return -(sh * w['shanten_penalty'])

def _isolation(tile: Tile, hand: List[Tile]) -> int:
    if tile.suit == 'z':
        return 5
    s = 2 if tile.num in (1, 9) else 0
    has_neighbor = any(
        t is not tile and t.suit == tile.suit and abs(t.num - tile.num) <= 2
        for t in hand
    )
    if not has_neighbor:
        s += 3
    return s

def ai_discard(hand: List[Tile], meld_flat: List[Tile], doras: List[Tile],
               meld_count: int, riichi_discard_sets: List[List[Tile]], w: Dict) -> Tile:
    meld_ids = {t.id for t in meld_flat}
    closed = [t for t in hand if t.id not in meld_ids]

    safe_keys = set()
    for ds in riichi_discard_sets:
        for t in ds:
            safe_keys.add((t.suit, t.num))
    under_attack = len(riichi_discard_sets) > 0

    best = float('-inf')
    cands = []

    for i, tile in enumerate(closed):
        rest = [t for j, t in enumerate(closed) if j != i]
        score = eval_hand(rest, meld_count, w)

        if tile.is_red:
            score -= w['red_dora_penalty']
        elif any(tiles_equal(tile, d) for d in doras):
            score -= w['dora_penalty']
        if under_attack and (tile.suit, tile.num) in safe_keys:
            score += w['safe_bonus']

        if score > best:
            best = score
            cands = [tile]
        elif score == best:
            cands.append(tile)

    if len(cands) == 1:
        return cands[0]
    return max(cands, key=lambda t: _isolation(t, closed))

def ai_should_pon(closed: List[Tile], tile: Tile, meld_count: int) -> bool:
    sh = calc_shanten(closed, meld_count)
    after = []
    removed = 0
    for t in closed:
        if removed < 2 and tiles_equal(t, tile):
            removed += 1
            continue
        after.append(t)
    if removed < 2:
        return False
    mc2 = meld_count + 1
    best_sh = min(
        calc_shanten([t for j, t in enumerate(after) if j != i], mc2)
        for i in range(len(after))
    ) if after else 8
    return best_sh < sh or best_sh == 0

def ai_should_kan(closed: List[Tile], tile: Tile, meld_count: int) -> bool:
    sh = calc_shanten(closed, meld_count)
    after = [t for t in closed if not tiles_equal(t, tile)]
    return calc_shanten(after, meld_count + 1) <= sh

# ============================================================
# GAME STATE HELPERS
# ============================================================

def get_meld_flat(melds: List[List[Dict]], p: int) -> List[Tile]:
    return [t for m in melds[p] for t in m['tiles']]

def get_closed(hands: List[List[Tile]], melds: List[List[Dict]], p: int) -> List[Tile]:
    ids = {t.id for t in get_meld_flat(melds, p)}
    return [t for t in hands[p] if t.id not in ids]

def do_discard(hands: List[List[Tile]], discards: List[List[Tile]], p: int, tile: Tile):
    for i, t in enumerate(hands[p]):
        if t.id == tile.id:
            hands[p].pop(i)
            break
    discards[p].append(tile)

def do_ankan(hands, melds, wall, p, tile):
    closed = get_closed(hands, melds, p)
    tiles4 = [t for t in closed if tiles_equal(t, tile)]
    for t in tiles4:
        for i, ht in enumerate(hands[p]):
            if ht.id == t.id:
                hands[p].pop(i)
                break
    melds[p].append({'type': 'ankan', 'tiles': tiles4, 'from': p})
    supp = wall.draw_kan()
    if supp:
        hands[p].append(supp)
    return supp

def do_shokan(hands, melds, wall, p, tile):
    mi = next((i for i, m in enumerate(melds[p])
               if m['type'] == 'pon' and tiles_equal(m['tiles'][0], tile)), None)
    if mi is None:
        return None
    hi = next((i for i, t in enumerate(hands[p]) if t.id == tile.id), None)
    if hi is None:
        return None
    hands[p].pop(hi)
    old = melds[p][mi]
    melds[p][mi] = {**old, 'type': 'shokan', 'tiles': old['tiles'] + [tile]}
    supp = wall.draw_kan()
    if supp:
        hands[p].append(supp)
    return supp

def do_pon(hands, melds, discards, p, from_p, tile, meld_type):
    for i in range(len(discards[from_p]) - 1, -1, -1):
        if discards[from_p][i].id == tile.id:
            discards[from_p].pop(i)
            break
    needed = 3 if meld_type == 'minkan' else 2
    meld_ids = {t.id for t in get_meld_flat(melds, p)}
    removed = 0
    taken = []
    for i in range(len(hands[p]) - 1, -1, -1):
        if removed >= needed:
            break
        t = hands[p][i]
        if t.id not in meld_ids and tiles_equal(t, tile):
            taken.append(t)
            hands[p].pop(i)
            removed += 1
    melds[p].append({'type': meld_type, 'tiles': taken + [tile], 'from': from_p})

def find_shokan_tile(hands, melds, p) -> Optional[Tile]:
    closed = get_closed(hands, melds, p)
    for m in melds[p]:
        if m['type'] != 'pon':
            continue
        match = next((t for t in closed if tiles_equal(t, m['tiles'][0])), None)
        if match:
            return match
    return None

def find_ankan_tile(hands, melds, p) -> Optional[Tile]:
    closed = get_closed(hands, melds, p)
    cnt: Dict[str, int] = {}
    for t in closed:
        k = f"{t.suit}{t.num}"
        cnt[k] = cnt.get(k, 0) + 1
    for k, n in cnt.items():
        if n >= 4:
            return next(t for t in closed if f"{t.suit}{t.num}" == k)
    return None

# ============================================================
# MAIN GAME LOOP
# ============================================================

def run_game(weights=None) -> Dict:
    """
    Run one complete game of 4-player Korean Mahjong.
    weights: list of 4 weight dicts, or None for all DEFAULT_WEIGHTS.
    Returns: {'winner': int (-1=draw), 'win_type': str, 'scores': list}
    """
    ws = weights or [DEFAULT_WEIGHTS] * 4

    wall = Wall()
    hands = wall.deal(4)
    melds = [[] for _ in range(4)]
    discards = [[] for _ in range(4)]
    riichi = [False] * 4
    scores = [0] * 4

    def get_riichi_discards(exclude):
        return [discards[i] for i in range(4) if i != exclude and riichi[i]]

    def resolve_discard(from_p, tile):
        priority = [(from_p + n) % 4 for n in range(1, 4)]

        # Ron check
        for p in priority:
            mc = len(melds[p])
            if is_winning(hands[p] + [tile], mc):
                hands[p].append(tile)
                total = compute_score(
                    hands[p], 'ron', riichi[p],
                    wall.get_doras(),
                    wall.get_ura_doras() if riichi[p] else []
                )
                apply_score(scores, total, 'ron', p, from_p)
                return {'done': True, 'winner': p, 'win_type': 'ron'}

        # Pon / Minkan check
        for p in priority:
            if riichi[p]:
                continue
            closed = get_closed(hands, melds, p)
            same = sum(1 for t in closed if tiles_equal(t, tile))
            mc = len(melds[p])

            if same >= 3 and wall.kan_count < 4 and ai_should_kan(closed, tile, mc):
                do_pon(hands, melds, discards, p, from_p, tile, 'minkan')
                supp = wall.draw_kan()
                if supp:
                    hands[p].append(supp)
                mc_after = len(melds[p])
                if is_winning(hands[p], mc_after):
                    total = compute_score(hands[p], 'tsumo', riichi[p], wall.get_doras(), [])
                    apply_score(scores, total, 'tsumo', p, None)
                    return {'done': True, 'winner': p, 'win_type': 'tsumo'}
                d = ai_discard(hands[p], get_meld_flat(melds, p), wall.get_doras(),
                               mc_after, get_riichi_discards(p), ws[p])
                do_discard(hands, discards, p, d)
                return resolve_discard(p, d)

            if same >= 2 and ai_should_pon(closed, tile, mc):
                do_pon(hands, melds, discards, p, from_p, tile, 'pon')
                mc_after = len(melds[p])
                d = ai_discard(hands[p], get_meld_flat(melds, p), wall.get_doras(),
                               mc_after, get_riichi_discards(p), ws[p])
                do_discard(hands, discards, p, d)
                return resolve_discard(p, d)

        return {'done': False, 'next_player': (from_p + 1) % 4}

    def play_turn(p):
        tile = wall.draw()
        if tile is None:
            return None  # wall empty

        hands[p].append(tile)
        drawn_tile = tile
        mc = len(melds[p])

        # Tsumo check
        if is_winning(hands[p], mc):
            total = compute_score(
                hands[p], 'tsumo', riichi[p],
                wall.get_doras(),
                wall.get_ura_doras() if riichi[p] else []
            )
            apply_score(scores, total, 'tsumo', p, None)
            return {'done': True, 'winner': p, 'win_type': 'tsumo'}

        # Kan actions (skip if riichi)
        if not riichi[p] and wall.kan_count < 4:
            shokan_tile = find_shokan_tile(hands, melds, p)
            if shokan_tile:
                closed = get_closed(hands, melds, p)
                if ai_should_kan(closed, shokan_tile, mc):
                    do_shokan(hands, melds, wall, p, shokan_tile)
                    mc_after = len(melds[p])
                    if is_winning(hands[p], mc_after):
                        total = compute_score(hands[p], 'tsumo', riichi[p], wall.get_doras(), [])
                        apply_score(scores, total, 'tsumo', p, None)
                        return {'done': True, 'winner': p, 'win_type': 'tsumo'}

            if wall.kan_count < 4:
                ankan_tile = find_ankan_tile(hands, melds, p)
                if ankan_tile:
                    closed = get_closed(hands, melds, p)
                    if ai_should_kan(closed, ankan_tile, mc):
                        do_ankan(hands, melds, wall, p, ankan_tile)
                        mc_after = len(melds[p])
                        if is_winning(hands[p], mc_after):
                            total = compute_score(hands[p], 'tsumo', riichi[p], wall.get_doras(), [])
                            apply_score(scores, total, 'tsumo', p, None)
                            return {'done': True, 'winner': p, 'win_type': 'tsumo'}

        # Riichi declaration
        if not riichi[p] and len(melds[p]) == 0:
            closed = get_closed(hands, melds, p)
            if calc_shanten(closed, 0) == 0:
                riichi[p] = True

        # Discard
        if riichi[p]:
            discard_tile = drawn_tile
        else:
            mc_now = len(melds[p])
            discard_tile = ai_discard(
                hands[p], get_meld_flat(melds, p), wall.get_doras(),
                mc_now, get_riichi_discards(p), ws[p]
            )

        do_discard(hands, discards, p, discard_tile)
        return {'discard': discard_tile, 'from': p}

    current_player = 0
    for _ in range(200):
        result = play_turn(current_player)

        if result is None:
            return {'winner': -1, 'win_type': 'draw', 'scores': scores[:]}

        if result.get('done'):
            return {'winner': result['winner'], 'win_type': result['win_type'], 'scores': scores[:]}

        claim = resolve_discard(result['from'], result['discard'])
        if claim['done']:
            return {'winner': claim['winner'], 'win_type': claim['win_type'], 'scores': scores[:]}

        current_player = claim['next_player']

    return {'winner': -1, 'win_type': 'draw', 'scores': scores[:]}


if __name__ == '__main__':
    # Smoke test: run 100 games
    import time
    results = {'draw': 0, 'ron': 0, 'tsumo': 0}
    t0 = time.time()
    for _ in range(100):
        r = run_game()
        results[r['win_type']] += 1
    elapsed = time.time() - t0
    print(f"100 games in {elapsed:.2f}s ({100/elapsed:.0f} games/s)")
    print(f"Results: {results}")
