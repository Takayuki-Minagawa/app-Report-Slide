---
type: report
title: 番号と相互参照のサンプル
author: KUMI
theme: latex
toc: true
number_sections: true
---

# 解析概要

{#sec:overview}

式 [@eq:motion] を用いて解析する^[減衰はレイリー型とした。]。結果は [@table:response] に示す。

> [!NOTE]
> 入力地震動は告示波3波を使用した。

## 基本式

$$
M\ddot{x}+C\dot{x}+Kx=F(t)
$$

{#eq:motion caption="運動方程式"}

::: pagebreak
:::

# 解析結果

{#sec:results}

| 階  | 最大変位 | 層間変形角 |
| :-- | -------: | :--------: |
| 2F  |  24.5 mm |   1/135    |
| 1F  |  18.2 mm |   1/162    |

{#table:response caption="各階の最大応答値"}

解析条件は [@sec:overview] を参照。
