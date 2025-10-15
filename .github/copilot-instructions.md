## 目的
このリポジトリで作業する AI コーディングエージェント向けの短いガイドです。
以下は、素早く生産的になるためのプロジェクト固有の知識と具体例をまとめたものです。

## ビッグピクチャ
- アプリは Electron + Vue 3（レンダラー）で構成されています。バックグラウンド（main）プロセスは `src/background`、レンダラは `src/renderer`、CLI ツールやコマンドは `src/command` 配下にあります。
- フロントエンドは Vite を使って開発・ビルドされ、Electron 用バンドルは Webpack を使ったビルドパスがあります（`package.json` のスクリプト参照）。

## 重要なファイルとディレクトリ（参照先）
- `package.json` : 主要スクリプト（`npm run serve`, `npm run electron:serve`, `npm run build`, `npm run electron:build`）と依存関係。
- `src/renderer/ipc/preload.ts` : レンダラがアクセスするブリッジAPIを `window.electronShogiAPI` として公開している。多くの機能（USI/CSA セッション、設定ロード/保存、ファイルダイアログ、プロンプト呼び出し）はここを通して行われる。
- `src/common/ipc/channel.ts` : IPC チャネル名の定義。バックグラウンド↔レンダラ間の全メッセージが列挙されているため、新しいメッセージを追加する際はここを更新する。
- `src/renderer/ipc/bridge.ts` : `electronShogiAPI` の TypeScript インターフェース。関数の型と使い方のリファレンスになる。
- `src/command/usi-csa-bridge/README.md` : CLI ツール（USI↔CSA ブリッジ）のビルド/使用方法。

## 通信パターンと注意点
- レンダラからバックグラウンドへは `ipcRenderer.invoke`（Promise で結果）や `ipcRenderer.send`（イベント送信）を使っている。`preload.ts` を経由して `window.electronShogiAPI` を呼ぶのが標準パターン。
- プロンプト／LLM 関連は `setupPrompt`, `openPrompt`, `invokePromptCommand`, `onPromptCommand` で実装されている（例: `invokePromptCommand` を呼ぶと Background 側に `INVOKE_PROMPT_COMMAND` が送られる）。
- 新しい IPC チャネルを追加する場合は、①`src/common/ipc/channel.ts` に定義、②`src/renderer/ipc/preload.ts` に実装、③バックグラウンド側でハンドラ実装、の順で行う。

## ビルド・開発ワークフロー（重要）
- 開発用ブラウザホットリロード: `npm run serve` → http://localhost:5173
- Electron 開発（コンパイル＋ライブ）: `npm run electron:serve`（内部で vite + electron を同時実行）
- 本番ビルド（Web）: `npm run build`（PWA 設定ありは `vite.config-pwa.mts` を使用）
- Electron ビルド: `npm run electron:build`（`electron:pack` → スクリプトでパッケージング）
- CLI ビルド（usi-csa-bridge）: `npm run usi-csa-bridge:build` / `npm run usi-csa-bridge:install`

## コードベースの慣習・パターン
- TypeScript + ESM モジュール。プロジェクトは `type: module` を使っており、`import` が推奨。
- Vue コンポーネントは `src/renderer/view` 以下にあり、Composition API（script setup）を使う箇所が多い。
- IPC 呼び出しは文字列でチャンネルを指定する代わりに `src/common/ipc/channel.ts` の enum を使うのが慣例。

## 具体的な例（よくある変更）
- 新しいボタンを作り、バックグラウンド操作を呼ぶ場合:
  1. `channel.ts` に新しい Background 名を追加。
  2. `preload.ts` に対応するメソッド（Promise または void）を追加し `contextBridge.exposeInMainWorld` 経由で公開。
  3. `src/background` にハンドラを追加して `ipcMain.handle` / `ipcMain.on` を登録。

## テスト・リンティング
- 単体テストは Vitest を使用。`npm test` で実行。
- Lint/型チェック: `npm run lint`（`vue-tsc --noEmit` を含む）。変更時はこのコマンドで回帰を確認する。

## 追加メモ（AI 向けの実務ヒント）
- UI の変更はレンダラ側のみで済むことが多いが、永続化やファイル操作が絡む場合は必ず `preload.ts` → `background` の流れを確認する。
- `preload.ts` に存在するメソッド名と `channel.ts` の列挙はソース上の“契約”なので、API 変更は慎重に扱う。
- 不明点は `README.md` と `src/command/usi-csa-bridge/README.md` を参照して実行コマンドや設計意図を確認する。

---
もしこの案内で不足している箇所（例えば特定のビルド環境や CI の詳しい手順）があれば教えてください。追記してマージします。
