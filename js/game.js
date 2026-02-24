// game.js - ゲーム状態機械・進行管理

import { Wall } from './wall.js';
import { sortTiles, tileName, tilesEqual } from './tiles.js';
import { calcShanten, getTenpaiWaits, isWinningHand, getWinType } from './hand.js';
import { calcScore, calcPayments } from './scoring.js';
import { chooseDiscard, shouldRiichi, shouldPon, shouldKan } from './ai.js';

export const PLAYERS = 4;
export const SEATS = ['南', '西', '北', '東']; // index0=プレイヤー(南), 1=西CPU, 2=北CPU, 3=東CPU

export const STATE = {
  DEALING: 'DEALING',
  DRAW: 'DRAW',
  PLAYER_ACTION: 'PLAYER_ACTION',
  WAIT_DISCARD: 'WAIT_DISCARD',
  CHECK_CLAIMS: 'CHECK_CLAIMS',
  PON_KAN: 'PON_KAN',
  CPU_TURN: 'CPU_TURN',
  WIN: 'WIN',
  DRAW_GAME: 'DRAW_GAME',
  GAME_OVER: 'GAME_OVER',
};

export class Game {
  constructor(onUpdate) {
    this.onUpdate = onUpdate; // UI更新コールバック
    this.scores = [0, 0, 0, 0]; // 各プレイヤーの累計点数
    this.round = 0;
    this.reset();
  }

  reset() {
    this.wall = new Wall();
    this.hands = [[], [], [], []];       // 手牌
    this.melds = [[], [], [], []];       // 副露（ポン・カン）
    this.discards = [[], [], [], []];    // 捨て牌
    this.riichi = [false, false, false, false];
    this.riichiTurn = [-1, -1, -1, -1]; // リーチした巡目
    this.currentPlayer = 0;
    this.state = STATE.DEALING;
    this.lastDiscard = null;
    this.lastDiscardPlayer = -1;
    this.drawnTile = null;
    this.pendingClaims = [];   // ポン/カン/ロン待ち
    this.claimTimeout = null;
    this.log = [];
    this.winResult = null;
    this.turnCount = 0;
    this.kanCount = 0;

    this._deal();
  }

  _deal() {
    const hands = this.wall.deal(PLAYERS);
    for (let i = 0; i < PLAYERS; i++) {
      this.hands[i] = sortTiles(hands[i]);
    }
    this.state = STATE.DRAW;
    this.addLog('配牌完了');
    this._startTurn(0);
  }

  _startTurn(playerIdx) {
    this.currentPlayer = playerIdx;
    const tile = this.wall.draw();

    if (!tile) {
      this._drawGame();
      return;
    }

    this.drawnTile = tile;
    this.hands[playerIdx].push(tile);

    if (playerIdx === 0) {
      // プレイヤーのターン
      this.state = STATE.PLAYER_ACTION;
      // ツモ和了チェック
      if (isWinningHand(this.hands[0])) {
        // プレイヤーはUIからツモを押せる
      }
      this.onUpdate('draw', { player: 0, tile });
    } else {
      // CPU ターン
      this.state = STATE.CPU_TURN;
      this.onUpdate('draw', { player: playerIdx, tile });
      setTimeout(() => this._cpuTurn(playerIdx), 600);
    }
  }

  _cpuTurn(playerIdx) {
    const hand = this.hands[playerIdx];
    const closedTiles = this._closedTiles(playerIdx);
    const doras = this.wall.getDoras();

    // ツモ和了チェック
    if (isWinningHand(hand)) {
      this._win(playerIdx, 'tsumo', null);
      return;
    }

    // 暗槓チェック
    const kanTile = this._findAnkanTile(closedTiles);
    if (kanTile && this.wall.kanCount < 4 && !this.riichi[playerIdx]) {
      if (shouldKan(closedTiles, kanTile)) {
        this._doKan(playerIdx, kanTile, 'ankan');
        return;
      }
    }

    // リーチ判断
    if (!this.riichi[playerIdx] && this.melds[playerIdx].length === 0) {
      if (shouldRiichi(closedTiles)) {
        this._doRiichi(playerIdx);
        return;
      }
    }

    // 打牌
    const discard = chooseDiscard(hand, this._meldTilesFlat(playerIdx), doras);
    setTimeout(() => this._discard(playerIdx, discard), 400);
  }

