# KUMI ローカル一括出力

KUMI のネイティブ HTML 出力・Markdown 保存・単体文書 ZIP を Node.js から実行します。1つの Report または Slide を、編集データ入り HTML、`.kumi.json`、Markdown、`.kumi.zip` と参照素材へまとめて保存できます。用紙サイズ、テーマ、改ページは原稿の設定を使います。

## 準備

Node.js 22.13.0 以降を使用します。このフォルダーの依存物だけで実行でき、`web/node_modules` は不要です。

```sh
cd local_renderer
npm ci --ignore-scripts --no-audit --no-fund
```

ページ検査を使う場合は、最初に Chromium もインストールします。

```sh
npm run install:browser
```

各実行で現在の `../web` のソース・CSS・数式フォントを独立した一時バンドルにビルドするため、ソース更新後の手動再ビルドは不要です。`npm run build` でも `.cache/kumi-api.mjs` を作れますが、CLI はこの固定キャッシュを再使用しません。

## 一括出力

```sh
node render.mjs --input /path/to/report.kumi.json --output-dir /path/to/output --check-layout
```

`--input` はネイティブ文書 JSON（v1/v2）または KUMI Markdown（`.md` / `.markdown`）です。入力名から `.kumi.json`、`.json`、`.md` 等を除いた名前で次を保存します。`--name report` で出力名を指定できます。

| ファイル                     | 内容                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| `report.html`                | ネイティブ CSS・数式フォント・画像・編集データを埋め込んだ HTML |
| `report.kumi.json`           | 検証・移行した文書 JSON                                         |
| `report.md`                  | KUMI の標準シリアライザーによる Markdown                        |
| `report.kumi.zip`            | ネイティブ単体文書アーカイブ。画像・PDF原本を含む               |
| `report.layout.json`         | `--check-layout` 指定時のページ別検査結果                       |
| 原稿に記載した相対パスの素材 | JSON / Markdown の再読込に必要な画像・PDF原本のコピー           |

HTML と ZIP は単体で受け渡せます。JSON / Markdown は、出力先へ複写された素材も同じフォルダー構成で保持してください。入力は変更しません。入力ファイルと同じ名前になる出力先は避け、別フォルダーを指定してください。

画像・PDF原本は入力ファイルのフォルダーを基準に読みます。素材の基準が異なる場合は `--assets-dir /path/to/assets-root` を指定します。相対参照だけを受け付け、ルート外への `..` やシンボリックリンク経由の参照を拒否します。外部 URL の画像は取得せずエラーにします。ネイティブ文書で許可される画像 data URL はそのまま保持します。

ネイティブ上限（原稿 5 MiB、素材1件 20 MiB、素材合計 50 MiB、ZIP のファイル数・容量制限）を適用します。ZIP 出力はネイティブ読込処理で文書と全素材の一致を確認してから保存します。編集図解・SVG の出力には DOM 環境を用意し、ブラウザーと同じ SVG 検証・描画処理を使います。

## ページ検査

```sh
node render.mjs --input /path/to/report.md --output-dir /path/to/output --fail-on-overflow
```

`--check-layout` は生成した HTML をローカルの headless Chromium で開き、フォント・画像の読込後に、HTML 内の共通検査関数 `window.kumiInspectDocumentLayout()` を呼びます。ネットワーク要求は遮断します。Report は明示ページ、Slide はすべてのスライドを原寸で検査します。表示するページ番号は1から始まります。

検査 JSON の `pages` に、ページ種別・実寸・用紙寸法と、縦横のはみ出しやスクロール領域内の隠れた内容を記録します。単位は CSS px、許容差は 2 px です。検査対象の要素を特定できる場合は `nodeId` も含めます。HTML の Report 警告と同じ検査処理を使用します。

- `--check-layout`：はみ出しがあっても成果物と結果を保存し、終了コード 0。
- `--fail-on-overflow`：検査を有効にし、はみ出しがある場合も成果物と結果を保存して終了コード 2。
- `--check-out /path/to/check.json`：検査を有効にして、結果の保存先を指定。
- 画像の読込失敗、未計測ページ、ブラウザー起動失敗など：終了コード 1。成果物の保存は開始しません。

これは指定した Chromium・ローカルフォント環境での測定です。自動改ページ後の印刷ページ数や、別ブラウザー・プリンタでの組版を保証するものではありません。検査結果にはブラウザー版と viewport を記録します。最終配布時は印刷プレビューも確認してください。

## 既存の個別出力コマンド

従来の引数も使用できます。`--output-dir` と個別出力パスは同時に指定できません。

```sh
node render.mjs --input /path/to/report.json --output /path/to/report.html --json-out /path/to/normalized.json --markdown-out /path/to/report.md --zip-out /path/to/report.kumi.zip
```

`--locale ja`（既定）または `--locale en` で HTML の操作表示を指定します。`--check-layout` と `--check-out` も使用できます。個別モードで `--check-out` を省略した検査結果は標準出力の JSON に含まれます。個別モードは素材を複写しないため、JSON / Markdown の保存先を変える場合は素材の相対パスも維持してください。

既存の連携処理との互換として、JSON 入力に対して **個別モードで明示的に `--json-out` を同じ入力ファイルへ指定した場合だけ**、全出力・検査が成功してから入力を正規化した JSON へ置き換えます。他の入力・素材への上書き、出力先同士の重複、ディレクトリやシンボリックリンクへの出力は拒否します。

すべての出力内容を生成・検証してから、各出力先の一時ファイルへ書き込みます。保存途中のエラーでは以前のファイルを復元します。既存成果物は上書きされます。強制終了・停電や同じ出力先への同時実行を跨ぐトランザクションではないため、同一の出力先への並行実行は避けてください。

正常な出力・はみ出し判定は標準出力へ JSON、入力・実行エラーは標準エラーへ `{ "ok": false, "error": "..." }` を返します。`--help` は操作説明を表示します。

## 検証

```sh
npm test
npm run test:layout
```

前者は CLI 引数、旧コマンド互換、Report / Slide / 編集 SVG、ネイティブ ZIP 往復、JSON / Markdown と素材の再利用、入力保護・保存失敗の確認です。後者は Chromium による複数ページ、ページ番号付きはみ出し、画像・切抜き図の読込検査です。

章別プロジェクト ZIP / HTML の入力、複数原稿の manifest 一括処理、PDF / Word / PowerPoint の CLI 出力はこの入口の対象外です。章別管理やそれらの出力は Web アプリを使用してください。単体文書の JSON 仕様は `../web/src/document/model.ts` / `validation.ts`、ZIP 仕様は `../web/src/workspace/document-archive.ts` が正本です。
