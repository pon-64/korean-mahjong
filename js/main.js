// main.js - エントリーポイント

import { Game, STATE } from './game.js';
import { initUI, render, showWinDialog, hideWinDialog, showDrawDialog, hideDrawDialog } from './ui.js';

let game;

function onGameUpdate(event, data) {
  const state = game.getState();
  render(state);

  if (event === 'win')       showWinDialog(data);
  if (event === 'draw_game') showDrawDialog();
}

function startGame() {
  hideWinDialog();
  hideDrawDialog();
  game = new Game(onGameUpdate);
  initUI(game);
  // 初期状態は _init() 内の setTimeout が終わるまで空なので少し待つ
  setTimeout(() => render(game.getState()), 150);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-start').addEventListener('click', () => {
    document.getElementById('start-screen').style.display = 'none';
    startGame();
  });

  document.getElementById('btn-tsumo').addEventListener('click', () => game.playerTsumo());
  document.getElementById('btn-riichi').addEventListener('click', () => game.playerRiichi());
  document.getElementById('btn-ron').addEventListener('click', () => game.playerRon());
  document.getElementById('btn-pon').addEventListener('click', () => game.playerPon());
  document.getElementById('btn-pass').addEventListener('click', () => game.playerPass());

  document.getElementById('btn-next-round').addEventListener('click', () => {
    hideWinDialog();
    game.nextRound();
    setTimeout(() => render(game.getState()), 150);
  });

  document.getElementById('btn-next-round-draw').addEventListener('click', () => {
    hideDrawDialog();
    game.nextRound();
    setTimeout(() => render(game.getState()), 150);
  });
});