  _closedTiles(playerIdx) {
    const meldFlat = this._meldTilesFlat(playerIdx);
    return this.hands[playerIdx].filter(t => !meldFlat.some(m => m.id === t.id));
  }

  _meldTilesFlat(playerIdx) {
    return this.melds[playerIdx].flatMap(m => m.tiles);
  }

  _findAnkanTile(closedTiles) {
    const counts = {};
    for (const t of closedTiles) {
      const k = t.suit + t.num;
      counts[k] = (counts[k] || 0) + 1;
    }
    for (const [k, cnt] of Object.entries(counts)) {
      if (cnt === 4) {
        return closedTiles.find(t => t.suit + t.num === k);
      }
    }
    return null;
  }

  _doRiichi(playerIdx) {
    const closedTiles = this._closedTiles(playerIdx);
    const discard = chooseDiscard(this.hands[playerIdx], this._meldTilesFlat(playerIdx), this.wall.getDoras());
    this.riichi[playerIdx] = true;
    this.riichiTurn[playerIdx] = this.turnCount;
    this.addLog(`${SEATS[playerIdx]} リーチ！`);
    this._discard(playerIdx, discard);
  }

  // プレイヤーがリーチ宣言
  playerRiichi() {
    if (this.state !== STATE.PLAYER_ACTION) return;
    if (this.riichi[0] || this.melds[0].length > 0) return;
    if (calcShanten(this._closedTiles(0)) !== 0) return;

    this.riichi[0] = true;
    this.riichiTurn[0] = this.turnCount;
    this.addLog('あなた リーチ！');
    this.state = STATE.WAIT_DISCARD;
    this.onUpdate('riichi', { player: 0 });
  }

  // プレイヤーが牌を捨てる
  playerDiscard(tile) {
    if (this.state !== STATE.PLAYER_ACTION && this.state !== STATE.WAIT_DISCARD) return;
    if (this.currentPlayer !== 0) return;

    // リーチ中は待ち牌以外捨てられない（フリテン制限なしだが手牌変更不可）
    if (this.riichi[0]) {
      const waits = getTenpaiWaits(this._closedTiles(0));
      // リーチ後は引いた牌以外捨てられない（ただしツモ切りのみ）
      // 韓麻はフリテン制限なしなので、ツモ切りのみ制限
      if (!tilesEqual(tile, this.drawnTile)) return;
    }

    this._discard(0, tile);
  }

  // プレイヤーがツモ和了
  playerTsumo() {
    if (this.state !== STATE.PLAYER_ACTION) return;
    if (!isWinningHand(this.hands[0])) return;
    this._win(0, 'tsumo', null);
  }

  _discard(playerIdx, tile) {
    // 手牌から除去
    const idx = this.hands[playerIdx].findIndex(t => t.id === tile.id);
    if (idx === -1) return;
    this.hands[playerIdx].splice(idx, 1);
    this.discards[playerIdx].push(tile);
    this.lastDiscard = tile;
    this.lastDiscardPlayer = playerIdx;
    this.turnCount++;

    this.addLog(`${SEATS[playerIdx]} 打: ${tileName(tile)}`);
    this.onUpdate('discard', { player: playerIdx, tile });

    // ロン/ポン/カンチェック
    this._checkClaims(playerIdx, tile);
  }

  _checkClaims(discardPlayer, tile) {
    this.pendingClaims = [];

    for (let i = 0; i < PLAYERS; i++) {
      if (i === discardPlayer) continue;

      // ロンチェック（フリテン制限なし）
      const testHand = [...this.hands[i], tile];
      if (isWinningHand(testHand)) {
        this.pendingClaims.push({ type: 'ron', player: i });
      }
    }

    // ポン/カンチェック（リーチ中は不可）
    for (let i = 0; i < PLAYERS; i++) {
      if (i === discardPlayer || this.riichi[i]) continue;
      const closed = this._closedTiles(i);

      const sameCount = closed.filter(t => tilesEqual(t, tile)).length;
      if (sameCount >= 3 && this.wall.kanCount < 4) {
        this.pendingClaims.push({ type: 'minkan', player: i });
      } else if (sameCount >= 2) {
        this.pendingClaims.push({ type: 'pon', player: i });
      }
    }

    this.state = STATE.CHECK_CLAIMS;
    this._resolveClaims(discardPlayer, tile);
  }

