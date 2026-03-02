// ui.js - DOM描画・イベント処理

import { sortTiles } from './tiles.js?v=2';
import { calcShanten, getTenpaiWaits, isWinningHand } from './hand.js?v=2';
import { STATE, SEATS } from './game.js?v=3';
import { applyTileBackground } from './tileimage.js?v=5';

let game = null;
export function initUI(g) { game = g; }

// 牌の表示文字
const NUM_CHARS = {
  m: ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'],
  p: ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'],
  s: ['', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  z: ['', '東', '南', '西', '北', '白', '發', '中'],
};
const SUB_CHARS = { m: '萬', p: '筒', s: '索' };

/** 牌 DOM 要素を生成 */
export function createTileEl(tile, opts = {}) {
  const el = document.createElement('div');
  el.classList.add('tile');

  if (opts.faceDown) {
    el.classList.add('face-down');
    return el;
  }

  el.classList.add(`suit-${tile.suit}`);
  el.dataset.num = tile.num;

  applyTileBackground(el, tile);

  if (tile.isRed)     el.classList.add('red-dora');
  if (opts.highlight) el.classList.add('highlight');
  if (opts.clickable) el.classList.add('clickable');
  if (opts.onClick)   el.addEventListener('click', () => opts.onClick(tile));

  return el;
}

/** ボード全体再描画 */
export function render(state) {
  renderScores(state);
  renderDora(state);
  renderCpuHands(state);
  renderDiscards(state);
  renderMelds(state);
  renderPlayerHand(state);
  renderRemainingCount(state);
  renderLog(state);
  renderButtons(state);
  renderRiichiMarkers(state);
}

function renderScores(state) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`score-${i}`);
    if (el) el.textContent = state.scores[i] + 'pt';
  }
}

function renderDora(state) {
  const el = document.getElementById('dora-indicators');
  if (!el) return;
  el.innerHTML = '';
  for (const d of state.doraIndicators) el.appendChild(createTileEl(d, { tileW: 28, tileH: 40 }));
}

function renderCpuHands(state) {
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById(`cpu-hand-${i}`);
    if (!el) continue;
    el.innerHTML = '';
    for (let j = 0; j < state.hands[i].length; j++) {
      el.appendChild(createTileEl(null, { faceDown: true }));
    }
  }
}

function renderPlayerHand(state) {
  const el = document.getElementById('player-hand');
  if (!el) return;
  el.innerHTML = '';

  const hand      = state.hands[0];
  const drawnId   = state.drawnTile?.id;
  const isAction  = state.state === STATE.PLAYER_ACTION || state.state === STATE.WAIT_DISCARD;
  const meldCnt   = state.melds[0].length;

  // ツモ牌を分離
  const restTiles = drawnId ? hand.filter(t => t.id !== drawnId) : hand;
  const drawnTile = drawnId ? hand.find(t => t.id === drawnId)   : null;

  const closed = getClosedTiles(state, 0);
  const sh     = calcShanten(closed, meldCnt);
  const waits  = sh === 0 ? getTenpaiWaits(closed, meldCnt) : [];

  // リーチ宣言直後（WAIT_DISCARD）: テンパイを維持する牌のみ打牌可能
  let tenpaiIds = null;
  if (state.riichi[0] && state.state === STATE.WAIT_DISCARD) {
    tenpaiIds = new Set();
    const meldIds = new Set(state.melds[0].flatMap(m => m.tiles).map(t => t.id));
    for (const tile of hand) {
      const rest       = hand.filter(t => t.id !== tile.id);
      const closedRest = rest.filter(t => !meldIds.has(t.id));
      if (calcShanten(closedRest, meldCnt) === 0) tenpaiIds.add(tile.id);
    }
  }

  for (const tile of sortTiles(restTiles)) {
    const isWait     = waits.some(w => w.suit === tile.suit && w.num === tile.num);
    const canDiscard = isAction && (!tenpaiIds || tenpaiIds.has(tile.id));
    el.appendChild(createTileEl(tile, {
      clickable: canDiscard,
      highlight: isWait,
      onClick:   canDiscard ? t => game.playerDiscard(t) : null,
    }));
  }

  // ツモ牌を右端に配置
  if (drawnTile) {
    const sep = document.createElement('div');
    sep.className = 'drawn-sep';
    el.appendChild(sep);

    const isWait     = waits.some(w => w.suit === drawnTile.suit && w.num === drawnTile.num);
    const canDiscard = isAction && (!tenpaiIds || tenpaiIds.has(drawnTile.id));
    const tileEl = createTileEl(drawnTile, {
      clickable: canDiscard,
      highlight: isWait,
      onClick:   canDiscard ? t => game.playerDiscard(t) : null,
    });
    tileEl.classList.add('drawn');
    el.appendChild(tileEl);
  }
}

