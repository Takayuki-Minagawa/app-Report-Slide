# Markdown Report / Slide Editor - Web版 実装仕様書

## 1. 目的

LaTeX本体をインストールせずに、Markdownを原稿形式として利用しながら、
以下の2種類のドキュメントを作成できるWebアプリを開発する。

1. **Report**
   - LaTeXのarticle / report風
   - A4縦の報告書、計算書、技術資料
   - 図、表、数式、グラフ、ページ番号、目次などを扱う

2. **Slide**
   - LaTeX Beamer風
   - 16:9または4:3のプレゼンテーション
   - 1スライド単位で編集・確認する
   - タイトル、箇条書き、図、グラフ、数式、2カラムなどを扱う

特に以下を重視する。

- Markdownを元データとして扱えること
- 数式をTeX記法で記述できること
- ReportではLaTeX風のA4帳票レイアウトを作れること
- SlideではBeamer風のプレゼンテーションを作れること
- 図・グラフ・表をGUIで確認・調整できること
- PDF化する前に完成イメージを確認できること
- AIがMarkdownや文書構造を生成しやすいこと
- 特定の商用ライブラリへ依存せず、基本的にOSSのみで構成すること

---

# 2. 基本方針

このアプリでは、Markdownを共通の原稿形式として使用する。

Markdownを読み込んだ後にDocument Modelへ変換し、
Document Typeに応じて以下の2種類へレンダリングする。

```text
Markdown
   ↓
Parser
   ↓
Document Model
   ├─ Report Renderer
   │     ↓
   │   A4 Preview
   │     ↓
   │   HTML / PDF
   │
   └─ Slide Renderer
         ↓
       Slide Preview
         ↓
       HTML / PDF
```

同じMarkdown Parser、数式、図、グラフ、表などを可能な限り共通化する。

---

# 3. 開発対象

初期版はWebアプリとして実装する。

目的は、

> AIでMarkdownまたは文書構造を生成し、人間が図・グラフ・表・改ページ・スライド構成などをGUIで最終調整して、HTML/PDFを出力する

ことである。

WordやPowerPointの完全再現は目指さない。

文書構造とレイアウトの安定性を優先する。

---

# 4. 推奨技術

## フロントエンド

- TypeScript
- React
- Vite

## 文書エディタ

第一候補：

- Tiptap
- ProseMirror

Tiptapを中心に使用する。

## Markdown

- markdown-it
- gray-matter

用途：

- Markdown解析
- YAML Front Matter解析

## 数式

- KaTeX

Markdown内では以下を利用する。

```markdown
インライン数式：$x = y + 1$

ブロック数式：

$$
M\ddot{x}+C\dot{x}+Kx=F(t)
$$
```

## Report組版

第一候補：

- Vivliostyle

候補：

- Paged.js

## Slide表示

以下のいずれかを採用する。

第一候補：

- 独自HTML/CSS Slide Renderer

候補：

- Reveal.js

ただし、編集画面との統合を優先し、
必要であればSlide Renderer自体は独自実装する。

## グラフ

第一候補：

- Apache ECharts

候補：

- Vega-Lite

グラフは可能な限りPNGではなくSVGまたはHTML Canvas/SVGとして扱う。

## 図

以下を扱う。

- SVG
- PNG
- JPEG
- WebP

構造図や解析図はSVGを優先する。

---

# 5. Document Type

文書は以下の2種類を持つ。

```ts
type DocumentType = "report" | "slide"
```

Document Modelの基本構造は共通化する。

例：

```ts
interface DocumentData {
  type: DocumentType
  metadata: DocumentMetadata
  children: DocumentNode[]
}
```

---

# 6. 画面構成

基本画面は3ペイン構成とする。

```text
┌─────────────────────────────────────────────────────────┐
│ Toolbar                                                 │
├──────────────┬────────────────────────────┬─────────────┤
│ Document     │                            │ Properties  │
│ Navigator    │       Preview / Editor     │ Panel       │
│              │                            │             │
│ Section      │                            │ Width       │
│ Figure       │                            │ Align       │
│ Table        │                            │ Caption     │
│ Slide        │                            │ Layout      │
│              │                            │ etc.        │
└──────────────┴────────────────────────────┴─────────────┘
```

ToolbarからReport / Slideを切り替えるのではなく、
原則として文書作成時にDocument Typeを決める。

