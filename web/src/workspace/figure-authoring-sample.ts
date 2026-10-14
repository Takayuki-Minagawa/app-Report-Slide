import {
  createNodeId,
  type ChartNode,
  type DocumentData,
  type DocumentNode,
  type ParagraphNode,
  type TableNode,
} from '@/src/document/model';
import { createConceptFigure } from '@/src/document/figure-edit';
import { resolveChartPlot } from '@/src/document/chart';
import {
  applySlideDesign,
  createSlideComposite,
  getSlidePageId,
  resolveSlideDesign,
} from '@/src/document/slide-design';
import { setReaderSupplement } from '@/src/document/reader-supplement';

/** Synthetic, self-contained material for trying the workflow; no research claims. */
export function createFigureAuthoringSample(): DocumentData {
  const text = (value: string): ParagraphNode => ({
    type: 'paragraph',
    attrs: { nodeId: createNodeId() },
    content: [{ type: 'text', text: value }],
  });
  const title = (value: string): DocumentNode => ({
    type: 'heading',
    attrs: { nodeId: createNodeId(), level: 1 },
    content: [{ type: 'text', text: value }],
  });
  const table = (rows: string[][]): TableNode => ({
    type: 'table',
    attrs: { nodeId: createNodeId(), caption: '編集用の架空データ' },
    content: rows.map((row, index) => ({
      type: 'tableRow',
      attrs: { nodeId: createNodeId() },
      content: row.map((cell) => ({
        type: index === 0 ? 'tableHeader' : 'tableCell',
        attrs: { nodeId: createNodeId(), align: 'left' },
        content: [text(cell)],
      })),
    })),
  });
  const concept = createConceptFigure();
  const original = createConceptFigure();
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340"><rect width="600" height="340" fill="#f0f5fa"/><path d="M70 30V280H550" fill="none" stroke="#253e59" stroke-width="3"/><path d="M70 250L160 220L250 230L340 120L440 70L540 100" fill="none" stroke="#2273b0" stroke-width="5"/><g font-size="22" fill="#253e59" font-family="sans-serif"><text x="220" y="320">時間（架空）</text><text x="85" y="55">原画像の凡例・軸も保持</text></g></svg>';
  original.attrs = {
    ...original.attrs,
    alt: '外枠と軸ラベルを含む原図',
    caption: '原画像を保持した切り抜き',
    figureEdit: {
      version: 1,
      name: '左側の原図',
      svgSource: source,
      imageSize: { width: 600, height: 340 },
      crop: { x: 8, y: 5, width: 84, height: 85 },
      annotations: [
        {
          id: createNodeId(),
          kind: 'arrow',
          x: 60,
          y: 50,
          x2: 72,
          y2: 25,
          text: '注目箇所',
          color: '#b45309',
          fontSize: 5,
        },
      ],
      source: {
        referenceId: 'example',
        origin: 'cropped',
        pdfPage: '1',
        printedPage: '1',
        figureNumber: '図1',
        note: '操作例・実測値ではない',
      },
    },
  };
  const chart: ChartNode = {
    type: 'chart',
    attrs: {
      nodeId: createNodeId(),
      chartType: 'line',
      data: [
        { label: '0', x: 0, y: 0 },
        { label: '1', x: 1, y: 2 },
        { label: '2', x: 2, y: 1 },
      ],
      xLabel: '時間',
      yLabel: '変位',
      series: '観測（架空）',
      alt: '2系列を比較する操作例',
      width: 72,
      caption: null,
    },
  };
  chart.attrs.plot = {
    ...resolveChartPlot(chart.attrs),
    xUnit: 's',
    yUnit: 'mm',
    nature: 'mixed',
    source: '機能説明用の架空データ',
    series: [
      ...resolveChartPlot(chart.attrs).series,
      {
        name: '解析（架空）',
        color: '#b45309',
        dash: 'dashed',
        marker: 'square',
        data: [
          { label: '0', x: 0, y: 0 },
          { label: '1', x: 1, y: 1.7 },
          { label: '2', x: 2, y: 1.2 },
        ],
      },
    ],
  };
  const pages: DocumentNode[][] = [
    [
      title('3状態の模式図を直す'),
      concept,
      text(
        '図を選択してラベル・矢印を編集できます。これは実測値ではない概念図です。',
      ),
    ],
    [
      title('原図・比較表・条件を組み合わせる'),
      original,
      table([
        ['条件', '値'],
        ['A', '12'],
        ['B', '18'],
      ]),
      text('条件：同じ入力・同じ比較軸。数値は説明用の架空データです。'),
      text('結論：図の根拠と整理した数値を、出典と一緒に保管します。'),
    ],
    [
      title('比較表を読みやすく整える'),
      table([
        ['手法', '得意なこと', '確認すること'],
        ['A', '構成を簡単に示す', '前提条件'],
        ['B', '複数の条件を比べる', '軸と単位'],
        ['C', '原資料の根拠を示す', '出典と範囲'],
      ]),
      text(
        'セルの値はビジュアル編集で、列幅と罫線は表ツールバーで調整できます。',
      ),
    ],
    [title('観測と解析の2系列を比べる'), chart],
    [
      title('短い本編と詳しい補足'),
      text(
        'HTMLを書き出すと「詳しい説明」から研究条件を開けます。図の拡大を閉じると同じページへ戻れます。',
      ),
      {
        ...createConceptFigure(),
        attrs: {
          ...createConceptFigure().attrs,
          nodeId: createNodeId(),
          width: 90,
        },
      },
    ],
  ];
  let document: DocumentData = {
    schemaVersion: 2,
    type: 'slide',
    metadata: {
      title: '図表を再編集する5つの作例',
      theme: 'technical',
      figure_references: [
        {
          id: 'example',
          title: 'KUMI図表編集サンプル（架空資料）',
          authors: 'KUMI',
          year: '2026',
          url: '',
        },
      ],
    },
    children: pages.flatMap((nodes, index) =>
      index === 0
        ? nodes
        : [
            {
              type: 'slideBreak',
              attrs: { nodeId: createNodeId() },
            } as DocumentNode,
            ...nodes,
          ],
    ),
  };
  for (let index = 0; index < pages.length; index++) {
    const design = {
      ...resolveSlideDesign(document, index),
      layout: index === 2 ? ('table-focus' as const) : ('standard' as const),
      tableStyle: { striped: true, header: 'light' as const, cellPadding: 5 },
    };
    document = {
      ...document,
      metadata: applySlideDesign(
        document,
        [getSlidePageId(document, index)],
        design,
      ),
    };
  }
  const composite = createSlideComposite(pages[1]);
  composite.leftWidth = 52;
  composite.assignments = pages[1].slice(1).map((node, index) => ({
    nodeId: node.attrs.nodeId,
    nodeIndex: index + 1,
    region: (['left', 'right-top', 'right-bottom', 'bottom'] as const)[index],
    order: index,
    name: ['左側の原図', '結果の比較表', '研究条件', '結論'][index],
  }));
  document = {
    ...document,
    metadata: applySlideDesign(document, [getSlidePageId(document, 1)], {
      ...resolveSlideDesign(document, 1),
      layout: 'composite',
      composite,
    }),
  };
  document.metadata = setReaderSupplement(document, 4, {
    title: '作例の詳しい説明',
    text: 'この資料は機能を試すための作例です。\n1. 図のラベルを変更します。\n2. 出典と切り抜きを調整します。\n3. HTMLまたはZIPを保存し、開き直して編集を続けます。',
    link: '',
  });
  return document;
}