function getClosedTiles(state, playerIdx) {
  const ids = new Set(state.melds[playerIdx].flatMap(m => m.tiles).map(t => t.id));
  return state.hands[playerIdx].filter(t => !ids.has(t.id));
}

function renderDiscards(state) {
  // ロン和了時: 振り込んだ牌をハイライト
  const ronTileId = (state.state === STATE.WIN && state.winResult?.winType === 'ron')
    ? state.lastDiscard?.id : null;

  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`discards-${i}`);
    if (!el) continue;
    el.innerHTML = '';
    const isSide    = (i === 1 || i === 3);
    const riichiIdx = state.riichiDiscardIdx?.[i] ?? -1;

    state.discards[i].forEach((tile, idx) => {
      // 南(0)のリーチ宣言牌は横向きにするためラッパーが必要
      if (i === 0 && idx === riichiIdx) {
        const wrap = document.createElement('div');
        wrap.classList.add('riichi-discard-wrap');
        const t = createTileEl(tile, { tileW: 26, tileH: 36 });
        t.classList.add('discard-tile', 'riichi-discard-south');
        if (tile.id === ronTileId) t.classList.add('ron-tile');
        wrap.appendChild(t);
        el.appendChild(wrap);
        return;
      }

      const t = createTileEl(tile, { tileW: isSide ? 36 : 26, tileH: isSide ? 26 : 36 });
      t.classList.add('discard-tile');
      if (tile.id === ronTileId) t.classList.add('ron-tile');
      // 東西北のリーチ宣言牌: 緑アウトライン
      if (idx === riichiIdx && i !== 0) t.classList.add('riichi-discard-mark');
      el.appendChild(t);
    });
  }
}

function renderMelds(state) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`melds-${i}`);
    if (!el) continue;
    el.innerHTML = '';
    // 東(1)・西(3) の副露牌は CSS が 36×26
    const isSide = (i === 1 || i === 3);
    for (const meld of state.melds[i]) {
      const meldEl = document.createElement('div');
      meldEl.classList.add('meld');
      for (const t of meld.tiles) {
        meldEl.appendChild(createTileEl(t, { tileW: isSide ? 36 : 26, tileH: isSide ? 26 : 36 }));
      }
      el.appendChild(meldEl);
    }
  }
}

function renderRemainingCount(state) {
  const el = document.getElementById('remaining');
  if (el) el.textContent = `残り ${state.remaining} 枚`;
}

function renderLog(state) {
  const el = document.getElementById('game-log');
  if (!el) return;
  el.innerHTML = state.log.map(l => `<div>${l}</div>`).join('');
}

function renderRiichiMarkers(state) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`riichi-${i}`);
    if (el) el.style.display = state.riichi[i] ? 'inline' : 'none';
  }
}

