// game.js - ゲーム状態機械・進行管理

import { Wall } from './wall.js';
import { sortTiles, tileName, tilesEqual } from './tiles.js';
import { calcShanten, isWinningHand, getWinType } from './hand.js';
import { calcScore, calcPayments } from './scoring.js';
import { chooseDiscard, shouldRiichi, shouldPon, shouldKan } from './ai.js';

export const PLAYERS = 4;
export const SEATS   = ['南', '西', '北', '東'];

export const STATE = {
  PLAYER_ACTION: 'PLAYER_ACTION',
  WAIT_DISCARD:  'WAIT_DISCARD',
  CHECK_CLAIMS:  'CHECK_CLAIMS',
  CPU_TURN:      'CPU_TURN',
  WIN:           'WIN',
  DRAW_GAME:     'DRAW_GAME',
};

export class Game {
  constructor(onUpdate) {
    this.onUpdate  = onUpdate;
    this.scores    = [0, 0, 0, 0];
    this.round     = 0;
    this.pendingClaims = [];
    this._init();
  }

  _init() {
    this.wall          = new Wall();
    this.hands         = [[], [], [], []];
    this.melds         = [[], [], [], []];   // [{type, tiles, from}]
    this.discards      = [[], [], [], []];
    this.riichi        = [false, false, false, false];
    this.currentPlayer = 0;
    this.state         = STATE.PLAYER_ACTION;
    this.lastDiscard   = null;
    this.lastDiscardFrom = -1;
    this.drawnTile     = null;
    this.pendingClaims = [];
    this.log           = [];
    this.winResult     = null;

    const dealt = this.wall.deal(PLAYERS);
    for (let i = 0; i < PLAYERS; i++) this.hands[i] = sortTiles(dealt[i]);

    this.addLog('配牌完了');
    setTimeout(() => this._startTurn(0), 100);
  }

  // ====== ターン管理 ======

  _startTurn(playerIdx) {
    if (this.state === STATE.WIN || this.state === STATE.DRAW_GAME) return;

    this.currentPlayer = playerIdx;
    const tile = this.wall.draw();
    if (!tile) { this._drawGame(); return; }

    this.drawnTile = tile;
    this.hands[playerIdx].push(tile);

    if (playerIdx === 0) {
      this.state = STATE.PLAYER_ACTION;
      this.onUpdate('draw', { player: 0, tile });
    } else {
      this.state = STATE.CPU_TURN;
      this.onUpdate('draw', { player: playerIdx, tile });
      setTimeout(() => this._cpuTurn(playerIdx), 700);
    }
  }

  _cpuTurn(playerIdx) {
    if (this.state !== STATE.CPU_TURN) return;

    const hand    = this.hands[playerIdx];
    const closed  = this._closedTiles(playerIdx);
    const meldCnt = this.melds[playerIdx].length;
    const doras   = this.wall.getDoras();

    // ツモ和了
    if (isWinningHand([...closed, this.drawnTile].filter(t => t), meldCnt)) {
      if (isWinningHand(hand, meldCnt)) {
        this._win(playerIdx, 'tsumo', null);
        return;
      }
    }

    // 暗槓
    if (!this.riichi[playerIdx] && this.wall.kanCount < 4) {
      const kanTile = this._findAnkanTile(closed);
      if (kanTile && shouldKan(closed, kanTile, meldCnt)) {
        this._doAnkan(playerIdx, kanTile);
        return;
      }
    }

    // リーチ
    if (!this.riichi[playerIdx] && meldCnt === 0) {
      if (shouldRiichi(closed, 0)) {
        this._doRiichi(playerIdx);
        return;
      }
    }

    // 打牌
    const discard = chooseDiscard(hand, this._meldTilesFlat(playerIdx), doras, meldCnt);
    setTimeout(() => this._discard(playerIdx, discard), 400);
  }

  // ====== 手牌ユーティリティ ======

