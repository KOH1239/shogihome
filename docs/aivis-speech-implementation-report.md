# AIVIS Speech（Cloud API / ストリーミング）実装レポート

作成日: 2026-04-10

## 1. 概要

FastAPI からストリーミングで返ってくる将棋解説テキストを、Electron アプリ上で受信しながら **AIVIS Speech（Cloud API のストリーミング応答）**で読み上げる機能を追加した。

本実装は「テキストストリーミング表示」＋「音声ストリーミング再生」を組み合わせ、解説が届いた瞬間から順次読み上げることを目的とする。

## 2. 要件（合意事項）

- 対象は **Electron（ネイティブ）版のみ**
  - ブラウザ版は対象外（MediaSource / オーディオ制約やキー取り扱いを分離するため）
- 「解説が届いてから全文を読む」ではなく、**受信中に逐次読み上げ**する
- 操作画面に **停止ボタン**を用意する

## 3. 実装した機能

### 3.1 設定項目（AppSettings）

AppSettings に AIVIS 用の設定を追加した。

- `aivisSpeechEnabled: boolean`
- `aivisApiKey?: string`
- `aivisModelUuid?: string`

デフォルトは `aivisSpeechEnabled: false`（OFF）。

関連箇所:

- `src/common/settings/app.ts`
- `src/renderer/store/settings.ts`
- `src/renderer/view/dialog/AppSettingsDialog.vue`

### 3.2 設定 UI（アプリ設定ダイアログ）

アプリ設定（`AppSettingsDialog`）に以下を追加した。

- トグル: **AIVIS Speech**（ON/OFF）
- パスワード入力: **AIVIS API Key**
- テキスト入力: **AIVIS model_uuid**

※ API Key は input type=password で UI 上はマスクされるが、保存自体は AppSettings（JSON）に含まれる。

### 3.3 テキスト分割（ストリーミング読み上げ向け）

ストリーミングで到着する「短い断片」を、そのまま 1 回の TTS に投げると不自然になりやすいため、
「ある程度たまったら文や改行単位で区切って発話する」ためのインクリメンタル分割器を追加した。

- 実装: `src/renderer/devices/tts/textSegmenter.ts`
- 主要 API:
  - `push(delta): string[]` … 追記された差分から、発話可能なまとまりができたら配列で返す
  - `flush(): string[]` … 残りをすべて吐き出す（ストリーム終了時など）
  - `reset()`
- 分割ルール（要点）:
  - 優先: 改行 `\n`
  - 次点: 文末記号 `。．.!！？?`
  - `minChars`（既定 20）未満の短文は基本的に保留
  - `maxChars`（既定 200）超過時は強制カット

### 3.4 AIVIS Speech ストリーミング再生（MP3 + MediaSource）

AIVIS Cloud API の `POST /v1/tts/synthesize` はレスポンスボディが音声バイト列をストリームするため、
受信した音声チャンクを `MediaSource + SourceBuffer` に逐次 append して早期再生する。

- 実装: `src/renderer/devices/tts/aivisSpeechPlayer.ts`
- 方式:
  - `fetch()` で音声ストリームを受信
  - `MediaSource` を作成し `SourceBuffer('audio/mpeg')` を追加
  - `ReadableStreamDefaultReader.read()` で得た `Uint8Array` を `appendBuffer()`
  - `audio.play()` を可能な限り早期に呼び、到着分から再生
- 送信パラメータ（要点）:
  - `output_format: 'mp3'`（SourceBuffer を `audio/mpeg` で扱う）
  - `leading_silence_seconds: 0.0`
  - `trailing_silence_seconds: 0.1`
  - `language: 'ja'`
- キュー処理:
  - `enqueue(text)` でセグメントを FIFO キューに積む
  - 1 セグメントずつ `playSegmentStreaming()` を直列実行