function renderButtons(state) {
  const isPlayerAction = state.state === STATE.PLAYER_ACTION;
  const isCheckClaims  = state.state === STATE.CHECK_CLAIMS;
  const meldCnt        = state.melds[0].length;

  const btnTsumo = document.getElementById('btn-tsumo');
  if (btnTsumo) {
    btnTsumo.disabled = !(isPlayerAction && isWinningHand(state.hands[0], meldCnt));
  }

  const btnRiichi = document.getElementById('btn-riichi');
  if (btnRiichi) {
    const closed = getClosedTiles(state, 0);
    btnRiichi.disabled = !(isPlayerAction && !state.riichi[0] &&
                           meldCnt === 0 && calcShanten(closed, 0) === 0);
  }

  const btnRon = document.getElementById('btn-ron');
  if (btnRon) {
    btnRon.disabled = !(isCheckClaims &&
      state.pendingClaims.some(c => c.player === 0 && c.type === 'ron'));
  }

  const btnPon = document.getElementById('btn-pon');
  if (btnPon) {
    btnPon.disabled = !(isCheckClaims &&
      state.pendingClaims.some(c => c.player === 0 &&
        (c.type === 'pon' || c.type === 'minkan')));
  }

  const btnKan = document.getElementById('btn-kan');
  if (btnKan) {
    if (isPlayerAction && !state.riichi[0]) {
      const kanClosed = getClosedTiles(state, 0);
      const hasShokan = state.melds[0].some(
        m => m.type === 'pon' &&
             kanClosed.some(t => t.suit === m.tiles[0].suit && t.num === m.tiles[0].num)
      );
      const kanCnt = {};
      for (const t of kanClosed) { const k = t.suit + t.num; kanCnt[k] = (kanCnt[k] || 0) + 1; }
      const hasAnkan = Object.values(kanCnt).some(n => n >= 4);
      btnKan.disabled = !(hasShokan || hasAnkan);
    } else {
      btnKan.disabled = true;
    }
  }

  // ★ パスはプレイヤーに実際の選択肢がある時だけ有効
  const btnPass = document.getElementById('btn-pass');
  if (btnPass) {
    btnPass.disabled = !(isCheckClaims &&
      state.pendingClaims.some(c => c.player === 0));
  }
}

// ====== ダイアログ ======

export function showWinDialog(result) {
  const dlg = document.getElementById('win-dialog');
  if (!dlg) return;

  const sc          = result.score;
  const winTypeName = result.winTypeName === 'kokushi' ? '国士無双' :
                      result.winTypeName === 'chiitoi'  ? '七対子'   : '通常形';

  document.getElementById('win-winner').textContent =
    `${SEATS[result.winner]} ${result.winType === 'ron' ? 'ロン' : 'ツモ'}和了！`;
  document.getElementById('win-type').textContent = winTypeName;

  const parts = [`基礎点: ${sc.base}`];
  if (sc.riichi) parts.push(`リーチ +${sc.riichi}`);
  if (sc.red)    parts.push(`赤ドラ +${sc.red}`);
  if (sc.omote)  parts.push(`表ドラ +${sc.omote}`);
  if (sc.ura)    parts.push(`裏ドラ +${sc.ura}`);
  parts.push(`合計 ${sc.total}点`);
  document.getElementById('win-score').textContent = parts.join('  /  ');

  const handEl = document.getElementById('win-hand');
  handEl.innerHTML = '';
  for (const t of result.hand) handEl.appendChild(createTileEl(t));

  // ドラ表示牌（表示牌そのものを表示）
  const doraEl = document.getElementById('win-doras');
  doraEl.innerHTML = '';
  const indicators = result.doraIndicators || result.doras; // fallback for old data
  for (const d of indicators) doraEl.appendChild(createTileEl(d, { tileW: 26, tileH: 36 }));
  if (result.uraDoraIndicators?.length > 0) {
    const sep = document.createElement('span');
    sep.textContent = ' 裏表示牌:';
    doraEl.appendChild(sep);
    for (const d of result.uraDoraIndicators) doraEl.appendChild(createTileEl(d, { tileW: 26, tileH: 36 }));
  } else if (result.uraDoras?.length > 0 && !result.uraDoraIndicators) {
    // 旧データ互換
    const sep = document.createElement('span');
    sep.textContent = ' 裏:';
    doraEl.appendChild(sep);
    for (const d of result.uraDoras) doraEl.appendChild(createTileEl(d, { tileW: 26, tileH: 36 }));
  }

  dlg.style.display = 'flex';
}

export function hideWinDialog()  { const d = document.getElementById('win-dialog');  if (d) d.style.display = 'none'; }
export function showDrawDialog() { const d = document.getElementById('draw-dialog'); if (d) d.style.display = 'flex'; }
export function hideDrawDialog() { const d = document.getElementById('draw-dialog'); if (d) d.style.display = 'none'; }

