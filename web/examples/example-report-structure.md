---
type: report
title: 報告書の構成サンプル
subtitle: 表紙・章番号・目次・付録
author: サンプル作成担当
date: '2026-11-06'
theme: latex
number_sections: true
toc: true
report_settings:
  cover: true
  heading_numbering: chapter
  caption_numbering: chapter
  toc_depth: 2
  toc_page: true
  list_figures: true
  list_tables: true
  affiliation: サンプル技術部
  recipient: レビュー担当
  report_number: SAMPLE-001
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
  line_height: 1.5
  paragraph_spacing: 0
---

# 調査の目的

{#sec:purpose}

このサンプルは、本文を書き換えずに表紙と目次を生成する設定例です。表紙と独立目次の後から、本文のページ番号を1で始めます。

## 文書の構成

通常章を2章、付録を1章用意しています。[@fig:sample]、[@tab:conditions]、[@eq:model] の番号は章ごとに計算します。

![KUMIの図見本](favicon.svg)
{#fig:sample width=15% align=center caption="同梱アイコンを用いた図の見本"}

| 項目         | 設定     |
| ------------ | -------- |
| 目次の深さ   | H2まで   |
| 本文の字下げ | 1字      |
| 見出し直後   | 下げない |

{#tab:conditions caption="書式の設定"}

## 目次から外した補足

{toc=false}

この見出しは本文と番号を保ち、目次だけから除外しています。

::: pagebreak
:::

# 調査結果

{#sec:results}

本文中の章参照は [@sec:purpose]、付録への参照は [@app:data] のように、参照ラベルから表示します。

## 関係式

$$
y = ax + b
$$

{#eq:model caption="一次式"}

ここで、$a$ は傾き、$b$ は切片です。この段落は数式から説明を続けるため、個別に字下げを解除しています。
{first_line_indent=0}

| x   | y   |
| --- | --- |
| 0   | 1   |
| 1   | 3   |

{#tab:result caption="例示データ"}

### 目次の深さより下の見出し

H3の見出しは本文に残り、今回のH2までの目次には載りません。

::: pagebreak
:::

# 補足データ

{#app:data appendix=true}

このH1から付録Aとして採番します。続けてH1を置くと付録Bになります。

## 記号の定義

| 記号 | 意味 |
| ---- | ---- |
| a    | 傾き |
| b    | 切片 |

{#tab:symbols caption="記号一覧"}

[@tab:symbols] は付録の表A.1として参照できます。