---

# 7. Reportモード

ReportではA4ページ単位で表示する。

```text
┌──────────── A4 Page 1 ─────────────┐
│                                    │
│ 1. 解析概要                        │
│                                    │
│ 本解析では……                       │
│                                    │
│        ┌─────────────────┐         │
│        │   Analysis      │         │
│        │     Graph       │         │
│        └─────────────────┘         │
│        図1 応答解析結果             │
│                                    │
└────────────────────────────────────┘

┌──────────── A4 Page 2 ─────────────┐
│                                    │
└────────────────────────────────────┘
```

必須：

- A4ページ境界
- 改ページ位置表示
- ページ番号
- ズーム
- ページ幅フィット
- 100%表示

---

# 8. Slideモード

Slideでは1枚単位で表示する。

基本比率：

- 16:9
- 4:3

初期版では16:9を標準とする。

```text
┌──────────── Slide 1 ───────────────┐
│                                    │
│          タイトル                   │
│                                    │
│  ・ポイント1                       │
│  ・ポイント2                       │
│                                    │
└────────────────────────────────────┘

┌──────────── Slide 2 ───────────────┐
│                                    │
│     ┌────────┐   ┌────────┐        │
│     │ Graph  │   │ Figure │        │
│     └────────┘   └────────┘        │
│                                    │
└────────────────────────────────────┘
```

必須：

- スライド番号
- スライド一覧
- 16:9表示
- ズーム
- 1枚表示
- 全体一覧表示
- 前後スライド移動

---

# 9. 共通Document Node

以下を共通Nodeとして定義する。

```text
Document
├─ Heading
├─ Paragraph
├─ BulletList
├─ OrderedList
├─ Blockquote
├─ Callout
├─ Equation
├─ Figure
├─ Chart
├─ Table
├─ CodeBlock
└─ Columns
```

Report専用：

```text
PageBreak
```

Slide専用：

```text
Slide
SlideTitle
SlideSubtitle
SlideBreak
```

---

# 10. Figure Node

Figureは以下の属性を持つ。

```ts
interface FigureNode {
  id: string
  type: "figure"
  src: string
  caption?: string
  width: number
  align: "left" | "center" | "right"
  keepAspectRatio: boolean
  marginTop?: number
  marginBottom?: number
  avoidPageBreak?: boolean
}
```

widthは原則としてコンテンツ幅に対する%で管理する。

例：

```json
{
  "id": "fig-response",
  "type": "figure",
  "src": "response.svg",
  "caption": "地震応答解析結果",
  "width": 65,
  "align": "center",
  "keepAspectRatio": true
}
```

---

# 11. Figure GUI操作

図をクリックすると選択状態にする。

選択時：

- 枠線表示
- 四隅にResize Handle表示
- Properties Panelへ設定表示

操作：

- ドラッグで幅変更
- 左寄せ
- 中央
- 右寄せ
- 縦横比固定
- キャプション変更
- 上余白
- 下余白

Reportでは追加：

- 図番号
- ページ途中で分割しない

Slideでは追加：

- スライド内での上下位置調整
- 2カラム内での幅調整

初期版では自由座標配置は実装しない。

---

# 12. Word / PowerPoint風配置の制限

完全自由配置は実装しない。

初期版では次のレイアウトのみサポートする。

```text
1. Full Width
2. Center + Custom Width
3. Left + Custom Width
4. Right + Custom Width
5. Two Column
6. Three Column
```

初期版では以下は実装しない。

- 前面 / 背面
- 任意絶対座標配置
- 複雑な文字回り込み
- オブジェクトの重なり
- PowerPointのような完全自由配置

帳票・スライドの安定性を優先する。

---

# 13. Columns Node

図やグラフを横並びに配置できるNodeを用意する。

```ts
interface ColumnsNode {
  type: "columns"
  columns: 2 | 3
  gap: number
  children: DocumentNode[]
}
```

例：

```text
┌─────────────────────────────┐
│   X方向        Y方向         │
│ ┌────────┐  ┌────────┐      │
│ │ Graph  │  │ Graph  │      │
│ └────────┘  └────────┘      │
└─────────────────────────────┘
```

Report / Slideの両方で利用する。

---

# 14. Chart Node

Chartは画像ではなく編集可能な文書オブジェクトとして管理する。

