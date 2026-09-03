# KUMI — Markdown Report / Slide Editor

技術レポートとプレゼンテーションを、同じMarkdown／Document Modelから編集するWebアプリです。共通基盤に加え、LaTeX風の番号付け・相互参照・目次と明示的なページ／スライド区切りを実装しています。TeXエンジンではなく、MarkdownとKaTeXを使用します。

## 公開版

GitHub Pagesを有効にすると、[公開版](https://takayuki-minagawa.github.io/app-Report-Slide/) を利用できます。`main` への更新は自動的に静的サイトとして公開されます。

## 公開リポジトリとしての注意

- リポジトリのソース、Issues、Pull Requests、コミットメッセージ、GitHub Actionsのログ、およびGitHub Pagesで公開する内容は第三者から閲覧できる前提で扱ってください。
- 顧客情報、個人情報、社外秘のレポート、アクセストークン、パスワードなどは、リポジトリにも公開サイトにも追加しないでください。
- GitHub Pages版は静的サイトです。文書や画像をImportしても、このリポジトリやGitHub Pagesへ自動アップロードされることはありません。ただし、端末やエクスポートしたファイルの取り扱いは所属組織の規程に従ってください。

## 主な機能

- Report／SlideのYAML Front Matter判定
- Tiptapによる見出し、段落、リスト、引用、コード、画像、表の編集
- KaTeXによるインライン／ブロック数式
- MarkdownファイルのImportと、Markdown／Document JSONの保存
- Reportの章別プロジェクト（追加・並べ替え・除外・削除、章単位の編集、画像を含むZIP保存・再読込）
- Slide文書の単一HTML出力（スライド送り、全画面表示、数式フォント・取り込んだ画像の埋め込み）
- Report／Slide向けの基本テーマと完成プレビュー
- 3ペイン構成のNavigator、Editor、Properties
- Undo／Redo、Markdown直接編集、破損入力を適用しないエラー処理
- ヘッダーから切り替えられるライト／ダークモード、日本語／英語の操作画面、アプリ内かんたんガイド

## 文書機能

- 図・表・式のキャプション、安定した参照ラベル、自動番号付け
- 見出し階層の節番号、リンク付き目次、前方参照・重複／未解決参照の警告
- 図の幅（10〜100%）・配置・代替テキストをPropertiesで編集し、Markdownでも保持
- 明示的な改ページと複数スライドのプレビュー、ページ／スライド番号
- Document JSON v1／v2のImport、v2への非破壊移行
- 有効な章を通した目次・番号・相互参照と、ページを切り替える全体プレビュー

使い方・構文・制限は [文書機能ガイド](./web/docs/document-features.md) を参照してください。最初の操作は [かんたんガイド（日本語）](./web/docs/quick-start.ja.md) / [Quick guide (English)](./web/docs/quick-start.en.md) にまとめています。元の全体仕様は [仕様書](./md_report_slide_editor_web_spec.md) にあります。自動ページ割り、厳密なA4組版、PDF出力、ReportのHTML出力、脚注・文献、段組み、Chart、TeXファイル互換はまだ未実装です。

## 長いレポートの章別管理

Reportを開いて左側の「現在のReportをプロジェクト化」を選ぶと、現在の文書を最初の章として管理できます。章ごとに原稿を追加・編集し、出力順序、出力への含有、章の前の改ページを設定できます。除外した章は保存され、削除は確認後にプロジェクト内だけで行います。

「プロジェクトZIPを保存」で `project.json`、章別Markdown（必要に応じてJSON）、取り込んだ画像を保存します。再開時はZIPを読み込みます。全体のMarkdown／JSON出力は有効な章を結合した文書であり、章構成や除外原稿を保存する形式ではありません。ヘッダーの保存は編集中の章だけが対象です。

未保存の作業は端末内の復旧用コピーとして一時保存され、次回起動時に復元するか選べます。これはクラウド保存でも正式な原本でもないため、タブを閉じる前にZIPを保存してください。編集画面は選択した章だけ、プロジェクトの完成プレビューは選択した明示的なページだけを描画します。用紙サイズに応じた自動改ページは行いません。形式・上限・画像の扱いは [章別プロジェクトガイド（日本語）](./web/docs/report-projects.ja.md) / [Chapter projects (English)](./web/docs/report-projects.en.md) を参照してください。

## HTMLスライドの出力

Slide文書を開き、ヘッダーの **HTML** を押すと、閲覧・発表用の `.html` ファイルを保存できます。ブラウザで開き、前へ／次へボタン、矢印キー、Spaceでスライドを送ります。Fキーで全画面表示に切り替えられます（対応ブラウザのみ）。操作表示は出力時の日本語／英語設定に従います。

数式用フォントと取り込んだ画像をファイルに含めるため、これらはオフラインでも表示できます。外部URLの画像はリンクのままで、表示には通信が必要です。未取り込みのローカル画像があれば出力を止めて案内します。HTMLは編集用の保存形式ではなく、未保存状態やMarkdown下書きは変えません。編集を再開するために **Markdown／JSONも別途保存** してください。

## 開発

Node.js 22.13.0以上が必要です。推奨バージョンは `web/.node-version` と `web/.nvmrc` に固定しています。

```bash
cd web
npm ci
npm run dev
```

開発サーバーは通常 `http://localhost:3000` で起動します。

## 品質チェック

```bash
cd web
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actionsでも同じゲートを実行します。

### GitHub Pagesの運用

`.github/workflows/deploy-pages.yml` はPull Requestで静的エクスポートを検証し、`main` へのpush時だけGitHub Pagesへデプロイします。GitHub Pagesが未設定のリポジトリでは、初回だけ **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選択してください。公開URLやリポジトリ配下のパスは、ワークフローがGitHub Pagesの設定から自動的に反映します。

## 設計

ビジュアル編集の本文はTiptap／ProseMirror JSONで管理します。React stateは文書種別・Front Matterとプレビュー用の同期スナップショットを保持し、保存時にエディタの最新本文から `DocumentData` を作ります。未適用のMarkdown原稿は別の下書きとして保持します。

```text
Markdown
  ↕ parser / canonical serializer
DocumentData envelope
  ↕ Tiptap JSON-compatible nodes
Tiptap editor
  → Report / Slide preview
```

Runtime validatorはNode型、必須属性、親子関係、既知metadata型、URL、`nodeId`の非空・一意性を確認します。Markdownで表現できない表構造は黙って欠落させず、typed errorとして保存を止めます。

実装の責務は次のように分けています。

- `web/components/editor/`: 画面構成、文書操作フック、選択・属性編集フック、および各ペインの表示
- `web/src/workspace/`: ファイル入出力、ローカル画像URLの管理、言語切り替えに追従する操作メッセージ
- `web/src/project/`: 章構成、結合レポート、画像パスの分離、検証付きZIP入出力
- `web/src/export/`: 共通プレビュー描画を使うHTMLスライド生成、画像・数式フォントの埋め込み、単体プレーヤー
- `web/src/document/`: 文書モデル、検証、メタデータ定義、文書走査、番号・参照の分析
- `web/src/markdown/`: 共通の記法定義、読み込み、無損失で保存できる形式への変換
- `web/src/security/` / `web/src/preferences/`: 編集画面とプレビューで共通のURL検証、表示設定

読み込み待ちの間に編集・新規作成・別ファイルの読み込みが行われた場合、古い読み込み結果は破棄します。画像の一時URLは文書データとは別に管理し、文書の切り替えや破棄に合わせて解放します。

空段落、段落末の強制改行、画像だけのinline paragraphを無損失で往復するため、canonical Markdownでは予約マーカー `{.kumi-empty}`、`{.kumi-br}`、`{.kumi-inline}` を使用します。

## サンプル

- [Reportサンプル](./web/examples/example-report.md)
- [Slideサンプル](./web/examples/example-slide.md)
- [番号・参照・改ページのサンプル](./web/examples/example-document-features.md)
