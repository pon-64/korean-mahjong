// ui.js - DOM描画・イベント処理

import { tileName, sortTiles, tileKey } from './tiles.js';
import { calcShanten, getTenpaiWaits, isWinningHand } from './hand.js';
import { STATE, SEATS } from './game.js';

let game = null;

export function initUI(gameInstance) {
  game = gameInstance;
}

/** 牌のDOM要素を生成 */
export function createTileEl(tile, opts = {}) {
  const el = document.createElement('div');
  el.classList.add('tile');

  if (opts.faceDown) {
    el.classList.add('face-down');
    el.textContent = '🀫';
    return el;
  }

  if (tile.suit === 'z') {
    el.classList.add('honor');
    el.textContent = ['', '東', '南', '西', '北', '白', '發', '中'][tile.num];
    if (tile.num === 5) el.classList.add('haku');
    if (tile.num === 6) el.classList.add('hatsu');
    if (tile.num === 7) el.classList.add('chun');
  } else {
    const labels = {
      m: ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'],
      p: ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'],
      s: ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'],
    };
    el.textContent = labels[tile.suit][tile.num];
    el.dataset.suit = tile.suit;

    // サブテキスト（スーツ表示）
    const sub = document.createElement('span');
    sub.classList.add('tile-sub');
    sub.textContent = tile.suit === 'm' ? '萬' : tile.suit === 'p' ? '筒' : '索';
    el.appendChild(sub);
  }

  if (tile.isRed) el.classList.add('red-dora');
  if (opts.highlight) el.classList.add('highlight');
  if (opts.clickable) el.classList.add('clickable');

  if (opts.onClick) {
    el.addEventListener('click', () => opts.onClick(tile));
  }

  return el;
}

/** メインボード全体を再描画 */
export function render(state) {
  renderScores(state);
  renderDora(state);
  renderPlayerHand(state);
  renderDiscards(state);
  renderMelds(state);
  renderCpuHands(state);
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
  const container = document.getElementById('dora-indicators');
  if (!container) return;
  container.innerHTML = '';
  for (const d of state.doraIndicators) {
    container.appendChild(createTileEl(d));
  }
}

function renderPlayerHand(state) {
  const container = document.getElementById('player-hand');
  if (!container) return;
  container.innerHTML = '';

  const hand = sortTiles(state.hands[0]);
  const isPlayerTurn = state.currentPlayer === 0;
  const isAction = state.state === STATE.PLAYER_ACTION || state.state === STATE.WAIT_DISCARD;
  const waits = state.riichi[0] ? getTenpaiWaits(getClosedTiles(state, 0)) : [];

  for (const tile of hand) {
    const isWait = waits.some(w => w.suit === tile.suit && w.num === tile.num);
    const el = createTileEl(tile, {
      clickable: isAction,
      highlight: isWait,
      onClick: isAction ? (t) => game.playerDiscard(t) : null,
    });
    // 最後に引いた牌は少し浮かせる
    if (state.drawnTile && tile.id === state.drawnTile.id) {
      el.classList.add('drawn');
    }
    container.appendChild(el);
  }
}

function getClosedTiles(state, playerIdx) {
  const meldFlat = state.melds[playerIdx].flatMap(m => m.tiles);
  return state.hands[playerIdx].filter(t => !meldFlat.some(m => m.id === t.id));
}

function renderCpuHands(state) {
  for (let i = 1; i <= 3; i++) {
    const container = document.getElementById(`cpu-hand-${i}`);
    if (!container) continue;
    container.innerHTML = '';
    const count = state.hands[i].length;
    for (let j = 0; j < count; j++) {
      container.appendChild(createTileEl(null, { faceDown: true }));
    }
    // リーチマーカー
    if (state.riichi[i]) {
      const marker = document.createElement('span');
      marker.classList.add('riichi-marker');
      marker.textContent = 'リーチ';
      container.appendChild(marker);
    }
  }
}

function renderDiscards(state) {
  for (let i = 0; i < 4; i++) {
    const container = document.getElementById(`discards-${i}`);
    if (!container) continue;
    container.innerHTML = '';
    for (const tile of state.discards[i]) {
      const el = createTileEl(tile);
      el.classList.add('discard-tile');
      container.appendChild(el);
    }
  }
}

