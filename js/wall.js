// wall.js - 牌山管理（シャッフル・配牌・ドラ）

import { createTileSet, getDoraFromIndicator } from './tiles.js';

export class Wall {
  constructor() {
    this.reset();
  }

  reset() {
    const all = createTileSet();
    // Fisher-Yates シャッフル
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }

    // 王牌: 末尾14枚
    this.deadWall = all.splice(all.length - 14, 14);
    this.tiles = all; // 残り122枚が通常の牌山

    this.drawIndex = 0;
    this.kanCount = 0; // 卓全体のカン回数

    // ドラ表示牌: 王牌の0,1番目（2枚）
    this.doraIndicators = [this.deadWall[0], this.deadWall[1]];
    // 裏ドラ表示牌: 王牌の2,3番目（2枚）
    this.uraDoraIndicators = [this.deadWall[2], this.deadWall[3]];
    // カン用補充牌: 王牌の4〜7番目
    this.kanDrawTiles = this.deadWall.slice(4, 8);
    this.kanDrawIndex = 0;
  }

  /** 残り牌数 */
  get remaining() {
    return this.tiles.length - this.drawIndex;
  }

  /** 牌を1枚ツモ */
  draw() {
    if (this.drawIndex >= this.tiles.length) return null;
    return this.tiles[this.drawIndex++];
  }

  /** カン後の補充牌 */
  drawKan() {
    if (this.kanCount >= 4 || this.kanDrawIndex >= this.kanDrawTiles.length) return null;
    this.kanCount++;
    return this.kanDrawTiles[this.kanDrawIndex++];
  }

  /** 現在有効なドラ一覧（牌オブジェクト）*/
  getDoras() {
    return this.doraIndicators.map(getDoraFromIndicator);
  }

  /** 裏ドラ一覧（リーチ和了時のみ公開）*/
  getUraDoras() {
    return this.uraDoraIndicators.map(getDoraFromIndicator);
  }

  /** 配牌: 各プレイヤーに13枚ずつ配る */
  deal(playerCount = 4) {
    const hands = Array.from({ length: playerCount }, () => []);
    for (let i = 0; i < 13; i++) {
      for (let p = 0; p < playerCount; p++) {
        hands[p].push(this.draw());
      }
    }
    return hands;
  }
}
