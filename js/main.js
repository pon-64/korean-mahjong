// main.js - エントリーポイント

import { Game, STATE, SEATS } from './game.js';
import { initUI, render, showWinDialog, hideWinDialog, showDrawDialog, hideDrawDialog } from './ui.js';

let game;

function onGameUpdate(event, data) {
  const state = game.getState();

  // pendingClaimsをstateに付加（ui.jsで参照）
  state.pendingClaims = game.pendingClaims;

  render(state);
  updateRoundDisplay(state.round);

  if (event === 'win') {
    showWinDialog(data);
  } else if (event === 'draw_game') {
    showDrawDialog();
  }
}

function updateRoundDisplay(round) {
  const el = document.getElementById('round-num');
  if (el) el.textContent = round + 1;
}

function startGame() {
  hideWinDialog();
  hideDrawDialog();
  game = new Game(onGameUpdate);
  initUI(game);
  render(game.getState());
}

// ボタンイベント設定
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-tsumo').addEventListener('click', () => {
    game.playerTsumo();
  });

  document.getElementById('btn-riichi').addEventListener('click', () => {
    game.playerRiichi();
  });

  document.getElementById('btn-ron').addEventListener('click', () => {
    game.playerRon();
  });

  document.getElementById('btn-pon').addEventListener('click', () => {
    game.playerPon();
  });

  document.getElementById('btn-pass').addEventListener('click', () => {
    game.playerPass();
  });

  document.getElementById('btn-next-round').addEventListener('click', () => {
    hideWinDialog();
    game.nextRound();
    render(game.getState());
  });

  document.getElementById('btn-next-round-draw').addEventListener('click', () => {
    hideDrawDialog();
    game.nextRound();
    render(game.getState());
  });

  startGame();
});
