# 報告書の書式（テーマ・書式データ・カスタムCSS・Word出力）

Reportの紙面の書式は、次の3層で決まります。後のものが前のものを上書きします。

1. **テーマ**（`theme`）: `latex`（既定）、`calculation`、`report-jp`（報告書（Word風））
2. **書式データ**（`report_style` の各項目）: プレビュー・HTML・PDFのCSSと、Wordのスタイルの両方に反映
3. **カスタムCSS**（`report_style.css`）: プレビュー・HTML・PDFだけに反映。**Wordには反映されません**

番号や区切り文字などの「文言」は `report_settings` で指定します。原稿の例は [書式サンプル](../examples/example-report-style.md) を参照してください。ここに挙げる設定はすべて省略でき、省略時はこれまでと同じ出力になります。

## テーマ「報告書（Word風）」

`theme: report-jp` は、日本語の技術報告書をWordの社内書式のように組むテーマです。

| 要素         | 体裁                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------- |
| 本文         | 明朝、黒                                                                                            |
| 見出し       | ゴシック太字、黒、罫線・帯なし。H1 14 pt、H2 12 pt、H3は本文と同じ大きさ。番号と見出しの間は全角1字 |
| キャプション | 明朝 10 pt、中央揃え                                                                                |
| 表           | 0.75 ptの黒罫、見出し行は塗りなしのゴシック太字・中央揃え、本文は明朝 9 pt                          |
| 注記         | 細い黒罫の囲み。表題は（注）（参考）【要点】【留意】【注意】（日本語表示のとき）                    |
| 式           | 地の色なし                                                                                          |
| 表紙         | 中央揃え。項目名（所属・日付など）は出さない                                                        |
| 目次         | 表題「目 次」、章は太字ゴシックで点線なし、節は字下げして点線                                       |
| ページ番号   | 下中央に「- 1 -」                                                                                   |

テーマが決めるのは既定値です。`report_settings` や `report_style` に書いた値が優先されます。

## report_settings（番号・文言）

```yaml
report_settings:
  caption_separator: ': ' # 図 1: 表題（既定は " — "）
  number_depth: 2 # H2まで番号を付ける。それより下は番号を数えない
  appendix_numbering: letter # auto（既定）| letter | continue
  toc_title: 目 次
  page_number_format: '- {n} -' # {n}=ページ番号、{total}=本文の総ページ数
  toc_page_number_format: '{n}' # 省略時は page_number_format と同じ
  page_number_position: bottom-center # bottom-right（既定）| bottom-center
  front_matter_page_numbers: roman # none（既定）| roman（目次ページに - i -）
  keep_tables: auto # never（既定）| auto | always
  cover_layout: centered # fields（既定）| centered
  callout_labels:
    note: （注）
    important: 【要点】
    warning: '' # 空文字は表題なし
  word_fields: true # Wordの番号・参照・目次をフィールドにする
```

- **appendix_numbering**: `auto` は従来どおり、章番号（`heading_numbering: chapter`）のときだけ `appendix=true` 以降のH1を「付録 A」にします。`letter` は節番号（1, 1.1）でも「付録 A」「A.1」にし、`continue` は章番号でも本文から続けて数えます。
- **keep_tables**: `auto` は本文領域の高さの半分以下の表だけ、`always` は1ページに収まる表すべてを分割しません。1ページに収まらない表は、どの設定でも見出し行を繰り返しながら分かれます。
- **ページ番号の位置・目次ページの番号・表の分割**は、`toc_page_numbers: true` の組版（完成プレビュー・HTML・PDF）とWordに反映します。組版しない論理ページのプレビューでは、ページ番号の書式だけを反映します。
- 画面では **プロパティ → 報告書の構成** で設定できます。テーマの既定と同じ値は原稿に保存しません。

## report_style（書式データ）

```yaml
report_style:
  body: { font: mincho, color: '#000000' } # mincho | gothic
  headings:
    h1:
      {
        font: gothic,
        size: 14,
        bold: true,
        color: '#000000',
        space_before: 16,
        space_after: 8,
      }
    h2: { size: 12 }
    h3: { size: 10.5 }
    number_gap: 1 # 番号と見出しの間（em）
    decoration: false # テーマの罫線・帯を消す
  caption: { font: mincho, size: 10, align: center }
  table:
    border_width: 0.75 # pt。セルに個別の罫線がある場合はそちらが優先
    border_color: '#000000'
    header_fill: none # none または "#RRGGBB"
    header_font: gothic
    header_bold: true
    header_align: center
    font: mincho
    size: 9
    zebra: false
    compact: true # 行間を詰める
  callout: { frame: box, title_font: gothic } # bar | box
  equation: { background: false }
  contents:
    { level1_bold: true, level1_font: gothic, level1_leader: false, indent: 8 }
  docx_fonts: { mincho: 游明朝, gothic: 游ゴシック, latin: Times New Roman }
  css: |
    .report-preview[data-theme] .document-renderer h2 { text-decoration: underline; }
```

大きさの単位はpt、`contents.indent` はmmです。指定した項目だけがテーマを上書きします。

HTML・PDFの書体は埋め込みのNoto Serif JP（明朝）／Noto Sans JP（ゴシック）です。Wordには書体を埋め込めないため、`docx_fonts` でWord側の書体名に対応させます。既定は游明朝／游ゴシックで、`latin` を指定すると英数字（`w:ascii`／`w:hAnsi`）だけ別の書体になります。