  _closedTiles(playerIdx) {
    const ids = new Set(this._meldTilesFlat(playerIdx).map(t => t.id));
    return this.hands[playerIdx].filter(t => !ids.has(t.id));
  }

  _meldTilesFlat(playerIdx) {
    return this.melds[playerIdx].flatMap(m => m.tiles);
  }

  _findAnkanTile(closedTiles) {
    const cnt = {};
    for (const t of closedTiles) {
      const k = t.suit + t.num;
      cnt[k] = (cnt[k] || 0) + 1;
    }
    for (const [k, n] of Object.entries(cnt)) {
      if (n >= 4) return closedTiles.find(t => t.suit + t.num === k);
    }
    return null;
  }

  // ====== アクション ======

  _doRiichi(playerIdx) {
    const doras   = this.wall.getDoras();
    const meldCnt = this.melds[playerIdx].length;
    const discard = chooseDiscard(
      this.hands[playerIdx],
      this._meldTilesFlat(playerIdx),
      doras, meldCnt
    );
    this.riichi[playerIdx] = true;
    this.addLog(`${SEATS[playerIdx]} リーチ！`);
    this._discard(playerIdx, discard);
  }

  _doAnkan(playerIdx, kanTile) {
    const closed   = this._closedTiles(playerIdx);
    const kanTiles = closed.filter(t => tilesEqual(t, kanTile));
    if (kanTiles.length < 4) return;

    for (const kt of kanTiles) {
      const idx = this.hands[playerIdx].findIndex(t => t.id === kt.id);
      if (idx !== -1) this.hands[playerIdx].splice(idx, 1);
    }
    this.melds[playerIdx].push({ type: 'ankan', tiles: kanTiles, from: playerIdx });

    const supp = this.wall.drawKan();
    if (supp) { this.drawnTile = supp; this.hands[playerIdx].push(supp); }

    this.addLog(`${SEATS[playerIdx]} 暗槓: ${tileName(kanTile)}`);
    this.onUpdate('kan', { player: playerIdx });

    if (playerIdx === 0) {
      this.state = STATE.PLAYER_ACTION;
      this.onUpdate('draw', { player: 0, tile: supp });
    } else {
      this.state = STATE.CPU_TURN;
      setTimeout(() => this._cpuTurn(playerIdx), 500);
    }
  }

  _discard(playerIdx, tile) {
    const idx = this.hands[playerIdx].findIndex(t => t.id === tile.id);
    if (idx === -1) return;

    this.hands[playerIdx].splice(idx, 1);
    this.discards[playerIdx].push(tile);
    this.lastDiscard     = tile;
    this.lastDiscardFrom = playerIdx;

    this.onUpdate('discard', { player: playerIdx, tile });

    this._checkClaims(playerIdx, tile);
  }

  _checkClaims(discardFrom, tile) {
    this.pendingClaims = [];

    for (let i = 0; i < PLAYERS; i++) {
      if (i === discardFrom) continue;
      const meldCnt = this.melds[i].length;

      // ロン（韓麻はフリテン制限なし）
      const testHand = [...this.hands[i], tile];
      if (isWinningHand(testHand, meldCnt)) {
        this.pendingClaims.push({ type: 'ron', player: i });
      }

      // ポン・カン（リーチ中は不可）
      if (!this.riichi[i]) {
        const closed = this._closedTiles(i);
        const same   = closed.filter(t => tilesEqual(t, tile)).length;
        if (same >= 3 && this.wall.kanCount < 4) {
          this.pendingClaims.push({ type: 'minkan', player: i });
        } else if (same >= 2) {
          this.pendingClaims.push({ type: 'pon', player: i });
        }
      }
    }

    this.state = STATE.CHECK_CLAIMS;
    this.onUpdate('claims', { claims: this.pendingClaims });
    this._resolveClaims(discardFrom, tile);
  }