- 停止処理:
  - `stop()` でキューをクリアし、`AbortController.abort()` で in-flight の音声取得を中断
  - `HTMLAudioElement.pause()` + `src=''` + `URL.revokeObjectURL()` でリソース解放を促進
- 安全性:
  - エラーはアプリ全体を落とさない方針（console.warn のみに留め、以降のTTSは止める）
  - `AbortError` はユーザー停止や新規質問時の正常系として扱う

## 4. 画面統合（Question タブ）

### 4.1 Stop ボタン

`QuestionView` の入力行に停止ボタンを追加した。

- 表示条件: `isNative()` かつ `aivisSpeechEnabled` が ON
- 押下時: 現在の音声取得/再生を停止し、キューをクリア
- 非活性: 再生中（busy）でない場合は disabled

### 4.2 解説ストリーム → 読み上げの接続

`QuestionView` 側で FastAPI のストリーミングを読み取り、解説本文の delta を `TextSegmenter` に流し込み、
確定したセグメントを `AivisSpeechPlayer.enqueue()` で順次読み上げる。

- ストリーム中:
  - `rec.explanation` / `rec.content`（文字列）を検出した場合、その delta を読み上げキューへ
  - `type: 'metadata'` は UI の `similar_comments` 収集のみで、読み上げ対象から除外
- ストリーム終了後:
  - `flushTTS()` でバッファ残りを読み上げに回す
- 新規質問時:
  - まず `ttsPlayer.stop()` を呼んで前の発話を即停止
  - その後、そのリクエスト用に `ttsPlayer.configure({ apiKey, modelUuid })`

関連箇所:

- `src/renderer/view/tab/QuestionView.vue`

## 5. 変更ファイル一覧

- `src/common/settings/app.ts`
  - AppSettings に AIVIS 設定（enabled / apiKey / modelUuid）追加、デフォルト OFF
- `src/renderer/store/settings.ts`
  - 上記設定の getter 追加（renderer 側参照用）
- `src/renderer/view/dialog/AppSettingsDialog.vue`
  - 設定 UI（トグル + API key + model_uuid）追加
  - `reverseFormat()` / watch の temporary update に反映
- `src/renderer/devices/tts/textSegmenter.ts`（新規）
  - ストリーミング delta を発話単位へまとめる分割器
- `src/renderer/devices/tts/aivisSpeechPlayer.ts`（新規）
  - AIVIS Cloud API のストリーミング TTS を MP3/MediaSource で再生するプレイヤ
- `src/renderer/view/tab/QuestionView.vue`
  - Stop ボタン追加
  - ストリーミング解説テキストの delta を TTS キューへ接続

## 6. 動作確認（推奨）

- 型チェック/リンティング: `npm run lint`
- Electron 起動（開発）: `npm run electron:serve`

確認観点:

- AIVIS Speech ON + API Key/model_uuid 設定済みで、解説が届くにつれ順次読み上げる
- 「停止」を押すと即座に音声が止まり、以後のキューが消える
- 新しく質問すると、前の読み上げが止まり新しい解説の読み上げに切り替わる

## 7. 制約・注意点

- **API Key の保存**
  - 現状は AppSettings の保存形式（JSON）に含まれる。
  - UI は password 表示だが、ストレージ上の秘匿までは保証しない。
  - セキュリティ要件が上がる場合は、Electron の safeStorage 等への移行を検討する。

- **ブラウザ版の非対応**
  - 本実装は `isNative()` を条件にしており、ブラウザでは読み上げ UI を出さない。

- **音声フォーマット**
  - `SourceBuffer('audio/mpeg')` 前提で MP3 を使用。
  - もし環境依存で `MediaSource` が使えない場合は例外として扱い、TTS を停止する。

## 8. 今後の改善案（任意）

- model_uuid の手入力を減らす（モデル一覧取得・選択 UI）
- API Key の安全な保存（OS 暗号化ストレージの利用）
- 詳細な音声パラメータ（話速/ピッチ/スタイル等）の設定 UI