// ====== 配譜検討（インタラクティブ再生） ======

const REVIEW_SEAT_NAMES = ['南（あなた）', '西（下家）', '北（対面）', '東（上家）'];

let _rv = { data: null, player: 0, turn: 0, timer: null };

/** サマリー統計計算 */
function calcReviewSummary(reviewData) {
  return [0, 1, 2, 3].map(i => {
    const analysis   = reviewData.discardAnalysis?.[i] || [];
    const history    = reviewData.discardHistory?.[i]  || [];
    const totalTurns = analysis.length;
    let optimalCount = 0, totalLoss = 0, maxLoss = 0;
    for (let t = 0; t < totalTurns; t++) {
      const actual = analysis[t]?.find(a => a.tile.id === history[t]?.discardedId);
      const loss = actual?.loss ?? 0;
      if (loss === 0) optimalCount++;
      totalLoss += loss;
      if (loss > maxLoss) maxLoss = loss;
    }
    return {
      totalTurns, optimalCount,
      optRate: totalTurns > 0 ? Math.round(optimalCount / totalTurns * 100) : 0,
      avgLoss: totalTurns > 0 ? Math.round(totalLoss / totalTurns) : 0,
      maxLoss,
    };
  });
}

/** 配譜検討ダイアログを開く */
export function showReviewDialog(reviewData) {
  if (!reviewData) return;
  _stopAutoPlay();
  _rv.data   = reviewData;
  _rv.player = 0;
  _rv.turn   = 0;

  const overlay = document.getElementById('review-overlay');
  const inner   = document.getElementById('review-inner');
  if (!overlay || !inner) return;

  inner.innerHTML = '';

  // ── ヘッダー ──
  const header = document.createElement('div');
  header.className = 'rv-header';

  const title = document.createElement('span');
  title.className = 'rv-title';
  title.textContent = '配譜検討';
  header.appendChild(title);

  // プレイヤー選択タブ（上家→対面→下家→自分）
  const tabs = document.createElement('div');
  tabs.className = 'rv-tabs';
  for (const pi of [3, 2, 1, 0]) {
    const btn = document.createElement('button');
    btn.className = 'rv-tab' + (pi === 0 ? ' active' : '');
    btn.dataset.pi = pi;
    btn.textContent = REVIEW_SEAT_NAMES[pi];
    btn.addEventListener('click', () => {
      _rv.player = pi; _rv.turn = 0;
      inner.querySelectorAll('.rv-tab').forEach(b => b.classList.toggle('active', b.dataset.pi === String(pi)));
      _renderRvFrame();
    });
    tabs.appendChild(btn);
  }
  header.appendChild(tabs);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'rv-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', hideReviewDialog);
  header.appendChild(closeBtn);
  inner.appendChild(header);

  // ── サマリーテーブル ──
  const stats = calcReviewSummary(reviewData);
  const sumDiv = document.createElement('div');
  sumDiv.className = 'rv-summary';
  sumDiv.innerHTML =
    '<table><thead><tr>' +
    '<th>プレイヤー</th><th>打牌数</th><th>最善率</th><th>平均損失</th><th>最大損失</th>' +
    '</tr></thead><tbody>' +
    [3,2,1,0].map(i => {
      const s = stats[i];
      return `<tr><td>${REVIEW_SEAT_NAMES[i]}</td><td>${s.totalTurns}</td>` +
             `<td>${s.optRate}%</td><td>${s.avgLoss}</td><td>${s.maxLoss}</td></tr>`;
    }).join('') +
    '</tbody></table>';
  inner.appendChild(sumDiv);

  // ── 動的エリア ──
  const handArea     = document.createElement('div'); handArea.id = 'rv-hand';
  const discardArea  = document.createElement('div'); discardArea.id = 'rv-discard';
  const analysisArea = document.createElement('div'); analysisArea.id = 'rv-analysis';
  inner.appendChild(handArea);
  inner.appendChild(discardArea);
  inner.appendChild(analysisArea);

  // ── 操作コントロール ──
  const ctrl = document.createElement('div');
  ctrl.className = 'rv-ctrl';

  const mkBtn = (txt, fn) => {
    const b = document.createElement('button');
    b.className = 'rv-btn';
    b.textContent = txt;
    b.addEventListener('click', fn);
    return b;
  };
  ctrl.appendChild(mkBtn('⏮', () => { _rv.turn = 0; _renderRvFrame(); }));
  ctrl.appendChild(mkBtn('◀', () => { _rv.turn = Math.max(0, _rv.turn - 1); _renderRvFrame(); }));
  ctrl.appendChild(mkBtn('▶', () => {
    const max = (_rv.data.discardHistory?.[_rv.player]?.length ?? 0) - 1;
    _rv.turn = Math.min(max, _rv.turn + 1); _renderRvFrame();
  }));
  ctrl.appendChild(mkBtn('⏭', () => {
    _rv.turn = Math.max(0, (_rv.data.discardHistory?.[_rv.player]?.length ?? 1) - 1);
    _renderRvFrame();
  }));

  const autoBtn = document.createElement('button');
  autoBtn.className = 'rv-btn rv-auto';
  autoBtn.id = 'rv-auto';
  autoBtn.textContent = '▶ 自動再生';
  autoBtn.addEventListener('click', _toggleAutoPlay);
  ctrl.appendChild(autoBtn);

  inner.appendChild(ctrl);

  overlay.style.display = 'block';
  _renderRvFrame();
}

