// ui.js - DOM描画・イベント処理

import { sortTiles } from './tiles.js';
import { calcShanten, getTenpaiWaits, isWinningHand } from './hand.js';
import { STATE, SEATS } from './game.js';

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

  const face = document.createElement('span');
  face.classList.add('tile-face');
  face.textContent = NUM_CHARS[tile.suit][tile.num];
  el.appendChild(face);

  if (tile.suit !== 'z') {
    const sub = document.createElement('span');
    sub.classList.add('tile-sub');
    sub.textContent = SUB_CHARS[tile.suit];
    el.appendChild(sub);
  }

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
  for (const d of state.doraIndicators) el.appendChild(createTileEl(d));
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

  const hand    = sortTiles(state.hands[0]);
  const isAction = state.state === STATE.PLAYER_ACTION || state.state === STATE.WAIT_DISCARD;
  const meldCnt = state.melds[0].length;
  const closed  = getClosedTiles(state, 0);
  const sh      = calcShanten(closed, meldCnt);
  const waits   = sh === 0 ? getTenpaiWaits(closed, meldCnt) : [];

  for (const tile of hand) {
    const isWait = waits.some(w => w.suit === tile.suit && w.num === tile.num);
    const tileEl = createTileEl(tile, {
      clickable: isAction,
      highlight: isWait,
      onClick:   isAction ? t => game.playerDiscard(t) : null,
    });
    if (state.drawnTile && tile.id === state.drawnTile.id) {
      tileEl.classList.add('drawn');
    }
    el.appendChild(tileEl);
  }
}

function getClosedTiles(state, playerIdx) {
  const ids = new Set(state.melds[playerIdx].flatMap(m => m.tiles).map(t => t.id));
  return state.hands[playerIdx].filter(t => !ids.has(t.id));
}

function renderDiscards(state) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`discards-${i}`);
    if (!el) continue;
    el.innerHTML = '';
    for (const tile of state.discards[i]) {
      const t = createTileEl(tile);
      t.classList.add('discard-tile');
      el.appendChild(t);
    }
  }
}

function renderMelds(state) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`melds-${i}`);
    if (!el) continue;
    el.innerHTML = '';
    for (const meld of state.melds[i]) {
      const meldEl = document.createElement('div');
      meldEl.classList.add('meld');
      for (const t of meld.tiles) meldEl.appendChild(createTileEl(t));
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

  const doraEl = document.getElementById('win-doras');
  doraEl.innerHTML = '';
  for (const d of result.doras) doraEl.appendChild(createTileEl(d));
  if (result.uraDoras.length > 0) {
    const sep = document.createElement('span');
    sep.textContent = ' 裏:';
    doraEl.appendChild(sep);
    for (const d of result.uraDoras) doraEl.appendChild(createTileEl(d));
  }

  dlg.style.display = 'flex';
}

export function hideWinDialog()  { const d = document.getElementById('win-dialog');  if (d) d.style.display = 'none'; }
export function showDrawDialog() { const d = document.getElementById('draw-dialog'); if (d) d.style.display = 'flex'; }
export function hideDrawDialog() { const d = document.getElementById('draw-dialog'); if (d) d.style.display = 'none'; }

// ====== 局振り返り ======

const REVIEW_SEAT_NAMES = ['南（あなた）', '西（下家）', '北（対面）', '東（上家）'];

export function showReviewDialog(reviewData) {
  const overlay = document.getElementById('review-overlay');
  const content = document.getElementById('review-content');
  if (!overlay || !content || !reviewData) return;

  content.innerHTML = '';

  // プレイヤー表示順：上家(3) → 対面(2) → 下家(1) → 自分(0)
  const order = [3, 2, 1, 0];

  for (const i of order) {
    const section = document.createElement('div');
    section.classList.add('review-player');

    // 名前 + リーチバッジ
    const nameRow = document.createElement('div');
    nameRow.classList.add('review-player-name');
    nameRow.textContent = REVIEW_SEAT_NAMES[i];
    if (reviewData.riichi[i]) {
      const badge = document.createElement('span');
      badge.classList.add('review-riichi-badge');
      badge.textContent = 'リーチ';
      nameRow.appendChild(badge);
    }
    section.appendChild(nameRow);

    // 手牌（全員表向き）
    const handLabel = document.createElement('div');
    handLabel.classList.add('review-section-label');
    handLabel.textContent = '手牌';
    section.appendChild(handLabel);

    const handRow = document.createElement('div');
    handRow.classList.add('review-hand-row');
    for (const t of reviewData.hands[i]) handRow.appendChild(createTileEl(t));
    section.appendChild(handRow);

    // 副露
    if (reviewData.melds[i].length > 0) {
      const meldLabel = document.createElement('div');
      meldLabel.classList.add('review-section-label');
      meldLabel.textContent = '副露';
      section.appendChild(meldLabel);

      const meldRow = document.createElement('div');
      meldRow.classList.add('review-meld-row');
      for (const meld of reviewData.melds[i]) {
        const meldEl = document.createElement('div');
        meldEl.classList.add('meld');
        for (const t of meld.tiles) meldEl.appendChild(createTileEl(t));
        meldRow.appendChild(meldEl);
      }
      section.appendChild(meldRow);
    }

    // 捨て牌
    if (reviewData.discards[i].length > 0) {
      const discardLabel = document.createElement('div');
      discardLabel.classList.add('review-section-label');
      discardLabel.textContent = '捨て牌';
      section.appendChild(discardLabel);

      const discardRow = document.createElement('div');
      discardRow.classList.add('review-hand-row');
      for (const t of reviewData.discards[i]) {
        const el = createTileEl(t);
        el.classList.add('discard-tile');
        discardRow.appendChild(el);
      }
      section.appendChild(discardRow);
    }

    content.appendChild(section);
  }

  overlay.style.display = 'block';
}

export function hideReviewDialog() {
  const d = document.getElementById('review-overlay');
  if (d) d.style.display = 'none';
}