  _resolveClaims(discardPlayer, tile) {
    if (this.pendingClaims.length === 0) {
      // 次のプレイヤーへ
      this._nextPlayer(discardPlayer);
      return;
    }

    // ロンがある場合 → 優先順位: 下家→対面→上家
    const rons = this.pendingClaims.filter(c => c.type === 'ron');
    if (rons.length > 0) {
      // 下家→対面→上家の順
      const priority = [
        (discardPlayer + 1) % 4,
        (discardPlayer + 2) % 4,
        (discardPlayer + 3) % 4,
      ];
      for (const p of priority) {
        const ron = rons.find(r => r.player === p);
        if (ron) {
          // プレイヤー(0)がロンできる場合はUIに通知
          if (ron.player === 0) {
            this.state = STATE.PLAYER_ACTION;
            this.onUpdate('can_ron', { tile, from: discardPlayer });
            // プレイヤーは playerRon() を呼ぶ
            // CPUのロンは自動
            return;
          } else {
            this._win(ron.player, 'ron', discardPlayer);
            return;
          }
        }
      }
    }

    // CPUのポン/カン
    const pons = this.pendingClaims.filter(c => c.type === 'pon' || c.type === 'minkan');
    for (const claim of pons) {
      if (claim.player === 0) {
        // プレイヤーのポン/カンはUIから
        this.onUpdate('can_pon', { tile, from: discardPlayer, claim });
        return;
      }
      // CPU判断
      const closed = this._closedTiles(claim.player);
      if (claim.type === 'minkan' && shouldPon(closed, tile, this.wall.getDoras())) {
        this._doPon(claim.player, discardPlayer, tile, 'minkan');
        return;
      } else if (claim.type === 'pon' && shouldPon(closed, tile, this.wall.getDoras())) {
        this._doPon(claim.player, discardPlayer, tile, 'pon');
        return;
      }
    }

    // 誰も鳴かない
    this._nextPlayer(discardPlayer);
  }

  // プレイヤーがロン
  playerRon() {
    if (this.state !== STATE.PLAYER_ACTION) return;
    const tile = this.lastDiscard;
    const testHand = [...this.hands[0], tile];
    if (!isWinningHand(testHand)) return;
    this._win(0, 'ron', this.lastDiscardPlayer);
  }

  // プレイヤーがポン
  playerPon() {
    if (this.state !== STATE.CHECK_CLAIMS) return;
    const tile = this.lastDiscard;
    const claim = this.pendingClaims.find(c => c.player === 0 && c.type === 'pon');
    if (!claim) return;
    this._doPon(0, this.lastDiscardPlayer, tile, 'pon');
  }

  // プレイヤーがパス（鳴かない）
  playerPass() {
    if (this.state !== STATE.CHECK_CLAIMS && this.state !== STATE.PLAYER_ACTION) return;
    this._nextPlayer(this.lastDiscardPlayer);
  }

  _doPon(playerIdx, fromIdx, tile, type) {
    // 手牌から同一牌2枚除去
    const closed = this._closedTiles(playerIdx);
    let removed = 0;
    const keep = [];
    for (const t of closed) {
      if (removed < 2 && tilesEqual(t, tile)) {
        removed++;
      } else {
        keep.push(t);
      }
    }
    const meldTiles = [tile, ...closed.filter(t => !keep.includes(t))];

    this.melds[playerIdx].push({
      type,
      tiles: meldTiles,
      from: fromIdx,
    });

    // 手牌更新（副露牌は meld に移動）
    const meldFlat = this._meldTilesFlat(playerIdx);
    // 手牌から副露牌を除いた状態で keep を使う
    this.hands[playerIdx] = [
      ...keep,
      ...this.hands[playerIdx].filter(t => !closed.includes(t)),
    ];

    const label = type === 'minkan' ? 'カン' : 'ポン';
    this.addLog(`${SEATS[playerIdx]} ${label}: ${tileName(tile)}`);

    if (type === 'minkan') {
      // カン補充
      const supplement = this.wall.drawKan();
      if (supplement) {
        this.hands[playerIdx].push(supplement);
      }
      this.onUpdate('kan', { player: playerIdx, tile });
      if (playerIdx === 0) {
        this.state = STATE.PLAYER_ACTION;
        this.onUpdate('draw', { player: 0, tile: supplement });
      } else {
        setTimeout(() => this._cpuTurn(playerIdx), 500);
      }
    } else {
      this.onUpdate('pon', { player: playerIdx, tile });
      if (playerIdx === 0) {
        this.state = STATE.WAIT_DISCARD;
        this.onUpdate('need_discard', {});
      } else {
        setTimeout(() => {
          const discard = chooseDiscard(this.hands[playerIdx], this._meldTilesFlat(playerIdx), this.wall.getDoras());
          this._discard(playerIdx, discard);
        }, 500);
      }
    }
  }

