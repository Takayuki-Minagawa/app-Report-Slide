# KUMI — Markdown Report / Slide Editor

技術レポートとプレゼンテーションを、同じMarkdown／Document Modelから編集するWebアプリです。共通基盤に加え、LaTeX風の番号付け・相互参照・目次と明示的なページ／スライド区切りを実装しています。TeXエンジンではなく、MarkdownとKaTeXを使用します。

## MVP 1でできること

- Report／SlideのYAML Front Matter判定
- Tiptapによる見出し、段落、リスト、引用、コード、画像、表の編集
- KaTeXによるインライン／ブロック数式
- MarkdownファイルのImportと、Markdown／Document JSONの保存
- Report／Slide向けの基本テーマと完成プレビュー
- 3ペイン構成のNavigator、Editor、Properties
- Undo／Redo、Markdown直接編集、破損入力を適用しないエラー処理

## 文書機能

- 図・表・式のキャプション、安定した参照ラベル、自動番号付け
- 見出し階層の節番号、リンク付き目次、前方参照・重複／未解決参照の警告
- 図の幅（10〜100%）・配置・代替テキストをPropertiesで編集し、Markdownでも保持
- 明示的な改ページと複数スライドのプレビュー、ページ／スライド番号
- Document JSON v1／v2のImport、v2への非破壊移行

使い方・構文・制限・次の計画は [文書機能ガイド](./web/docs/document-features.md) を参照してください。元の全体仕様は [仕様書](./md_report_slide_editor_web_spec.md) にあります。自動ページ割り、厳密なA4組版、PDF／HTML export、脚注・文献、段組み、Chart、TeXファイル互換はまだ未実装です。

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
- [番号・参照・改ページのサンプル](./web/examples/example-document-features.md)