```ts
interface ChartNode {
  id: string
  type: "chart"
  chartType: string
  data: unknown
  options: unknown
  width: number
  height?: number
  align: "left" | "center" | "right"
  caption?: string
}
```

---

# 15. Chart設定画面

Chart選択時にProperties Panelへ以下を表示する。

- Chart Type
- Width
- Height
- Caption
- X Axis Label
- Y Axis Label
- Legend ON/OFF
- Grid ON/OFF
- Line Width
- Font Size
- Axis Range
- Export SVG

初期版で必要なグラフ：

- Line
- Scatter
- Bar

---

# 16. Table Node

Markdown Tableを読み込めるようにする。

GUI上では最低限以下を対応する。

- 列幅変更
- 文字揃え
- 数値右揃え
- ヘッダーON/OFF
- キャプション

Report：

- 表番号
- 改ページ抑制

Slide：

- スライド幅に合わせた縮小
- 必要に応じて文字サイズ調整

---

# 17. Equation Node

KaTeXを利用する。

```ts
interface EquationNode {
  id: string
  type: "equation"
  latex: string
  number?: string
  label?: string
}
```

例：

```markdown
$$
(K-\omega^2M)\phi=0
$$
```

GUI上ではダブルクリックでLaTeX文字列を編集できるようにする。

Reportでは式番号を付与可能とする。

Slideでは式番号は原則OFFを標準とする。

---

# 18. Reportの自動番号

以下を自動番号化する。

- Chapter
- Section
- Figure
- Table
- Equation

例：

```text
図1
図2
表1
式(1)
```

章ごとの番号は将来対応。

例：

```text
図2-1
図2-2
```

---

# 19. Reportの相互参照

Markdown内で以下の記法を利用する。

```markdown
@fig:response
@table:max-response
@eq:eigen
```

表示時には、

```text
図3
表2
式(5)
```

へ変換する。

---

# 20. Slide構造

SlideモードではMarkdownの区切りをスライド区切りとして扱う。

推奨記法：

```markdown
# タイトル

サブタイトル

---

# 解析概要

- 項目1
- 項目2

---

# 解析結果

![応答解析結果](response.svg)
```

`---` をSlide Breakとして解釈する。

YAML Front Matterとの区別に注意する。

---

# 21. Slide専用Markdown拡張

レイアウト指定：

```markdown
::: slide
layout: title
:::
```

またはFront Matter方式：

```yaml
---
layout: title
---
```

スライド単位では以下のレイアウトを持てるようにする。

```text
title
section
content
two-column
three-column
figure
chart
blank
```

例：

```markdown
::: slide
layout: two-column

## X方向

![X方向](x.svg)

---

## Y方向

![Y方向](y.svg)

:::
```

実装上の最終記法はParser設計時に整理してよい。

---

# 22. Slideレイアウト

最低限以下を実装する。

## Title Slide

```text
┌─────────────────────────────┐
│                             │
│        Main Title           │
│        Subtitle             │
│                             │
│        Author / Date        │
│                             │
└─────────────────────────────┘
```

## Section Slide

```text
┌─────────────────────────────┐
│                             │
│        2. 解析結果           │
│                             │
└─────────────────────────────┘
```

## Content Slide

```text
┌─────────────────────────────┐
│ Title                       │
├─────────────────────────────┤
│                             │
│ Content                     │
│                             │
└─────────────────────────────┘
```

## Two Column

```text
┌─────────────────────────────┐
│ Title                       │
├──────────────┬──────────────┤
│              │              │
│ Left         │ Right        │
│              │              │
└──────────────┴──────────────┘
```

---

# 23. Beamer風Theme

SlideにはBeamerのようなTheme概念を用意する。

```text
slide-themes/
├─ default.css
├─ beamer-simple.css
├─ academic.css
├─ technical.css
└─ dark.css
```

初期版では以下を実装する。

- beamer-simple
- technical

Beamerの完全互換は不要。

以下の考え方を参考にする。

- タイトル領域
- フッター
- スライド番号
- セクション表示
- 落ち着いた配色
- 数式を中心に置きやすい
- 図表を主役にできる

---

# 24. Report Theme

```text
report-themes/
├─ default.css
├─ latex.css
├─ academic.css
├─ report.css
└─ calculation.css
```

初期版では以下を実装する。

- latex
- calculation

---

# 25. Report用YAML Front Matter

