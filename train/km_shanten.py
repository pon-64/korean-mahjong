"""
Fast shanten calculation for Korean Mahjong using numba JIT.
Input: numpy int64 array of shape (34,) — tile counts.
"""
import numpy as np
from numba import njit

KOKUSHI_IDX = np.array([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33], dtype=np.int64)


@njit
def _dfs(c, i, m, jantai, taatsu, max_m, meld_count, best):
    while i < 34 and c[i] == 0:
        i += 1
    if i >= 34:
        p = min(taatsu, max_m - m)
        val = 2 * (m + meld_count) + jantai + p
        if 8 - val < best[0]:
            best[0] = 8 - val
        return

    rem = 0
    for k in range(i, 34):
        rem += c[k]

    am = min(rem // 3, max_m - m)
    ap = min((rem - am * 3) // 2, max_m - m - am)
    cv = 2 * (m + meld_count) + jantai + min(taatsu, max_m - m)
    if 8 - (cv + 2 * am + ap) >= best[0]:
        return

    suit = i // 9
    pos  = i % 9

    if c[i] >= 3 and m < max_m:
        c[i] -= 3
        _dfs(c, i, m + 1, jantai, taatsu, max_m, meld_count, best)
        c[i] += 3

    if suit < 3 and pos <= 6 and m < max_m and c[i] > 0 and c[i+1] > 0 and c[i+2] > 0:
        c[i] -= 1; c[i+1] -= 1; c[i+2] -= 1
        _dfs(c, i, m + 1, jantai, taatsu, max_m, meld_count, best)
        c[i] += 1; c[i+1] += 1; c[i+2] += 1

    if jantai == 0 and c[i] >= 2:
        c[i] -= 2
        _dfs(c, i, m, 1, taatsu, max_m, meld_count, best)
        c[i] += 2

    if c[i] >= 2 and m + taatsu < max_m:
        c[i] -= 2
        _dfs(c, i, m, jantai, taatsu + 1, max_m, meld_count, best)
        c[i] += 2

    if suit < 3 and m + taatsu < max_m:
        if pos <= 7 and c[i+1] > 0:
            c[i] -= 1; c[i+1] -= 1
            _dfs(c, i, m, jantai, taatsu + 1, max_m, meld_count, best)
            c[i] += 1; c[i+1] += 1
        if pos <= 6 and c[i+2] > 0:
            c[i] -= 1; c[i+2] -= 1
            _dfs(c, i, m, jantai, taatsu + 1, max_m, meld_count, best)
            c[i] += 1; c[i+2] += 1

    _dfs(c, i + 1, m, jantai, taatsu, max_m, meld_count, best)


@njit
def calc_shanten_numba(c_in: np.ndarray, meld_count: int) -> int:
    """
    Calculate shanten number for Korean mahjong.
    c_in: int64 array of shape (34,) — tile counts.
    Returns: -1 = winning, 0 = tenpai, n = n-shanten.
    """
    c = c_in.copy()
    max_m = 4 - meld_count
    best = np.zeros(1, dtype=np.int64)
    best[0] = 8
    _dfs(c, 0, 0, 0, 0, max_m, meld_count, best)
    n = best[0]

    if meld_count > 0:
        return n

    # Korean chiitoi: 4-of-a-kind counts as 2 pairs
    pairs = 0
    for x in c_in:
        pairs += x // 2
    chiitoi = 6 - min(pairs, 7)

    # Kokushi
    kinds = 0
    has_pair = 0
    for i in range(13):
        idx = KOKUSHI_IDX[i]
        if c_in[idx] >= 1:
            kinds += 1
            if c_in[idx] >= 2:
                has_pair = 1
    kokushi = 13 - kinds - has_pair

    result = n
    if chiitoi < result:
        result = chiitoi
    if kokushi < result:
        result = kokushi
    return result


def warmup():
    """Call once at startup to trigger JIT compilation."""
    c = np.zeros(34, dtype=np.int64)
    c[0] = c[1] = c[2] = c[9] = c[10] = c[11] = c[18] = c[19] = c[20] = 1
    c[27] = c[27+1] = 2
    calc_shanten_numba(c, 0)


if __name__ == '__main__':
    import time
    print("Warming up JIT...")
    warmup()
    print("Done. Benchmarking...")

    c = np.zeros(34, dtype=np.int64)
    c[0] = c[1] = c[2] = c[9] = c[10] = c[11] = c[18] = c[19] = c[20] = 1
    c[27] = c[28] = 1
    c[31] = 2

    t0 = time.time()
    for _ in range(100_000):
        calc_shanten_numba(c, 0)
    elapsed = time.time() - t0
    print(f"100,000 calls: {elapsed*1000:.1f}ms ({100000/elapsed:.0f} calls/sec)")
    print(f"Shanten: {calc_shanten_numba(c, 0)}")
