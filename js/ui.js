// ui.js - DOM描画・イベント処理

import { sortTiles } from './tiles.js?v=2';
import { calcShanten, getTenpaiWaits, isWinningHand } from './hand.js?v=2';
import { STATE, SEATS } from './game.js?v=5';
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

// ====== 配譜検討（ボードスタイル） ======

const REVIEW_SEAT_NAMES = ['南（あなた）', '西（下家）', '北（対面）', '東（上家）'];

let _rv = { data: null, player: 0, turn: 0, timer: null };

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

  // ── ボード ──
  inner.appendChild(_buildReviewBoard());

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

  const turnCounter = document.createElement('span');
  turnCounter.id = 'rv-turn-counter';
  turnCounter.className = 'rv-turn-counter';
  ctrl.appendChild(turnCounter);

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

  overlay.style.display = 'flex';
  _renderRvFrame();
}

/** ボード構造を生成 */
function _buildReviewBoard() {
  const surface = document.createElement('div');
  surface.className = 'rv-board-surface';

  // 北エリア
  const north = document.createElement('div');
  north.id = 'rv-area-north';
  const nhrow = document.createElement('div');
  nhrow.className = 'north-hand-row';
  const melds2 = document.createElement('div');
  melds2.id = 'rv-melds-2'; melds2.className = 'meld-row';
  const cpuHand2 = document.createElement('div');
  cpuHand2.id = 'rv-cpu-hand-2'; cpuHand2.className = 'cpu-hand-row';
  nhrow.appendChild(melds2); nhrow.appendChild(cpuHand2);
  north.appendChild(nhrow);
  surface.appendChild(north);

  // 中段
  const middle = document.createElement('div');
  middle.id = 'rv-middle-row';

  // 東エリア（左）
  const east = document.createElement('div');
  east.id = 'rv-area-east';
  const sideColE = document.createElement('div');
  sideColE.className = 'side-hand-col';
  const cpuHand3 = document.createElement('div');
  cpuHand3.id = 'rv-cpu-hand-3'; cpuHand3.className = 'cpu-hand-vert';
  const melds3 = document.createElement('div');
  melds3.id = 'rv-melds-3'; melds3.className = 'meld-vert';
  sideColE.appendChild(cpuHand3); sideColE.appendChild(melds3);
  east.appendChild(sideColE);
  middle.appendChild(east);

  // 中央テーブル
  const center = document.createElement('div');
  center.id = 'rv-table-center';
  const disc2 = document.createElement('div');
  disc2.id = 'rv-discards-2'; disc2.className = 'discard-area discard-north';
  center.appendChild(disc2);
  const cmrow = document.createElement('div');
  cmrow.id = 'rv-center-mid-row';
  const disc3 = document.createElement('div');
  disc3.id = 'rv-discards-3'; disc3.className = 'discard-area discard-east';
  const deco = document.createElement('div');
  deco.id = 'rv-center-deco';
  const disc1 = document.createElement('div');
  disc1.id = 'rv-discards-1'; disc1.className = 'discard-area discard-west';
  cmrow.appendChild(disc3); cmrow.appendChild(deco); cmrow.appendChild(disc1);
  center.appendChild(cmrow);
  const disc0 = document.createElement('div');
  disc0.id = 'rv-discards-0'; disc0.className = 'discard-area discard-south';
  center.appendChild(disc0);
  middle.appendChild(center);

  // 西エリア（右）
  const west = document.createElement('div');
  west.id = 'rv-area-west';
  const sideColW = document.createElement('div');
  sideColW.className = 'side-hand-col';
  const melds1 = document.createElement('div');
  melds1.id = 'rv-melds-1'; melds1.className = 'meld-vert';
  const cpuHand1 = document.createElement('div');
  cpuHand1.id = 'rv-cpu-hand-1'; cpuHand1.className = 'cpu-hand-vert';
  sideColW.appendChild(melds1); sideColW.appendChild(cpuHand1);
  west.appendChild(sideColW);
  middle.appendChild(west);

  surface.appendChild(middle);

  // 南エリア（手牌＋分析）
  const south = document.createElement('div');
  south.id = 'rv-area-south';
  const srow = document.createElement('div');
  srow.className = 'south-hand-row';
  const phand = document.createElement('div');
  phand.id = 'rv-player-hand';
  const melds0 = document.createElement('div');
  melds0.id = 'rv-melds-0'; melds0.className = 'meld-row';
  srow.appendChild(phand); srow.appendChild(melds0);
  south.appendChild(srow);
  surface.appendChild(south);

  return surface;
}