  _doKan(playerIdx, kanTile, kanType) {
    const closed = this._closedTiles(playerIdx);
    const kanTiles = closed.filter(t => tilesEqual(t, kanTile));

    this.melds[playerIdx].push({
      type: kanType,
      tiles: kanTiles,
      from: playerIdx,
    });

    // 手牌から4枚除去
    for (const kt of kanTiles) {
      const i = this.hands[playerIdx].findIndex(t => t.id === kt.id);
      if (i !== -1) this.hands[playerIdx].splice(i, 1);
    }

    const supplement = this.wall.drawKan();
    if (supplement) {
      this.drawnTile = supplement;
      this.hands[playerIdx].push(supplement);
    }

    this.addLog(`${SEATS[playerIdx]} 暗槓: ${tileName(kanTile)}`);
    this.onUpdate('kan', { player: playerIdx, tile: kanTile });

    if (playerIdx === 0) {
      this.state = STATE.PLAYER_ACTION;
      this.onUpdate('draw', { player: 0, tile: supplement });
    } else {
      setTimeout(() => this._cpuTurn(playerIdx), 500);
    }
  }

  _nextPlayer(currentIdx) {
    const next = (currentIdx + 1) % PLAYERS;
    setTimeout(() => this._startTurn(next), 300);
  }

  _win(winnerIdx, winType, fromIdx) {
    const hand = [...this.hands[winnerIdx]];
    if (winType === 'ron') {
      hand.push(this.lastDiscard);
    }

    const doras = this.wall.getDoras();
    const uraDoras = this.wall.getUraDoras();
    const isRiichi = this.riichi[winnerIdx];

    const scoreResult = calcScore({
      winType,
      handTiles: hand,
      isRiichi,
      doras,
      uraDoras,
      isRiichiWin: isRiichi,
    });

    const { payments, winnerGain } = calcPayments(
      scoreResult.total,
      winType,
      PLAYERS,
      fromIdx,
      winnerIdx
    );

    // スコア更新
    for (const [pidxStr, pay] of Object.entries(payments)) {
      const pidx = Number(pidxStr);
      this.scores[pidx] -= pay;
    }
    this.scores[winnerIdx] += winnerGain;

    const winTypeName = getWinType(hand);

    this.winResult = {
      winner: winnerIdx,
      winType,
      from: fromIdx,
      score: scoreResult,
      payments,
      winnerGain,
      hand,
      doras,
      uraDoras: isRiichi ? uraDoras : [],
      winTypeName,
    };

    const label = winType === 'ron' ? 'ロン' : 'ツモ';
    this.addLog(`${SEATS[winnerIdx]} ${label}和了！ ${scoreResult.total}点`);

    this.state = STATE.WIN;
    this.onUpdate('win', this.winResult);
  }

  _drawGame() {
    this.addLog('流局');
    this.state = STATE.DRAW_GAME;
    this.onUpdate('draw_game', {});
  }

  addLog(msg) {
    this.log.unshift(msg);
    if (this.log.length > 50) this.log.pop();
  }

  // 次の局へ
  nextRound() {
    this.round++;
    this.reset();
  }

  // ゲーム情報取得
  getState() {
    return {
      state: this.state,
      hands: this.hands,
      melds: this.melds,
      discards: this.discards,
      riichi: this.riichi,
      scores: this.scores,
      currentPlayer: this.currentPlayer,
      drawnTile: this.drawnTile,
      doraIndicators: this.wall.doraIndicators,
      doras: this.wall.getDoras(),
      remaining: this.wall.remaining,
      log: this.log,
      winResult: this.winResult,
      round: this.round,
      lastDiscard: this.lastDiscard,
      lastDiscardPlayer: this.lastDiscardPlayer,
    };
  }
}