  _resolveClaims(discardFrom, tile) {
    // ロン優先：下家→対面→上家
    const rons = this.pendingClaims.filter(c => c.type === 'ron');
    if (rons.length > 0) {
      const priority = [1, 2, 3].map(n => (discardFrom + n) % 4);
      for (const p of priority) {
        if (rons.some(r => r.player === p)) {
          if (p === 0) {
            // プレイヤーに選択権（UI のロンボタンを有効化）
            this.onUpdate('can_ron', { tile, from: discardFrom });
            return;
          }
          this._win(p, 'ron', discardFrom);
          return;
        }
      }
    }

    // ポン・カン：プレイヤー優先
    const melders = this.pendingClaims.filter(c => c.type === 'pon' || c.type === 'minkan');
    if (melders.length > 0) {
      if (melders.some(c => c.player === 0)) {
        this.onUpdate('can_pon', { tile, from: discardFrom });
        return;
      }
      // CPU は下家→対面→上家順に判断
      const priority = [1, 2, 3].map(n => (discardFrom + n) % 4);
      for (const p of priority) {
        const claim = melders.find(c => c.player === p);
        if (claim) {
          const closed  = this._closedTiles(p);
          const meldCnt = this.melds[p].length;
          if (shouldPon(closed, tile, this.wall.getDoras(), meldCnt)) {
            this._doPon(p, discardFrom, tile, claim.type);
            return;
          }
        }
      }
    }

    this._nextPlayer(discardFrom);
  }

  _doPon(playerIdx, fromIdx, tile, type) {
    const needed = type === 'minkan' ? 3 : 2;
    let removed  = 0;
    const removedTiles = [];

    for (let i = this.hands[playerIdx].length - 1; i >= 0 && removed < needed; i--) {
      const t = this.hands[playerIdx][i];
      const isInMeld = this._meldTilesFlat(playerIdx).some(m => m.id === t.id);
      if (!isInMeld && tilesEqual(t, tile)) {
        removedTiles.push(t);
        this.hands[playerIdx].splice(i, 1);
        removed++;
      }
    }

    this.melds[playerIdx].push({
      type,
      tiles: [...removedTiles, tile],
      from:  fromIdx,
    });

    this.addLog(`${SEATS[playerIdx]} ${type === 'minkan' ? 'カン' : 'ポン'}: ${tileName(tile)}`);

    if (type === 'minkan') {
      const supp = this.wall.drawKan();
      if (supp) { this.drawnTile = supp; this.hands[playerIdx].push(supp); }
      this.onUpdate('kan', { player: playerIdx });
      if (playerIdx === 0) {
        this.currentPlayer = 0;      // ★ 修正
        this.state = STATE.PLAYER_ACTION;
        this.onUpdate('draw', { player: 0, tile: supp });
      } else {
        this.state = STATE.CPU_TURN;
        setTimeout(() => this._cpuTurn(playerIdx), 500);
      }
    } else {
      this.onUpdate('pon', { player: playerIdx, tile });
      if (playerIdx === 0) {
        this.currentPlayer = 0;      // ★ 修正：ポン後に自分が捨てられるよう
        this.state = STATE.WAIT_DISCARD;
        this.onUpdate('need_discard', {});
      } else {
        this.state = STATE.CPU_TURN;
        setTimeout(() => {
          const meldCnt = this.melds[playerIdx].length;
          const d = chooseDiscard(
            this.hands[playerIdx],
            this._meldTilesFlat(playerIdx),
            this.wall.getDoras(),
            meldCnt
          );
          this._discard(playerIdx, d);
        }, 500);
      }
    }
  }

  // ====== プレイヤー操作 ======

  playerDiscard(tile) {
    if (this.currentPlayer !== 0) return;
    if (this.state !== STATE.PLAYER_ACTION && this.state !== STATE.WAIT_DISCARD) return;
    // リーチ中はツモ切りのみ
    if (this.riichi[0] && this.drawnTile && tile.id !== this.drawnTile.id) return;
    this._discard(0, tile);
  }

