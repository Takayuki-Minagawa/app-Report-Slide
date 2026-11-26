---
type: report
title: 書式サンプル
subtitle: 報告書（Word風）テーマの例
author: KUMI
date: 2026-11-26
theme: report-jp
number_sections: true
toc: true
report_settings:
  cover: true
  toc_page: true
  toc_page_numbers: true
  toc_depth: 2
  number_depth: 2
  appendix_numbering: letter
  caption_separator: ': '
  front_matter_page_numbers: roman
  keep_tables: auto
  affiliation: サンプル設計室
page_settings:
  paper: A4
  orientation: portrait
  margin_top: 30
  margin_bottom: 30
  margin_left: 25
  margin_right: 25
  font_size: 10.5
  first_line_indent: 1
  after_heading_indent: same
  line_height: 1.85
  paragraph_spacing: 2
report_style:
  docx_fonts:
    latin: Times New Roman
---

# はじめに

## 目的

このサンプルは、テーマ「報告書（Word風）」と `report_settings`・`report_style` の使い方を示す。設定の一覧は「報告書の書式ガイド」を参照する。層間変形角は式[@eq:drift]で定義し、条件は[@tab:conditions]に、数値は[@sec:data]に示す。

$$
R = \frac{\delta_i - \delta_{i-1}}{h_i} \le \frac{1}{100}
$$

{#eq:drift}

### 番号を付けない小見出し

`number_depth: 2` のため、H3には番号を付けない。文中の式 $M = \sqrt{M_x^2 + M_y^2}$ は、Wordでは編集できる数式になる。

> [!NOTE]
> 注記は細い罫線で囲み、表題は「（注）」になる。

> [!IMPORTANT]
> 表題は `report_settings.callout_labels` で変更できる。

## 条件

| 項目                                   | 値        | 備考                       |
| -------------------------------------- | --------- | -------------------------- |
| 用紙                                   | A4        | 余白は上下30 mm、左右25 mm |
| 本文                                   | 10.5 pt   | 明朝                       |
| 見出し                                 | 14／12 pt | ゴシック太字               |
| {#tab:conditions caption="書式の条件"} |

# まとめ

短い表は `keep_tables: auto` により1ページに収まり、付録の長い表は見出し行を繰り返しながら分かれる。

# 数値表

{#sec:data appendix=true}

## 一覧

| 番号                             | 値A  | 値B |
| -------------------------------- | ---- | --- |
| 1                                | 1.5  | 12  |
| 2                                | 3.0  | 24  |
| 3                                | 4.5  | 36  |
| 4                                | 6.0  | 48  |
| 5                                | 7.5  | 60  |
| 6                                | 9.0  | 72  |
| 7                                | 10.5 | 84  |
| 8                                | 12.0 | 96  |
| 9                                | 13.5 | 108 |
| 10                               | 15.0 | 120 |
| 11                               | 16.5 | 132 |
| 12                               | 18.0 | 144 |
| 13                               | 19.5 | 156 |
| 14                               | 21.0 | 168 |
| 15                               | 22.5 | 180 |
| 16                               | 24.0 | 192 |
| 17                               | 25.5 | 204 |
| 18                               | 27.0 | 216 |
| 19                               | 28.5 | 228 |
| 20                               | 30.0 | 240 |
| 21                               | 31.5 | 252 |
| 22                               | 33.0 | 264 |
| 23                               | 34.5 | 276 |
| 24                               | 36.0 | 288 |
| 25                               | 37.5 | 300 |
| 26                               | 39.0 | 312 |
| 27                               | 40.5 | 324 |
| 28                               | 42.0 | 336 |
| 29                               | 43.5 | 348 |
| 30                               | 45.0 | 360 |
| 31                               | 46.5 | 372 |
| 32                               | 48.0 | 384 |
| 33                               | 49.5 | 396 |
| 34                               | 51.0 | 408 |
| 35                               | 52.5 | 420 |
| 36                               | 54.0 | 432 |
| 37                               | 55.5 | 444 |
| 38                               | 57.0 | 456 |
| 39                               | 58.5 | 468 |
| 40                               | 60.0 | 480 |
| {#tab:data caption="数値の一覧"} |
