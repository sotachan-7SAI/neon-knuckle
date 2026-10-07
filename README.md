# NEON KNUCKLE ネオンナックル ― 5億年商店街の乱

VRM のキャラと 2 人で「5億年」を殴り進む、ブラウザで遊べるベルトスクロールアクションです。

**遊ぶ → https://sotachan-7sai.github.io/neon-knuckle/**

- 全 5 面。相棒（Claude 役）は決まった動きとセリフで戦います（声なし・AI なし）
- 共闘（CO-OP）と、1 対 1 の対戦（VERSUS）
- タイトルの「自分の VRM」から、手持ちの `.vrm` を読みこんで遊べます。ファイルはブラウザの中だけで使い、どこにも送りません
- パソコン（Chrome / Edge / Firefox / Safari）は、キーボードかゲームパッドで操作します
- スマホ・タブレットは、横向きにして画面のスティックとボタンで操作します（iPhone は iOS 16.4 以降の Safari）

## 操作

| キー | 動き |
| --- | --- |
| ← → ↑ ↓ / WASD | 移動（←← →→ で走る） |
| J | 攻撃・武器を拾う |
| K | ジャンプ |
| L | 必殺 |
| U | 波動（長押しで溜め）・武器を投げる |
| H | 連携技（ゲージ 1 本） |
| Y | 超必殺（ゲージ 3 本） |
| I | よける |
| O | ガード |
| Esc | ポーズ |

タイトルで数字の 1〜5 を押すと、その面から始まります。

スマホでは、画面の左側をさわるとスティックになります（同じ向きへすばやく 2 回たおすと走る）。右側に 攻撃・跳ぶ・必殺・波動・よけ・ガード・連携・超必殺 のボタンが出ます。

## 使っているもの

- [three.js](https://threejs.org/)（MIT）
- [@pixiv/three-vrm](https://github.com/pixiv/three-vrm)（MIT）
- モーション: A&M Mocap Motion Series
- 効果音: Universal Sound FX、Game Sound FX Pack
- 文字: Google Fonts（Bungee / Chakra Petch / Dela Gothic One / Noto Sans JP）

## ご注意

このリポジトリは、ゲームを動かすためのものです。キャラクターのモデル（`vrm/`）、モーションと効果音のデータ（`data/`）は、
このゲームの中で使うためだけに置いています。取り出して別の用途に使うこと、再配布することはできません。