function renderMelds(state) {
  for (let i = 0; i < 4; i++) {
    const container = document.getElementById(`melds-${i}`);
    if (!container) continue;
    container.innerHTML = '';
    for (const meld of state.melds[i]) {
      const meldEl = document.createElement('div');
      meldEl.classList.add('meld');
      meldEl.dataset.type = meld.type;
      for (const t of meld.tiles) {
        meldEl.appendChild(createTileEl(t));
      }
      container.appendChild(meldEl);
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
    if (el) {
      el.style.display = state.riichi[i] ? 'block' : 'none';
    }
  }
}

function renderButtons(state) {
  const btnTsumo = document.getElementById('btn-tsumo');
  const btnRiichi = document.getElementById('btn-riichi');
  const btnRon = document.getElementById('btn-ron');
  const btnPon = document.getElementById('btn-pon');
  const btnPass = document.getElementById('btn-pass');

  const isPlayerAction = state.state === STATE.PLAYER_ACTION;
  const isCheckClaims = state.state === STATE.CHECK_CLAIMS;

  if (btnTsumo) {
    btnTsumo.disabled = !(isPlayerAction && isWinningHand(state.hands[0]));
  }

  if (btnRiichi) {
    const closed = getClosedTiles(state, 0);
    const canRiichi = isPlayerAction &&
      !state.riichi[0] &&
      state.melds[0].length === 0 &&
      calcShanten(closed) === 0;
    btnRiichi.disabled = !canRiichi;
  }

  if (btnRon) {
    btnRon.disabled = !(isPlayerAction && state.lastDiscard && (() => {
      const testHand = [...state.hands[0], state.lastDiscard];
      return isWinningHand(testHand);
    })());
  }

  if (btnPon) {
    const canPon = isCheckClaims &&
      state.pendingClaims &&
      state.pendingClaims.some(c => c.player === 0 && (c.type === 'pon' || c.type === 'minkan'));
    btnPon.disabled = !canPon;
  }

  if (btnPass) {
    btnPass.disabled = !(isCheckClaims || isPlayerAction);
  }
}

/** 和了ダイアログを表示 */
export function showWinDialog(result) {
  const dialog = document.getElementById('win-dialog');
  if (!dialog) return;

  const sc = result.score;
  const winner = SEATS[result.winner];
  const winTypeName = result.winTypeName === 'kokushi' ? '国士無双' :
    result.winTypeName === 'chiitoi' ? '七対子' : '通常形';

  document.getElementById('win-winner').textContent = `${winner} 和了！`;
  document.getElementById('win-type').textContent = `${result.winType === 'ron' ? 'ロン' : 'ツモ'} / ${winTypeName}`;

  let scoreText = `基礎点: ${sc.base}点`;
  if (sc.riichi) scoreText += ` + リーチ: ${sc.riichi}点`;
  if (sc.red) scoreText += ` + 赤ドラ: ${sc.red}点`;
  if (sc.omote) scoreText += ` + 表ドラ: ${sc.omote}点`;
  if (sc.ura) scoreText += ` + 裏ドラ: ${sc.ura}点`;
  scoreText += ` = 合計: ${sc.total}点`;

  document.getElementById('win-score').textContent = scoreText;

  // 手牌表示
  const handEl = document.getElementById('win-hand');
  handEl.innerHTML = '';
  for (const t of result.hand) {
    handEl.appendChild(createTileEl(t));
  }

  // ドラ表示
  const doraEl = document.getElementById('win-doras');
  doraEl.innerHTML = '';
  for (const d of result.doras) {
    doraEl.appendChild(createTileEl(d));
  }
  if (result.uraDoras.length > 0) {
    const sep = document.createElement('span');
    sep.textContent = '裏: ';
    doraEl.appendChild(sep);
    for (const d of result.uraDoras) {
      doraEl.appendChild(createTileEl(d));
    }
  }

  dialog.style.display = 'flex';
}

export function hideWinDialog() {
  const dialog = document.getElementById('win-dialog');
  if (dialog) dialog.style.display = 'none';
}

/** 流局ダイアログ */
export function showDrawDialog() {
  const dialog = document.getElementById('draw-dialog');
  if (dialog) dialog.style.display = 'flex';
}

export function hideDrawDialog() {
  const dialog = document.getElementById('draw-dialog');
  if (dialog) dialog.style.display = 'none';
}