```yaml
---
type: report
title: 2層鉄骨造 時刻歴応答解析
subtitle: 応答解析報告書
author: TMD
date: 2026-09-02
paper: A4
orientation: portrait
toc: true
number_sections: true
theme: calculation
---
```

---

# 26. Slide用YAML Front Matter

```yaml
---
type: slide
title: 2層鉄骨造 時刻歴応答解析
subtitle: 応答解析結果
author: TMD
date: 2026-09-02
aspect_ratio: 16:9
theme: beamer-simple
slide_number: true
---
```

---

# 27. Report用Markdown拡張

Figure：

```markdown
![応答解析結果](response.svg)
{#fig:response width=65% align=center}
```

Table：

```markdown
| 階 | 最大変位 | 層間変形角 |
|---:|---:|---:|
| 2F | 24.5 | 1/135 |
| 1F | 18.2 | 1/162 |

{#table:max-response caption="最大応答値"}
```

Page Break：

```markdown
::: pagebreak
:::
```

Callout：

```markdown
::: note
最大層間変形角は1/135である。
:::
```

---

# 28. 共通Markdown拡張

2 Columns：

```markdown
::: columns
columns: 2

![X方向](x.svg)

![Y方向](y.svg)

:::
```

3 Columns：

```markdown
::: columns
columns: 3

内容1

内容2

内容3

:::
```

---

# 29. 保存形式

内部の正本はDocument Modelとする。

保存時は最低限以下を出力できるようにする。

```text
document.json
document.md
document.html
```

PDFはExportとして扱う。

---

# 30. Markdownとの同期

Visual Editorで変更した内容をMarkdownへ戻せるようにする。

例：

変更前：

```markdown
![応答解析結果](response.svg)
{#fig:response width=65% align=center}
```

GUIでWidthを45%へ変更：

```markdown
![応答解析結果](response.svg)
{#fig:response width=45% align=center}
```

Slideでも同様に画像幅やColumnsなどの設定をMarkdownへ反映する。

---

# 31. HTML Export

Report：

```text
report.html
assets/
├─ images/
├─ charts/
└─ style.css
```

Slide：

```text
slides.html
assets/
├─ images/
├─ charts/
└─ slide-theme.css
```

可能であればSingle HTML Exportも将来検討する。

---

# 32. PDF Export

## Report

HTMLを元にA4 PDFを生成する。

候補：

- Vivliostyle
- Playwright
- Chromium printToPDF

## Slide

HTMLを元にスライドPDFを生成する。

1スライド = 1ページとする。

出力時に16:9または4:3を維持する。

---

# 33. AIとの連携を考慮した設計

AIは直接Canvasや座標を操作するのではなく、
MarkdownまたはDocument Modelを生成する。

Report例：

```text
最大応答変位グラフを第3章に追加。
幅70%、中央配置。
```

AI：

```json
{
  "type": "chart",
  "id": "chart-max-response",
  "width": 70,
  "align": "center"
}
```

Slide例：

```text
解析結果を2カラムのスライドにして、
左にX方向、右にY方向のグラフを配置。
```

AI：

```json
{
  "type": "slide",
  "layout": "two-column",
  "children": []
}
```

その後、人間がGUIで最終調整できる。

---

# 34. ディレクトリ構成

推奨：

```text
md-document-editor/
├─ src/
│  ├─ app/
│  ├─ components/
│  │  ├─ Editor/
│  │  ├─ DocumentNavigator/
│  │  ├─ PropertiesPanel/
│  │  ├─ ReportPreview/
│  │  └─ SlidePreview/
│  │
│  ├─ editor/
│  │  ├─ extensions/
│  │  │  ├─ Figure.ts
│  │  │  ├─ Chart.ts
│  │  │  ├─ Equation.ts
│  │  │  ├─ Table.ts
│  │  │  ├─ Columns.ts
│  │  │  ├─ PageBreak.ts
│  │  │  └─ Slide.ts
│  │  └─ editor.ts
│  │
│  ├─ markdown/
│  │  ├─ parser.ts
│  │  ├─ serializer.ts
│  │  └─ extensions.ts
│  │
│  ├─ document/
│  │  ├─ schema.ts
│  │  ├─ numbering.ts
│  │  └─ references.ts
│  │
│  ├─ renderer/
│  │  ├─ report/
│  │  │  ├─ html.ts
│  │  │  ├─ paged.ts
│  │  │  └─ pdf.ts
│  │  │
│  │  └─ slide/
│  │     ├─ html.ts
│  │     └─ pdf.ts
│  │
│  ├─ charts/
│  │  └─ echarts.ts
│  │
│  └─ styles/
│     ├─ report/
│     └─ slide/
│
├─ public/
├─ examples/
│  ├─ example-report.md
│  └─ example-slide.md
├─ tests/
├─ package.json
├─ vite.config.ts
└─ README.md
```