  playerTsumo() {
    if (this.state !== STATE.PLAYER_ACTION) return;
    const meldCnt = this.melds[0].length;
    if (!isWinningHand(this.hands[0], meldCnt)) return;
    this._win(0, 'tsumo', null);
  }

  playerRiichi() {
    if (this.state !== STATE.PLAYER_ACTION) return;
    if (this.riichi[0] || this.melds[0].length > 0) return;
    const closed = this._closedTiles(0);
    if (calcShanten(closed, 0) !== 0) return;
    this.riichi[0] = true;
    this.addLog('あなた リーチ！');
    this.state = STATE.WAIT_DISCARD;
    this.onUpdate('riichi', { player: 0 });
  }

  playerRon() {
    if (this.state !== STATE.CHECK_CLAIMS) return;
    if (!this.pendingClaims.some(c => c.player === 0 && c.type === 'ron')) return;
    this._win(0, 'ron', this.lastDiscardFrom);
  }

  playerPon() {
    if (this.state !== STATE.CHECK_CLAIMS) return;
    const claim = this.pendingClaims.find(
      c => c.player === 0 && (c.type === 'pon' || c.type === 'minkan')
    );
    if (!claim) return;
    this._doPon(0, this.lastDiscardFrom, this.lastDiscard, claim.type);
  }

  playerPass() {
    if (this.state !== STATE.CHECK_CLAIMS) return;
    this.pendingClaims = [];
    this._nextPlayer(this.lastDiscardFrom);
  }

  // ====== 和了・流局 ======

  _win(winnerIdx, winType, fromIdx) {
    const meldCnt = this.melds[winnerIdx].length;
    const hand    = [...this.hands[winnerIdx]];
    if (winType === 'ron') hand.push(this.lastDiscard);

    const doras    = this.wall.getDoras();
    const uraDoras = this.wall.getUraDoras();
    const isRiichi = this.riichi[winnerIdx];

    const scoreResult = calcScore({
      winType, handTiles: hand, isRiichi,
      doras, uraDoras, isRiichiWin: isRiichi, meldCount: meldCnt,
    });

    const { payments, winnerGain } = calcPayments(
      scoreResult.total, winType, PLAYERS, fromIdx, winnerIdx
    );

    for (const [p, pay] of Object.entries(payments)) this.scores[Number(p)] -= pay;
    this.scores[winnerIdx] += winnerGain;

    this.winResult = {
      winner: winnerIdx, winType, from: fromIdx,
      score: scoreResult, payments, winnerGain,
      hand, doras,
      uraDoras: isRiichi ? uraDoras : [],
      winTypeName: getWinType(hand, meldCnt),
    };

    this.addLog(`${SEATS[winnerIdx]} ${winType === 'ron' ? 'ロン' : 'ツモ'}和了！ ${scoreResult.total}点`);
    this.state = STATE.WIN;
    this.onUpdate('win', this.winResult);
  }

  _drawGame() {
    this.addLog('流局');
    this.state = STATE.DRAW_GAME;
    this.onUpdate('draw_game', {});
  }

  _nextPlayer(currentIdx) {
    const next = (currentIdx + 1) % PLAYERS;
    setTimeout(() => this._startTurn(next), 300);
  }

  nextRound() {
    this.round++;
    this._init();
  }

  addLog(msg) {
    this.log.unshift(msg);
    if (this.log.length > 50) this.log.pop();
  }

  getState() {
    return {
      state: this.state, hands: this.hands, melds: this.melds,
      discards: this.discards, riichi: this.riichi, scores: this.scores,
      currentPlayer: this.currentPlayer, drawnTile: this.drawnTile,
      doraIndicators: this.wall.doraIndicators, doras: this.wall.getDoras(),
      remaining: this.wall.remaining, log: this.log,
      winResult: this.winResult, round: this.round,
      lastDiscard: this.lastDiscard, lastDiscardFrom: this.lastDiscardFrom,
      pendingClaims: this.pendingClaims,
    };
  }
}