function _renderRvFrame() {
  const rd       = _rv.data;
  const pi       = _rv.player;
  const history  = rd.discardHistory?.[pi]  || [];
  const analysis = rd.discardAnalysis?.[pi] || [];
  const total    = history.length;

  const turnIdx = Math.min(_rv.turn, Math.max(0, total - 1));
  _rv.turn = turnIdx;

  const entry  = history[turnIdx] || null;
  const turns  = analysis[turnIdx] || [];
  const discId = entry?.discardedId;

  // piの捨て牌を再構築（turns 0..turnIdx-1）
  const piDiscards = [];
  for (let i = 0; i < turnIdx; i++) {
    const e = history[i];
    const t = e.handBefore.find(t => t.id === e.discardedId);
    if (t) piDiscards.push(t);
  }

  // ── 捨て牌（全4方向） ──
  for (let p = 0; p < 4; p++) {
    const el = document.getElementById(`rv-discards-${p}`);
    if (!el) continue;
    el.innerHTML = '';
    const discards = (p === pi) ? piDiscards : (entry?.opponentDiscards?.[p] ?? []);
    for (const tile of discards) {
      const t = createTileEl(tile);
      t.classList.add('discard-tile');
      el.appendChild(t);
    }
  }

  // ── CPU手牌（裏向き） ──
  for (let cpuPos = 1; cpuPos <= 3; cpuPos++) {
    const el = document.getElementById(`rv-cpu-hand-${cpuPos}`);
    if (!el) continue;
    el.innerHTML = '';
    // piがこの位置を占める場合は player0 を代わりに表示
    const displayPlayer = (cpuPos !== pi) ? cpuPos : 0;
    const discCount = entry?.opponentDiscards?.[displayPlayer]?.length ?? 0;
    const handCount = Math.max(0, 13 - discCount);
    for (let j = 0; j < handCount; j++) {
      el.appendChild(createTileEl(null, { faceDown: true }));
    }
  }

  // ── 分析対象プレイヤーの手牌（南エリア） ──
  const playerHandEl = document.getElementById('rv-player-hand');
  if (playerHandEl) {
    playerHandEl.innerHTML = '';
    if (entry) {
      const aMap = new Map();
      for (const a of turns) aMap.set(a.tile.suit + a.tile.num, a);

      const sorted = [...entry.handBefore].sort((a, b) => {
        const si = ['m','p','s','z'];
        return (si.indexOf(a.suit) - si.indexOf(b.suit)) || (a.num - b.num);
      });

      for (const t of sorted) {
        const wrap = document.createElement('div');
        wrap.className = 'rv-tile-wrap';

        const tileEl = createTileEl(t);
        if (t.id === discId) tileEl.classList.add('rv-actual');

        const a = aMap.get(t.suit + t.num);
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
        playerHandEl.appendChild(wrap);
      }
    }
  }

  // ── 中央デコ（ドラ＋ターン情報） ──
  const deco = document.getElementById('rv-center-deco');
  if (deco) {
    deco.innerHTML = '';

    if (entry?.doraIndicators?.length > 0) {
      const doraWrap = document.createElement('div');
      doraWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';
      const lbl = document.createElement('div');
      lbl.className = 'label-text';
      lbl.textContent = 'ドラ';
      doraWrap.appendChild(lbl);
      const doraRow = document.createElement('div');
      doraRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;justify-content:center;';
      for (const d of entry.doraIndicators) {
        const de = createTileEl(d);
        de.style.cssText = 'width:28px!important;height:40px!important;';
        doraRow.appendChild(de);
      }
      doraWrap.appendChild(doraRow);
      deco.appendChild(doraWrap);
    }

    const info = document.createElement('div');
    info.className = 'rv-turn-info';
    info.textContent = total > 0 ? `${turnIdx + 1} / ${total}` : '- / -';
    deco.appendChild(info);

    const pname = document.createElement('div');
    pname.className = 'label-text';
    pname.textContent = REVIEW_SEAT_NAMES[pi];
    deco.appendChild(pname);
  }

  // ── ターンカウンター（コントロール内） ──
  const counter = document.getElementById('rv-turn-counter');
  if (counter) {
    counter.textContent = total > 0 ? `第 ${turnIdx + 1} / ${total} 打牌` : '打牌なし';
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