---

# 35. MVP開発順序

最初から全機能を作らない。

## MVP 1：共通基盤

- React + TypeScript + Vite
- Tiptap Editor
- Markdown Import
- YAML Front Matter
- Heading
- Paragraph
- Image
- KaTeX
- Table
- Document Type判定
- 基本Theme

## MVP 2：Report

- A4 Preview
- Figure Node
- Figure Width変更
- Left / Center / Right
- Caption
- 図番号
- Resize Handle
- Page Break

## MVP 3：Slide

- 16:9 Slide Preview
- Slide Break
- Title Slide
- Content Slide
- Section Slide
- Two Column
- Slide Number
- Beamer風Theme

## MVP 4：Chart

- ECharts
- Chart Node
- Chart Properties
- SVG Export
- Report / Slide両対応

## MVP 5：Export

- Markdown Export
- HTML Export
- Report PDF
- Slide PDF
- Document JSON保存

---

# 36. 初期版で実装しないもの

以下は初期版では不要。

- Word完全互換
- PowerPoint完全互換
- DOCX Import
- DOCX Export
- PPTX Import
- PPTX Export
- LibreOffice連携
- LaTeX実行
- TeX Live
- 複雑なfloatアルゴリズム
- 任意座標への図配置
- 図をテキストの背面へ配置
- オブジェクトの重なり
- リアルタイム共同編集
- クラウドDB
- ユーザー認証
- 外部サーバー

---

# 37. テスト用Report

`example-report.md` を作成する。

以下を含める。

- Title
- Heading 1〜3
- Paragraph
- Bullet
- Table
- Figure
- SVG
- PNG
- Equation
- Inline Math
- Page Break
- 2-column Figure
- Chart

---

# 38. テスト用Slide

`example-slide.md` を作成する。

以下を含める。

- Title Slide
- Section Slide
- Bullet Slide
- Figure Slide
- Chart Slide
- Equation Slide
- Two Column Slide
- Table Slide
- Closing Slide

---

# 39. 最重要要件

このアプリで特に優先するのは以下。

1. Markdownで原稿を管理できる
2. AIがMarkdownを書きやすい
3. ReportとSlideの両方を作れる
4. ReportではA4完成形を確認できる
5. SlideではBeamer風の完成形を確認できる
6. 図とグラフの大きさをGUIで調整できる
7. 数式をTeX記法で記述できる
8. HTMLとPDFの見た目を極力一致させる
9. レイアウトを自由にしすぎず壊れにくくする
10. OSS中心で構築する

---

# 40. AIコーディングエージェントへの指示

以下の方針で実装すること。

- 最初にMVP 1のみを実装する
- いきなり全機能を作らない
- ReportとSlideの共通Nodeを優先して設計する
- 各機能を独立したComponent / Extensionとして作る
- Document Modelを中心に設計する
- Markdown ParserとSerializerを分離する
- Report RendererとSlide Rendererを分離する
- RendererをEditorから分離する
- TypeScript strictを使用する
- 実装ごとに最低限のテストを追加する
- OSSライブラリで解決できる機能は自作しすぎない
- UIの見た目より、文書構造と変換の安定性を優先する

---

# 41. 完成イメージ

## Report

```text
AI
 ↓
Markdown生成
 ↓
Web Editorで開く
 ↓
A4ページとして確認
 ↓
図やグラフをマウスで調整
 ↓
必要なら文章を修正
 ↓
HTML保存
 ↓
PDF Export
```

## Slide

```text
AI
 ↓
Markdown生成
 ↓
Web Editorで開く
 ↓
スライド単位で確認
 ↓
図・グラフ・数式・2カラムを調整
 ↓
HTML保存
 ↓
Slide PDF Export
```

ReportとSlideで、
Markdown Parser、数式、図、表、グラフ、Document Modelなどの共通部分を最大限再利用する。
