import type { DocumentData } from '@/src/document/model';
import { parseMarkdown } from '@/src/markdown/parser';

export const initialMarkdown = `---
type: report
title: 2層鉄骨造 時刻歴応答解析
subtitle: 応答解析報告書
author: TMD
date: 2026-09-02
paper: A4
orientation: portrait
theme: calculation
---

# 解析概要

本解析では、2層鉄骨造モデルを対象として時刻歴応答解析を実施し、各層の最大応答値と変形性能を確認する。

## 基本式

運動方程式は $x = y + 1$ と、次の行列式で表す。

$$
M\\ddot{x}+C\\dot{x}+Kx=F(t)
$$

## 最大応答値

| 階 | 最大変位 | 層間変形角 |
|:---|---:|:---:|
| 2F | 24.5 mm | 1/135 |
| 1F | 18.2 mm | 1/162 |
`;

function deterministicIds(): () => string {
  let id = 0;
  return () => `sample-${++id}`;
}

export const initialDocument = parseMarkdown(initialMarkdown, {
  idFactory: deterministicIds(),
}).document;

export function cloneDocument(document: DocumentData): DocumentData {
  return JSON.parse(JSON.stringify(document)) as DocumentData;
}
