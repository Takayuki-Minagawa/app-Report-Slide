---
type: report
title: 本文書式と字下げのサンプル
subtitle: 見出し後・数式後・個別段落の設定
author: KUMI
theme: latex
number_sections: true
page_settings:
  paper: A4
  orientation: portrait
  margin_top: 20
  margin_bottom: 20
  margin_left: 20
  margin_right: 20
  font_size: 10.5
  first_line_indent: 1
  after_heading_indent: none
  line_height: 1.85
  paragraph_spacing: 0
---

# 見出し直後と通常の本文

この段落は見出し直後なので下げません。文書全体では通常の本文を1字下げ、見出し直後だけ下げない設定にしています。
{first_line_indent=inherit}

この段落は通常の本文なので1字下がります。文章を折り返したとき、2行目からは本文の左端にそろいます。字下げは先頭に空白文字を入力して作るのではなく、段落の書式として保存します。
{first_line_indent=inherit}

この段落だけは「下げない」を指定しています。文書全体の字下げ量を変えても0字のままです。
{first_line_indent=0}

## 見出し後も個別に1字下げる

この段落は見出し直後ですが「1字下げる」の明示指定を優先します。本文サイズを変えると字下げの幅も1字分に追随します。
{first_line_indent=1}

## 数式から文章を続ける

関係式を次のように表します。

$$
y = ax + b
$$

{#eq:linear caption="一次式"}

ここで、$a$ は傾き、$b$ は切片を表します。数式から説明を続けるこの段落には、個別に「下げない」を指定しています。
{first_line_indent=0}

式 [@eq:linear] に続いて、新しい段落を始める場合は通常の本文書式に戻せます。数式の後という理由だけでは、字下げを自動で解除しません。
{first_line_indent=inherit}

## 本文字下げの対象外

次の表や引用、箇条書きには、文書全体の本文字下げを適用しません。

| 場所       | 先頭行の扱い             |
| ---------- | ------------------------ |
| 通常の本文 | 文書設定に従う           |
| 表のセル   | 本文の字下げを適用しない |

> 引用は引用全体の余白を持ちますが、本文の1字下げは追加しません。

- 箇条書きの先頭には記号を配置します。
- 項目内の文章はリストの配置に従います。

## 改ページを挟んだ見出し直後

::: pagebreak
:::

この段落は改ページを挟んでも見出し直後なので下げません。見出しと最初の本文の間にある明示改ページは、字下げ規則を変更しません。
{first_line_indent=inherit}

次の段落は通常の本文として1字下がります。ページの先頭かどうかとは別に、文書の構造と個別設定から書式を決めます。
{first_line_indent=inherit}