### カスタムCSS（report_style.css）

書式データで表せない細部の調整に使います。完成プレビュー、HTML、印刷、PDFに反映し、改ページ・目次のページ番号・はみ出し検査もCSS適用後の紙面で行います。

他の人が作ったファイルにも含まれるため、次の制限があります。違反するCSSを含む文書は読み込み時にエラーになります。

- 64 KiB以下
- 外部の読み込みは不可: `url()`、`@import`、`@font-face`、`image-set()` など
- 使える@規則は `@media`、`@supports`、`@page`（と `@bottom-center` などのマージンボックス）、`@layer`、`@container` だけ
- `<`、`&`、`+ ~ >` で始まるセレクター、閉じていない括弧・文字列・コメントは不可

編集画面のプレビューでは、CSSをプレビュー内に閉じ込めて適用します（編集画面の他の部分には影響しません）。

## スタイルを当てるためのクラス・属性

次のクラスと属性は書式用の公開仕様として維持します。

| 対象         | セレクター                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 紙面         | `.report-preview[data-theme]`、本文は `.document-renderer`                                                                     |
| ページの種類 | `[data-report-page-kind="cover"｜"contents"｜"body"]`（組版前のページにも、組版後の `.pagedjs_page` にも付きます）             |
| 見出しの番号 | `.section-number`（番号）と `.section-separator`（区切りの空白）                                                               |
| キャプション | `.caption-label`（図 1）、`.caption-separator`、`.caption-text`                                                                |
| 目次         | `.document-toc li[data-toc-level="1"]`、番号は `.toc-number`、組版後は `.kumi-toc-title`／`.kumi-toc-leader`／`.kumi-toc-page` |
| 注記         | `blockquote[data-callout="note"]`、表題は `.callout-title`                                                                     |
| 表           | `.preview-table-wrap`（分割しない表には `.kumi-keep-table`）                                                                   |
| 式           | `.numbered-equation`、`.equation-body`、`.equation-number`                                                                     |
| 表紙         | `.report-cover[data-cover-layout]`、`.report-cover-heading`、`.report-cover-fields`                                            |
| ページ番号   | `.kumi-physical-footer`（`data-report-page-kind`、`data-page-number` 付き。組版後に各ページの `.pagedjs_pagebox` へ追加）      |

## Word出力

Wordは、同じ書式データから作った**名前付きスタイル**で組みます。段落を追加・削除しても書式が崩れにくく、スタイルを変更すれば全体の見た目を一括で変えられます。

- 見出し・図表番号・目次は、Wordの組込みスタイル（見出し 1〜6、図表番号、目次 1〜6）を報告書の書式で上書きします。ナビゲーション、図表番号の挿入、目次の更新がそのまま使えます。
- それ以外は `KUMI Table Text`、`KUMI Table Header`、`KUMI Callout`、`KUMI Callout Title`、`KUMI Cover Title`、`KUMI Cover Subtitle`、`KUMI Cover Text`、`KUMI Contents Title`、`KUMI Code`、`KUMI Equation`、`KUMI Appendix Heading 1` です。組込みスタイルの名前とは重なりません。
- **式**はWordの数式（OMML）として出力し、Wordで編集できます。番号付きの式は、式を中央、番号を右端のタブ位置に置きます。変換できない式だけLaTeXの文字で出力し、警告を表示します。
- **表**は、列幅の指定がなければ各列の最大の文字数（全角2、半角1）に応じて幅を配分します。行は途中で分割せず、見出し行はページをまたぐと繰り返します。
- **ページ番号**は `page_number_format`／`page_number_position` に従い、`front_matter_page_numbers: roman` では目次のセクションを「- i -」から数えます。
- **注記**の `frame: box` は1行1列の表で囲みます。

### フィールド（word_fields）

既定では、見出し番号・図表番号・参照・目次は出力時点の文字です（Word以外のソフトでもそのまま表示されます）。`word_fields: true` にすると次のようになります。

| 対象                 | 出力                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| 図・表・式の番号     | `SEQ 図`／`SEQ 表`／`SEQ 式`（英語表示では Figure／Table／Equation）           |
| 本文中の参照         | ブックマークへの `REF`                                                         |
| 見出しの番号         | 多段の段落番号。付録は `KUMI Appendix Heading 1` と付録用の番号（付録 A、A.1） |
| 目次・図目次・表目次 | `TOC` フィールド。出力時点の項目を入れてあります                               |

各フィールドには出力時点の値が入っているため、開いた直後から正しく表示されます。目次にページ番号を載せる場合（`toc_page_numbers: true`）だけ、Wordが開くときにフィールドの更新を確認します。

Wordが同じ値を再現できない場合は、その部分だけ文字で出力して警告します。

- 見出しの階層を飛ばした文書（H1の次にH3）や、付録が27以上ある文書の見出し番号
- 章ごとの図表番号（`caption_numbering: chapter`）
- `toc=false` で目次から除外した見出しは、Wordで目次を更新すると目次に現れます

### 対応していないもの

- `report_style.css` はWordに反映しません（出力時に警告します）。
- 変換できない式を画像にする処理、SVG画像のベクター形式での埋め込み（現在はPNG）は未対応です。
- Wordと、プレビュー・PDFのページ割付けは一致しません（書体と組版エンジンが違うため）。一致するのは書式の定義・番号・目次の内容です。
- Wordで直した内容をKUMIへ戻すことはできません。原稿（Markdown／ZIP）を正本にしてください。
