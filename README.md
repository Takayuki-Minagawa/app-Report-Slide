# KUMI — Markdown Report / Slide Editor

技術レポートとプレゼンテーションを、同じMarkdown／Document Modelから編集するWebアプリです。現在は仕様書の「MVP 1：共通基盤」を実装しています。

## MVP 1でできること

- Report／SlideのYAML Front Matter判定
- Tiptapによる見出し、段落、リスト、引用、コード、画像、表の編集
- KaTeXによるインライン／ブロック数式
- MarkdownファイルのImportと、Markdown／Document JSONの保存
- Report／Slide向けの基本テーマと完成プレビュー
- 3ペイン構成のNavigator、Editor、Properties
- Undo／Redo、Markdown直接編集、破損入力を適用しないエラー処理

実装対象の詳細は [md_report_slide_editor_web_spec.md](./md_report_slide_editor_web_spec.md) を参照してください。MVP 2以降のFigure属性、ページ区切り、Slide layout、Chart、PDF／HTML exportは今回の対象外です。

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

## 設計

編集本文の唯一の状態源はTiptap／ProseMirror JSONです。React stateは文書種別とFront Matterを含むenvelopeを保持し、保存時に両者から `DocumentData` を作ります。

```text
Markdown
  ↕ parser / canonical serializer
DocumentData envelope
  ↕ Tiptap JSON-compatible nodes
Tiptap editor
  → Report / Slide preview
```

Runtime validatorはNode型、必須属性、親子関係、既知metadata型、URL、`nodeId`の非空・一意性を確認します。Markdownで表現できない表構造は黙って欠落させず、typed errorとして保存を止めます。

空段落、段落末の強制改行、画像だけのinline paragraphを無損失で往復するため、canonical Markdownでは予約マーカー `{.kumi-empty}`、`{.kumi-br}`、`{.kumi-inline}` を使用します。

## サンプル

- [Reportサンプル](./web/examples/example-report.md)
- [Slideサンプル](./web/examples/example-slide.md)