function _renderRvFrame() {
  const rd       = _rv.data;
  const pi       = _rv.player;
  const history  = rd.discardHistory?.[pi]  || [];
  const analysis = rd.discardAnalysis?.[pi] || [];
  const total    = history.length;

  const turnIdx = Math.min(_rv.turn, Math.max(0, total - 1));
  _rv.turn = turnIdx;

  const entry   = history[turnIdx]  || null;
  const turns   = analysis[turnIdx] || [];
  const discId  = entry?.discardedId;

  // ── 手牌エリア ──
  const handArea = document.getElementById('rv-hand');
  if (!handArea) return;
  handArea.innerHTML = '';

  const turnLbl = document.createElement('div');
  turnLbl.className = 'rv-turn-lbl';
  turnLbl.textContent = total > 0
    ? `第 ${turnIdx + 1} / ${total} 打牌 — ${REVIEW_SEAT_NAMES[pi]}`
    : `${REVIEW_SEAT_NAMES[pi]} — 打牌なし`;
  handArea.appendChild(turnLbl);

  if (entry) {
    const handRow = document.createElement('div');
    handRow.className = 'rv-hand-row';

    // 分析マップ（tile.id → entry）
    const aMap = new Map();
    for (const a of turns) aMap.set(a.tile.id, a);

    // handBefore をソートして表示
    const sorted = [...entry.handBefore].sort((a, b) => {
      const si = ['m','p','s','z'];
      const ai = si.indexOf(a.suit), bi = si.indexOf(b.suit);
      return ai !== bi ? ai - bi : a.num - b.num;
    });

    for (const t of sorted) {
      const wrap = document.createElement('div');
      wrap.className = 'rv-tile-wrap';

      const tileEl = createTileEl(t, { tileW: 32, tileH: 44 });
      // 実際に切った牌: 赤枠
      if (t.id === discId) tileEl.classList.add('rv-actual');

      const a = aMap.get(t.id);
      if (a) {
        if (a.isOptimal) {
          tileEl.classList.add('rv-best');
          wrap.classList.add('rv-wrap-best');
        } else if (a.loss >= 100) {
          wrap.classList.add('rv-wrap-bad');
        } else if (a.loss >= 20) {
          wrap.classList.add('rv-wrap-med');
        }

        const lossLbl = document.createElement('div');
        lossLbl.className = 'rv-loss-lbl';
        if (a.isOptimal) {
          lossLbl.textContent = '◎';
          lossLbl.classList.add('rv-loss-best');
        } else {
          lossLbl.textContent = `-${a.loss}`;
          lossLbl.classList.add(a.loss >= 100 ? 'rv-loss-bad' : a.loss >= 20 ? 'rv-loss-med' : 'rv-loss-min');
        }
        wrap.appendChild(lossLbl);
      }

      wrap.appendChild(tileEl);
      handRow.appendChild(wrap);
    }
    handArea.appendChild(handRow);
  }

  // ── 捨て牌タイムライン（discardHistory を使うことで鳴かれた牌とのずれを防ぐ）──
  const discardArea = document.getElementById('rv-discard');
  discardArea.innerHTML = '';
  if (history.length > 0) {
    const dlbl = document.createElement('div');
    dlbl.className = 'rv-section-lbl';
    dlbl.textContent = '捨て牌（クリックでジャンプ）';
    discardArea.appendChild(dlbl);

    const drow = document.createElement('div');
    drow.className = 'rv-disc-row';

    history.forEach((entry, idx) => {
      // 切った牌は handBefore から ID で引く（discards から引くと鳴かれた牌が欠落する）
      const tile = entry.handBefore.find(t => t.id === entry.discardedId);
      if (!tile) return;

      const an  = analysis[idx];
      const act = an?.find(a => a.tile.id === entry.discardedId);
      const loss = act?.loss ?? 0;

      const wrap = document.createElement('div');
      wrap.className = 'rv-disc-wrap' + (idx === turnIdx ? ' rv-disc-cur' : '');
      if (loss === 0)       wrap.classList.add('loss-optimal');
      else if (loss < 20)   wrap.classList.add('loss-minor');
      else if (loss < 100)  wrap.classList.add('loss-medium');
      else                  wrap.classList.add('loss-bad');

      const te = createTileEl(tile, { tileW: 22, tileH: 30 });
      te.classList.add('rv-small-tile');
      wrap.appendChild(te);

      const nl = document.createElement('div');
      nl.className = 'rv-disc-num';
      nl.textContent = idx + 1;
      wrap.appendChild(nl);

      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', () => { _rv.turn = idx; _renderRvFrame(); });
      drow.appendChild(wrap);
    });
    discardArea.appendChild(drow);
  }

  // ── 分析テーブル ──
  const analysisArea = document.getElementById('rv-analysis');
  analysisArea.innerHTML = '';
  if (turns.length > 0) {
    const albl = document.createElement('div');
    albl.className = 'rv-section-lbl';
    albl.textContent = '打牌分析（スコア降順）';
    analysisArea.appendChild(albl);

    const table = document.createElement('table');
    table.className = 'rv-analysis-tbl';
    table.innerHTML =
      '<thead><tr>' +
      '<th>牌</th><th>シャンテン</th><th>有効牌数</th><th>スコア</th><th>損失</th><th>評価</th>' +
      '</tr></thead>';

    const tbody = document.createElement('tbody');
    const sorted2 = [...turns].sort((a, b) => b.score - a.score);
    for (const a of sorted2) {
      const tr = document.createElement('tr');
      if (a.tile.id === discId) tr.classList.add('rv-row-actual');
      const tname = NUM_CHARS[a.tile.suit][a.tile.num] +
                    (a.tile.suit !== 'z' ? SUB_CHARS[a.tile.suit] : '');
      tr.innerHTML =
        `<td>${tname}</td><td>${a.shanten}</td><td>${a.effective}</td>` +
        `<td>${a.score}</td><td>${a.loss === 0 ? '0' : '-'+a.loss}</td>` +
        `<td>${a.isOptimal ? '◎最善' : ''}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    analysisArea.appendChild(table);
  }
}

function _stopAutoPlay() {
  if (_rv.timer) { clearInterval(_rv.timer); _rv.timer = null; }
  const btn = document.getElementById('rv-auto');
  if (btn) btn.textContent = '▶ 自動再生';
}

function _toggleAutoPlay() {
  if (_rv.timer) {
    _stopAutoPlay();
    return;
  }
  const btn = document.getElementById('rv-auto');
  if (btn) btn.textContent = '⏸ 停止';
  _rv.timer = setInterval(() => {
    const max = (_rv.data.discardHistory?.[_rv.player]?.length ?? 0) - 1;
    if (_rv.turn >= max) { _stopAutoPlay(); return; }
    _rv.turn++;
    _renderRvFrame();
  }, 1200);
}

export function hideReviewDialog() {
  _stopAutoPlay();
  const d = document.getElementById('review-overlay');
  if (d) d.style.display = 'none';
}
