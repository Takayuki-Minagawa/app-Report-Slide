import { projectMessages, type ProjectMessages } from './project-messages';

export const supportedLocales = ['ja', 'en'] as const;

export type AppLocale = (typeof supportedLocales)[number];

export interface UiMessages {
  project: ProjectMessages;
  app: {
    darkMode: string;
    englishInterface: string;
    switchToEnglish: string;
    switchToJapanese: string;
    switchToDark: string;
    switchToLight: string;
    manual: string;
    close: string;
  };
  workspace: {
    documentPanel: string;
    propertiesPanel: string;
    showDocumentPanel: string;
    showPropertiesPanel: string;
    markdownFile: string;
    documentStructure: string;
    noOutline: string;
    importHint: string;
    openMarkdown: string;
    newReport: string;
    newSlide: string;
    visual: string;
    slideLayout: string;
    markdown: string;
    insertImage: string;
    chooseImage: string;
    previousSlide: string;
    nextSlide: string;
    slidePosition: string;
    slidePositionValue: (index: number, count: number) => string;
    slideLayoutHelp: string;
    resizeImage: (direction: string) => string;
    preview: string;
    switchToView: (label: string) => string;
    format: string;
    bold: string;
    italic: string;
    heading1: string;
    heading2: string;
    bulletList: string;
    orderedList: string;
    quote: string;
    inlineMath: string;
    blockMath: string;
    insertTable: string;
    tableTools: string;
    tableRows: string;
    tableColumns: string;
    addRowAbove: string;
    addRowBelow: string;
    deleteRow: string;
    addColumnBefore: string;
    addColumnAfter: string;
    deleteColumn: string;
    mergeCells: string;
    mergeBorderConflict: string;
    splitCell: string;
    toggleHeaderRow: string;
    deleteTable: string;
    tableBorders: string;
    drawBorders: string;
    eraseBorders: string;
    borderAll: string;
    borderOuter: string;
    borderInner: string;
    borderTop: string;
    borderRight: string;
    borderBottom: string;
    borderLeft: string;
    borderColor: string;
    borderStyle: string;
    borderWidth: string;
    borderSolid: string;
    borderDashed: string;
    borderDotted: string;
    borderDouble: string;
    borderThin: string;
    borderMedium: string;
    borderThick: string;
    insertSlideBreak: string;
    insertPageBreak: string;
    markdownDraft: string;
    discard: string;
    applyMarkdown: string;
    document: string;
    type: string;
    title: string;
    theme: string;
    toc: string;
    sectionNumbers: string;
    slideNumbers: string;
    referenceLabel: string;
    insertReference: string;
    available: string;
    noReferenceLabels: string;
    referenceDiagnostics: string;
    selectedElement: string;
    updateEquation: string;
    selectElementHint: string;
    documentBody: string;
    unsaved: string;
    undo: string;
    redo: string;
    report: string;
    slide: string;
    untitledHeading: string;
    image: string;
    table: string;
    code: string;
    exportHtml: string;
    exportingHtml: string;
    replaceConfirmation: string;
  };
  status: {
    ready: string;
    readyDescription: string;
    unableToSerialize: string;
    editing: string;
    editingDescription: string;
    markdownUnsupported: string;
    selectOneSource: string;
    unsupportedAttachments: (files: string) => string;
    markdownTooLarge: string;
    imageTooLarge: string;
    imagesTooLarge: string;
    imageInserted: string;
    unableToInsertImage: string;
    unresolvedImages: (sources: string) => string;
    loaded: (filename: string) => string;
    loadedWithWarnings: (filename: string) => string;
    unableToLoad: string;
    unableToLoadTitle: string;
    appliedMarkdown: string;
    unableToApplyMarkdown: string;
    unableToParseMarkdown: string;
    createdReport: string;
    createdSlide: string;
    resolveMarkdownChanges: string;
    resolveMarkdownChangesDescription: string;
    unableToRefreshMarkdown: string;
    discardedMarkdown: string;
    unableToDiscardMarkdown: string;
    savedMarkdownAfterApplying: string;
    savedMarkdown: string;
    unableToSaveMarkdown: string;
    savedJsonAfterApplying: string;
    savedJson: string;
    unableToSaveJson: string;
    invalidDocumentData: string;
    selectMathAgain: string;
    updatedEquation: string;
    selectedElementRemoved: string;
    updatedAttributes: string;
    unableToUpdateAttributes: string;
    checkAttributes: string;
    editingMarkdown: string;
    editingMarkdownDescription: string;
    exportingHtml: string;
    exportedHtml: string;
    unableToExportHtml: string;
    htmlSlidesOnly: string;
    htmlMissingImages: (sources: string) => string;
    htmlImageReadFailed: (source: string) => string;
    htmlExternalImages: string;
    htmlExportDescription: string;
    htmlExportCancelled: string;
    recoveredDraft: string;
    unableToRecover: string;
    recoveryUnavailable: string;
  };
  semantic: {
    referenceLabel: string;
    invalidReferenceLabel: string;
    caption: string;
    numbering: string;
    automatic: string;
    enabled: string;
    disabled: string;
    width: string;
    figureWidth: string;
    alignment: string;
    left: string;
    center: string;
    right: string;
    alternativeText: string;
    applyAttributes: string;
    numberingHelp: string;
  };
  preview: {
    slides: (count: number) => string;
    pages: (count: number) => string;
    referenceWarnings: string;
    checkReferences: string;
    slidePreview: string;
    reportPreview: string;
    unresolvedReference: string;
    imageUnavailable: string;
    toc: string;
  };
  recovery: {
    foundTitle: string;
    foundDescription: string;
    savedAt: (title: string, time: string) => string;
    restore: string;
    discard: string;
    restoring: string;
  };
  manual: {
    title: string;
    description: string;
    startTitle: string;
    startSteps: readonly string[];
    editTitle: string;
    editSteps: readonly string[];
    tableTitle: string;
    tableSteps: readonly string[];
    exportTitle: string;
    exportSteps: readonly string[];
    preferencesTitle: string;
    preferencesSteps: readonly string[];
    projectTitle: string;
    projectSteps: readonly string[];
    recoveryTitle: string;
    recoverySteps: readonly string[];
    privacyTitle: string;
    privacyText: string;
  };
}

export const messages: Record<AppLocale, UiMessages> = {
  ja: {
    project: projectMessages.ja,
    app: {
      darkMode: 'ダークモード',
      englishInterface: '英語表示',
      switchToEnglish: '英語表示に切り替える',
      switchToJapanese: '日本語表示に切り替える',
      switchToDark: 'ダークモードに切り替える',
      switchToLight: 'ライトモードに切り替える',
      manual: 'ガイド',
      close: '閉じる',
    },
    workspace: {
      documentPanel: 'DOCUMENT',
      propertiesPanel: 'PROPERTIES',
      showDocumentPanel: '文書パネルを開く',
      showPropertiesPanel: 'Propertiesを開く',
      markdownFile: 'Markdownファイル',
      documentStructure: '文書構成',
      noOutline: '構成要素はまだありません',
      importHint: 'Markdown / Document JSON ＋ 画像',
      openMarkdown: 'Markdownを開く',
      newReport: 'Report',
      newSlide: 'Slide',
      visual: 'ビジュアル編集',
      markdown: 'Markdown',
      preview: '完成プレビュー',
      slideLayout: '図を配置',
      insertImage: '画像を挿入',
      chooseImage: '画像を選択',
      previousSlide: '前のスライド',
      nextSlide: '次のスライド',
      slidePosition: '編集中のスライド',
      slidePositionValue: (index, count) =>
        String(index) + ' / ' + String(count),
      slideLayoutHelp:
        '画像を挿入するか本文の図をクリックして配置を開始します。ドラッグで移動し、選択枠のハンドルで大きさを変えます。矢印キーで移動し、ハンドルにフォーカスすると同じキーでリサイズできます。',
      resizeImage: (direction) => '画像の' + direction + 'をリサイズ',
      switchToView: (label) => `${label}へ切り替え`,
      format: '書式',
      bold: '太字',
      italic: '斜体',
      heading1: '見出し1',
      heading2: '見出し2',
      bulletList: '箇条書き',
      orderedList: '番号付きリスト',
      quote: '引用',
      inlineMath: 'インライン数式',
      blockMath: 'ブロック数式',
      insertTable: '表を挿入',
      tableTools: '表の編集',
      tableRows: '行',
      tableColumns: '列',
      addRowAbove: '上に行を追加',
      addRowBelow: '下に行を追加',
      deleteRow: '行を削除',
      addColumnBefore: '左に列を追加',
      addColumnAfter: '右に列を追加',
      deleteColumn: '列を削除',
      mergeCells: 'セルを結合',
      mergeBorderConflict:
        '選択範囲の外周罫線が異なります。罫線を統一してから結合してください。',
      splitCell: 'セルを分割',
      toggleHeaderRow: 'ヘッダー行を切り替え',
      deleteTable: '表を削除',
      tableBorders: '罫線',
      drawBorders: '罫線を引く',
      eraseBorders: '罫線を消す',
      borderAll: 'すべての罫線',
      borderOuter: '外側の罫線',
      borderInner: '内側の罫線',
      borderTop: '上罫線',
      borderRight: '右罫線',
      borderBottom: '下罫線',
      borderLeft: '左罫線',
      borderColor: '罫線の色',
      borderStyle: '罫線の種類',
      borderWidth: '罫線の太さ',
      borderSolid: '実線',
      borderDashed: '破線',
      borderDotted: '点線',
      borderDouble: '二重線',
      borderThin: '細い',
      borderMedium: '標準',
      borderThick: '太い',
      insertSlideBreak: 'スライドを区切る',
      insertPageBreak: '改ページ',
      markdownDraft: 'Markdown原稿',
      discard: '破棄',
      applyMarkdown: 'Markdownを適用',
      document: '文書',
      type: '種類',
      title: 'タイトル',
      theme: 'テーマ',
      toc: '目次',
      sectionNumbers: '節番号',
      slideNumbers: 'スライド番号',
      referenceLabel: '参照先ラベル',
      insertReference: '参照を挿入',
      available: '利用可能',
      noReferenceLabels: '要素に参照ラベルを設定してください',
      referenceDiagnostics: '文書の参照診断',
      selectedElement: '選択中の要素',
      updateEquation: '数式を更新',
      selectElementHint: '要素を選択すると\n設定を編集できます',
      documentBody: '文書本文',
      unsaved: '未保存',
      undo: '元に戻す',
      redo: 'やり直す',
      report: 'Report',
      slide: 'Slide',
      untitledHeading: '無題の見出し',
      image: '画像',
      table: '表',
      code: 'コード',
      exportHtml: 'HTMLスライドを出力',
      exportingHtml: 'HTMLスライドを出力中',
      replaceConfirmation:
        '未保存の変更があります。別の文書を開いて変更を破棄しますか？',
    },
    status: {
      ready: '準備完了',
      readyDescription: 'Document ModelとEditorを同期しています',
      unableToSerialize: '文書を変換できません',
      editing: '編集中',
      editingDescription: '変更はブラウザ内に保持されています',
      markdownUnsupported:
        'この文書はDocument JSONで保存してください。Markdownでは表現できない構造を保持しています。',
      selectOneSource: 'MarkdownまたはDocument JSONを1つだけ選択してください',
      unsupportedAttachments: (files) =>
        `画像以外の添付ファイルは読み込めません: ${files}`,
      markdownTooLarge: 'Markdownファイルは5MB以下にしてください',
      imageTooLarge: '画像ファイルは1件20MB以下にしてください',
      imagesTooLarge: '画像ファイルの合計は50MB以下にしてください',
      imageInserted: '画像をスライドへ配置しました',
      unableToInsertImage: '画像を挿入できませんでした',
      unresolvedImages: (sources) =>
        `ローカル画像を解決できません: ${sources}（Markdownと画像を同時に選択してください）`,
      loaded: (filename) => `${filename}を読み込みました`,
      loadedWithWarnings: (filename) => `${filename}を警告付きで読み込みました`,
      unableToLoad: 'ファイルを読み込めませんでした',
      unableToLoadTitle: 'Markdownを読み込めませんでした',
      appliedMarkdown: 'Markdownの変更を適用しました',
      unableToApplyMarkdown: 'Markdownを適用できませんでした',
      unableToParseMarkdown: 'Markdownを解析できませんでした',
      createdReport: '新しいReport文書を作成しました',
      createdSlide: '新しいSlide文書を作成しました',
      resolveMarkdownChanges: 'Markdownの変更を先に処理してください',
      resolveMarkdownChangesDescription:
        'ビジュアル編集へ戻る前に、Markdownの変更を適用または破棄してください',
      unableToRefreshMarkdown: 'Markdown表示を更新できませんでした',
      discardedMarkdown: 'Markdownの変更を破棄しました',
      unableToDiscardMarkdown: 'Markdownの変更を破棄できませんでした',
      savedMarkdownAfterApplying: 'Markdownを適用して保存しました',
      savedMarkdown: 'Markdownを保存しました',
      unableToSaveMarkdown: 'Markdownを保存できませんでした',
      savedJsonAfterApplying: 'Markdownを適用してDocument JSONを保存しました',
      savedJson: 'Document JSONを保存しました',
      unableToSaveJson: 'Document JSONを保存できませんでした',
      invalidDocumentData: '文書データを検証できません',
      selectMathAgain: '数式を選択し直してください',
      updatedEquation: '数式を更新しました',
      selectedElementRemoved:
        '対象の要素は削除されています。選択し直してください',
      updatedAttributes: '属性を更新しました',
      unableToUpdateAttributes: '属性を更新できませんでした',
      checkAttributes: '属性を確認してください',
      editingMarkdown: 'Markdownを編集中',
      editingMarkdownDescription:
        '適用または保存するまで下書きとして保持されます',
      exportingHtml: 'HTMLスライドを生成しています',
      exportedHtml: 'HTMLスライドを出力しました',
      htmlExportCancelled:
        'HTML出力を中止しました。現在の文書でもう一度出力してください。',
      unableToExportHtml: 'HTMLスライドを出力できませんでした',
      htmlSlidesOnly: 'HTML出力はSlide文書で利用できます',
      htmlMissingImages: (sources) =>
        `画像が未取り込みです: ${sources}。原稿をMarkdownまたはJSONで保存し、原稿と画像を同時に読み込んでから出力してください。`,
      htmlImageReadFailed: (source) =>
        `画像を埋め込めません: ${source}。画像を読み込み直してください。`,
      htmlExternalImages:
        '外部URLの画像はリンクのままです。表示には通信が必要です。',
      htmlExportDescription:
        'HTMLは閲覧・発表用です。編集用の原稿はMarkdownまたはJSONで別途保存してください。',
      recoveredDraft: '未保存の作業を復元しました',
      unableToRecover: '未保存の作業を復元できませんでした',
      recoveryUnavailable: '端末内の復旧用保存を利用できません',
    },
    semantic: {
      referenceLabel: '参照ラベル',
      invalidReferenceLabel:
        '英字から始まる128文字以内の英数字・:._-を指定してください。',
      caption: 'キャプション',
      numbering: '番号付け',
      automatic: '自動',
      enabled: '有効',
      disabled: '無効',
      width: '幅（%）',
      figureWidth: '図の幅（%）',
      alignment: '配置',
      left: '左',
      center: '中央',
      right: '右',
      alternativeText: '代替テキスト',
      applyAttributes: '属性を適用',
      numberingHelp:
        '自動ではキャプションまたはラベルのある図・表・式を採番します。見出しの自動は文書の「節番号」に従い、有効・無効は個別に優先します。',
    },
    preview: {
      slides: (count) => `${count} スライド`,
      pages: (count) => `${count} ページ（明示的改ページ）`,
      referenceWarnings: '参照の警告',
      checkReferences: '参照を確認してください',
      slidePreview: 'スライドプレビュー',
      reportPreview: 'A4レポートプレビュー',
      unresolvedReference: '参照先が未定義、または重複しています',
      imageUnavailable: '画像を表示できません',
      toc: '目次',
    },
    recovery: {
      foundTitle: '未保存の作業が見つかりました',
      foundDescription:
        'このブラウザに一時保存された作業があります。復元して続けるか、削除して新しい文書を開始できます。',
      savedAt: (title, time) => `「${title}」・${time} に一時保存`,
      restore: '復元する',
      discard: '削除する',
      restoring: '復元中…',
    },
    manual: {
      projectTitle: '6. 長いレポートを章に分ける',
      projectSteps: [
        'Reportを開き、左側の「現在のReportをプロジェクト化」を選びます。「空の章を追加」または「原稿を章として追加」（原稿1件＋画像）で章を増やします。',
        '章名を選んで編集し、上へ／下へで順序を変えます。「全体出力に含める」を外すと原稿を残したまま除外します。削除には確認が必要です。',
        '章の先頭と本文の改ページを組み合わせます。全体プレビューは1ページずつ表示し、目次・参照のリンクから別ページへ移動できます。番号と参照は有効な章全体で計算します。',
        '「プロジェクトZIPを保存」で構成、全章、取り込んだ画像をまとめて保存します。再開時は「プロジェクトZIPを開く」を使います。Markdownで表せない章はZIP内でJSONとして保持します。',
        '上部の「章 Markdown／章 JSON」は編集中の章だけ、「全体をMarkdown／JSONで出力」は有効な章を結合した文書だけを保存します。プロジェクトの保存にはZIPを使用してください。構成変更はUndoの対象外で、章の切替・削除で本文のUndo履歴をリセットします。',
        '復旧用コピーは未完了作業の再開を補助しますが、タブを閉じる前にZIPを保存してください。外部URL画像はリンクのままです。自動A4組版やスライドの章別管理には対応していません。',
      ],
      recoveryTitle: '端末内の復旧用保存',
      recoverySteps: [
        '未保存の本文、章構成、未適用Markdown、取り込んだ画像は、このブラウザ内に一時保存されます。次回開いたときに復元するか選べます。',
        '復旧用保存は端末内だけで、公開サイトやリポジトリへ送信されません。ブラウザのデータ削除や容量不足で失われる場合があるため、Markdown／JSON／プロジェクトZIPを原本として保存してください。',
      ],
      title: 'KUMI かんたんガイド',
      description:
        'Markdownからレポートやスライドを作るための、最初に知っておきたい操作をまとめています。',
      startTitle: '1. はじめる',
      startSteps: [
        '左下の「Markdownを開く」からMarkdownまたはDocument JSONを読み込みます。画像は同時に選ぶとローカルプレビューに使用できます。',
        'Report／Slideで空の文書を開始できます。読み込んだ内容はブラウザ内で編集され、公開サイトへ自動送信されません。',
      ],
      editTitle: '2. 編集する',
      editSteps: [
        '「ビジュアル編集」で本文を直接編集し、上部の書式ボタンで見出し、リスト、引用、表、数式を追加します。',
        'Slideでは「図を配置」を開き、「画像を挿入」で画像を選びます。図をドラッグして移動し、8方向のハンドルで大きさを変えられます。矢印キーは1%、Shift＋矢印キーは5%移動です。',
        '「Markdown」では原稿を直接編集します。変更後は「Markdownを適用」またはMarkdown／JSON保存を選んでください。',
        '要素を選ぶと右側のPropertiesでテーマ、目次、番号、参照ラベル、図の代替テキストなどを設定できます。',
      ],
      tableTitle: '3. 表を高度に編集する',
      tableSteps: [
        '表のセル内にカーソルを置くと、表専用ツールバーが現れます。上／下の行、左／右の列を追加・削除し、選択中の行をヘッダー行へ切り替えられます。',
        '隣接する複数セルを選択して「セルを結合」を押します。結合範囲の同じ外周辺で罫線設定が異なる場合は、設定を統一するまで結合できません。結合済みセル内で「セルを分割」を押すと元のグリッドへ戻せます。',
        '罫線では、全体・外側・内側・各辺を選び、色・実線／破線／点線／二重線・太さを指定して適用します。「罫線を消す」に切り替えると、同じ対象の線だけを消去できます。',
        '通常の表は標準Markdown表として保存されます。結合セル、個別罫線、複数段落を含む表は、KUMIの可逆表ブロックとしてMarkdownに保存されます。外部のMarkdown編集器でそのブロックを変更せず、JSONまたはプロジェクトZIPも原本として保存してください。',
      ],
      exportTitle: '4. 確認・保存する',
      exportSteps: [
        '「完成プレビュー」でReportはA4ページ、Slideは16:9スライドとして確認できます。',
        'ヘッダーのMarkdownまたはJSONでファイルを保存します。Document JSONはMarkdownで表せない構造も保持できます。',
        'Slide文書では「HTML」で閲覧・発表用の単一HTMLファイルを出力できます。ブラウザで開き、前へ／次へボタンや矢印キーで移動します。Fキーで全画面表示に切り替えられます（対応ブラウザのみ）。',
        '数式用フォントと取り込んだ画像はHTMLに含まれます。外部URLの画像には通信が必要です。HTML出力だけでは編集用原稿は保存されないため、MarkdownまたはJSONも保存してください。',
      ],
      preferencesTitle: '5. 表示を切り替える',
      preferencesSteps: [
        'ヘッダーの月／太陽ボタンでライト・ダークモードを切り替えます。文書の紙面プレビューは読みやすさのため白い紙面として保たれます。',
        '「EN」または「日本語」ボタンでアプリ操作画面を切り替えます。編集中の文書本文は自動翻訳されません。',
      ],
      privacyTitle: '公開版を使うときの注意',
      privacyText:
        'GitHub Pagesは公開サイトです。顧客情報、個人情報、秘密情報、アクセストークンを含む文書や画像は読み込ませないでください。',
    },
  },
  en: {
    project: projectMessages.en,
    app: {
      darkMode: 'Dark mode',
      englishInterface: 'English interface',
      switchToEnglish: 'Switch to English',
      switchToJapanese: 'Switch to Japanese',
      switchToDark: 'Switch to dark mode',
      switchToLight: 'Switch to light mode',
      manual: 'Guide',
      close: 'Close',
    },
    workspace: {
      documentPanel: 'DOCUMENT',
      propertiesPanel: 'PROPERTIES',
      showDocumentPanel: 'Open document panel',
      showPropertiesPanel: 'Open Properties',
      markdownFile: 'Markdown file',
      documentStructure: 'Document outline',
      noOutline: 'There are no outline items yet',
      importHint: 'Markdown / Document JSON + images',
      openMarkdown: 'Open Markdown',
      newReport: 'Report',
      newSlide: 'Slide',
      visual: 'Visual editor',
      markdown: 'Markdown',
      preview: 'Preview',
      slideLayout: 'Place images',
      insertImage: 'Insert image',
      chooseImage: 'Choose image',
      previousSlide: 'Previous slide',
      nextSlide: 'Next slide',
      slidePosition: 'Slide being edited',
      slidePositionValue: (index, count) =>
        String(index) + ' / ' + String(count),
      slideLayoutHelp:
        'Insert an image or click a document-flow figure to start placing it. Drag to move it, use the selection handles to resize it, and use arrow keys for fine movement or, with a focused handle, resizing.',
      resizeImage: (direction) => 'Resize image: ' + direction,
      switchToView: (label) => `Switch to ${label}`,
      format: 'Formatting',
      bold: 'Bold',
      italic: 'Italic',
      heading1: 'Heading 1',
      heading2: 'Heading 2',
      bulletList: 'Bullet list',
      orderedList: 'Numbered list',
      quote: 'Quote',
      inlineMath: 'Inline math',
      blockMath: 'Block math',
      insertTable: 'Insert table',
      tableTools: 'Table tools',
      tableRows: 'Rows',
      tableColumns: 'Columns',
      addRowAbove: 'Add row above',
      addRowBelow: 'Add row below',
      deleteRow: 'Delete row',
      addColumnBefore: 'Add column before',
      addColumnAfter: 'Add column after',
      deleteColumn: 'Delete column',
      mergeCells: 'Merge cells',
      mergeBorderConflict:
        'The selected perimeter borders differ. Make them consistent before merging.',
      splitCell: 'Split cell',
      toggleHeaderRow: 'Toggle header row',
      deleteTable: 'Delete table',
      tableBorders: 'Borders',
      drawBorders: 'Draw borders',
      eraseBorders: 'Erase borders',
      borderAll: 'All borders',
      borderOuter: 'Outer borders',
      borderInner: 'Inner borders',
      borderTop: 'Top border',
      borderRight: 'Right border',
      borderBottom: 'Bottom border',
      borderLeft: 'Left border',
      borderColor: 'Border color',
      borderStyle: 'Border style',
      borderWidth: 'Border width',
      borderSolid: 'Solid',
      borderDashed: 'Dashed',
      borderDotted: 'Dotted',
      borderDouble: 'Double',
      borderThin: 'Thin',
      borderMedium: 'Medium',
      borderThick: 'Thick',
      insertSlideBreak: 'Insert slide break',
      insertPageBreak: 'Insert page break',
      markdownDraft: 'Markdown draft',
      discard: 'Discard',
      applyMarkdown: 'Apply Markdown',
      document: 'Document',
      type: 'Type',
      title: 'Title',
      theme: 'Theme',
      toc: 'Table of contents',
      sectionNumbers: 'Section numbers',
      slideNumbers: 'Slide numbers',
      referenceLabel: 'Reference label',
      insertReference: 'Insert reference',
      available: 'Available',
      noReferenceLabels: 'Add a reference label to an element first',
      referenceDiagnostics: 'Document reference diagnostics',
      selectedElement: 'Selected element',
      updateEquation: 'Update equation',
      selectElementHint: 'Select an element to\nedit its settings',
      documentBody: 'Document body',
      unsaved: 'Unsaved',
      undo: 'Undo',
      redo: 'Redo',
      report: 'Report',
      slide: 'Slide',
      untitledHeading: 'Untitled heading',
      image: 'Image',
      table: 'Table',
      code: 'Code',
      exportHtml: 'Export HTML slides',
      exportingHtml: 'Exporting HTML slides',
      replaceConfirmation:
        'There are unsaved changes. Open another document and discard them?',
    },
    status: {
      ready: 'Ready',
      readyDescription: 'Document Model and editor are synchronized',
      unableToSerialize: 'Could not serialize the document',
      editing: 'Editing',
      editingDescription: 'Changes are kept in this browser',
      markdownUnsupported:
        'Save this document as Document JSON. It contains structures that Markdown cannot represent.',
      selectOneSource: 'Select exactly one Markdown or Document JSON file',
      unsupportedAttachments: (files) =>
        `Only image attachments can be imported: ${files}`,
      markdownTooLarge: 'Markdown files must be 5 MB or smaller',
      imageTooLarge: 'Each image must be 20 MB or smaller',
      imagesTooLarge: 'The combined image size must be 50 MB or smaller',
      imageInserted: 'Placed the image on the slide',
      unableToInsertImage: 'Could not insert the image',
      unresolvedImages: (sources) =>
        `Could not resolve local images: ${sources}. Select the Markdown file and images together.`,
      loaded: (filename) => `Loaded ${filename}`,
      loadedWithWarnings: (filename) => `Loaded ${filename} with warnings`,
      unableToLoad: 'Could not load the file',
      unableToLoadTitle: 'Could not load Markdown',
      appliedMarkdown: 'Applied Markdown changes',
      unableToApplyMarkdown: 'Could not apply Markdown',
      unableToParseMarkdown: 'Could not parse Markdown',
      createdReport: 'Created a new report document',
      createdSlide: 'Created a new slide document',
      resolveMarkdownChanges: 'Resolve Markdown changes first',
      resolveMarkdownChangesDescription:
        'Apply or discard Markdown changes before returning to the visual editor',
      unableToRefreshMarkdown: 'Could not refresh the Markdown view',
      discardedMarkdown: 'Discarded Markdown changes',
      unableToDiscardMarkdown: 'Could not discard Markdown changes',
      savedMarkdownAfterApplying: 'Applied and saved Markdown',
      savedMarkdown: 'Saved Markdown',
      unableToSaveMarkdown: 'Could not save Markdown',
      savedJsonAfterApplying: 'Applied Markdown and saved Document JSON',
      savedJson: 'Saved Document JSON',
      unableToSaveJson: 'Could not save Document JSON',
      invalidDocumentData: 'Could not validate document data',
      selectMathAgain: 'Select the equation again',
      updatedEquation: 'Updated equation',
      selectedElementRemoved:
        'The selected element no longer exists. Select it again.',
      updatedAttributes: 'Updated attributes',
      unableToUpdateAttributes: 'Could not update attributes',
      checkAttributes: 'Check the attributes',
      editingMarkdown: 'Editing Markdown',
      editingMarkdownDescription:
        'The draft is kept until you apply or save it',
      exportingHtml: 'Generating HTML slides',
      exportedHtml: 'Exported HTML slides',
      htmlExportCancelled:
        'HTML export was cancelled. Export the current document again.',
      unableToExportHtml: 'Could not export HTML slides',
      htmlSlidesOnly: 'HTML export is available for Slide documents',
      htmlMissingImages: (sources) =>
        `Images have not been imported: ${sources}. Save your source as Markdown or JSON, then import it together with the images before exporting.`,
      htmlImageReadFailed: (source) =>
        `Could not embed image: ${source}. Import the image again.`,
      htmlExternalImages:
        'External image URLs remain links and require a network connection.',
      htmlExportDescription:
        'HTML is for viewing and presenting. Save Markdown or JSON separately to keep an editable source.',
      recoveredDraft: 'Restored unsaved work',
      unableToRecover: 'Could not restore unsaved work',
      recoveryUnavailable: 'Device-local recovery is unavailable',
    },
    semantic: {
      referenceLabel: 'Reference label',
      invalidReferenceLabel:
        'Use up to 128 letters, numbers, or :._- characters, starting with a letter.',
      caption: 'Caption',
      numbering: 'Numbering',
      automatic: 'Automatic',
      enabled: 'Enabled',
      disabled: 'Disabled',
      width: 'Width (%)',
      figureWidth: 'Figure width (%)',
      alignment: 'Alignment',
      left: 'Left',
      center: 'Center',
      right: 'Right',
      alternativeText: 'Alternative text',
      applyAttributes: 'Apply attributes',
      numberingHelp:
        'Automatic numbering applies to figures, tables, and equations with a caption or label. Heading numbering follows the document setting; individual enabled or disabled values take precedence.',
    },
    preview: {
      slides: (count) => `${count} slide${count === 1 ? '' : 's'}`,
      pages: (count) =>
        `${count} page${count === 1 ? '' : 's'} (explicit breaks)`,
      referenceWarnings: 'Reference warnings',
      checkReferences: 'Check references',
      slidePreview: 'Slide preview',
      reportPreview: 'A4 report preview',
      unresolvedReference: 'The reference target is missing or duplicated',
      imageUnavailable: 'Image unavailable',
      toc: 'Table of contents',
    },
    recovery: {
      foundTitle: 'Unsaved work found',
      foundDescription:
        'This browser has a temporary copy of unfinished work. Restore it to continue, or remove it and start with a new document.',
      savedAt: (title, time) => `Temporary copy of “${title}” saved ${time}`,
      restore: 'Restore',
      discard: 'Remove',
      restoring: 'Restoring…',
    },
    manual: {
      projectTitle: '6. Split a long report into chapters',
      projectSteps: [
        'Open a Report and choose “Turn this report into a project”. Add a blank chapter or one source file with its images using “Add source as chapter”.',
        'Select a chapter to edit it; use Move up/down to reorder it. Uncheck “Include in combined output” to exclude a chapter without removing its source. Deletion requires confirmation.',
        'Use chapter-start and in-document page breaks together. The project preview renders one page at a time; TOC and reference links navigate to other pages. Numbers and references cover all enabled chapters.',
        '“Save project ZIP” saves the manifest, every chapter and imported images. Resume with “Open project ZIP”. Chapters that Markdown cannot represent are retained as JSON inside the ZIP.',
        'The header saves only the active chapter; combined exports save only enabled chapters as one document. Use a project ZIP to save the project. Structural operations are outside Undo; switching or deleting chapters resets the body Undo history.',
        'A recovery copy can help resume unfinished work, but save a ZIP before closing the tab. External image URLs remain links. Automatic A4 typesetting and chapter-based slide projects are not supported.',
      ],
      recoveryTitle: 'Device-local recovery copy',
      recoverySteps: [
        'Unfinished content, chapter structure, unapplied Markdown, and imported images are temporarily saved in this browser. When you return, choose whether to restore the copy.',
        'The recovery copy stays on this device and is not sent to the published site or repository. Browser data cleanup or storage limits can remove it, so keep Markdown, JSON, or a project ZIP as the source of record.',
      ],
      title: 'KUMI quick guide',
      description:
        'A short introduction to the essential controls for creating reports and slides from Markdown.',
      startTitle: '1. Get started',
      startSteps: [
        'Use “Open Markdown” in the lower-left panel to import Markdown or Document JSON. Select images at the same time to use them in the local preview.',
        'Start a blank Report or Slide from the same panel. Imported content is edited in your browser and is not automatically sent to this published site.',
      ],
      editTitle: '2. Edit',
      editSteps: [
        'Edit directly in the Visual editor. The formatting toolbar adds headings, lists, quotes, tables, and equations.',
        'For Slides, open “Place images” and choose “Insert image”. Drag an image to move it or use its eight handles to resize it. Arrow keys move it by 1%; Shift+Arrow moves it by 5%.',
        'Use the Markdown tab to edit source directly. Choose “Apply Markdown” or save Markdown/JSON after making changes.',
        'Select an element to configure its theme, table of contents, numbering, reference label, or image alternative text in Properties.',
      ],
      tableTitle: '3. Edit tables in detail',
      tableSteps: [
        'Place the cursor in a table cell to reveal the table toolbar. Add or remove rows above/below and columns before/after, and toggle the selected row as a header row.',
        'Select adjacent cells and choose “Merge cells”. If the same perimeter edge has different border settings across the selected cells, make them consistent before merging. In a merged cell, choose “Split cell” to restore its grid.',
        'For borders, choose all, outer, inner, or a single edge; then set the color, solid/dashed/dotted/double style, and width. Switch to “Erase borders” to remove only the same targeted edges.',
        'Simple tables save as standard Markdown tables. Tables with merged cells, per-edge borders, or multiple paragraphs save as a lossless KUMI table block in Markdown. Do not alter that block in an external Markdown editor; also keep JSON or a project ZIP as the source of record.',
      ],
      exportTitle: '4. Review and save',
      exportSteps: [
        'Use Preview to review Reports as A4 pages and Slides as 16:9 slides.',
        'Save Markdown or JSON from the header. Document JSON preserves structures that Markdown cannot express.',
        'For Slide documents, use HTML to export a standalone file for viewing and presenting. Open it in a browser and use Previous/Next or the arrow keys. Press F for fullscreen where supported.',
        'Math fonts and imported images are embedded. External image URLs require a network connection. HTML export does not save your editable source, so also save Markdown or JSON.',
      ],
      preferencesTitle: '5. Change the display',
      preferencesSteps: [
        'Use the moon/sun button in the header to switch between light and dark mode. The document canvas stays paper-white for readability.',
        'Use the EN or 日本語 button to change the application interface. It does not translate the document you are editing.',
      ],
      privacyTitle: 'Using the published version',
      privacyText:
        'GitHub Pages is public. Do not import documents or images containing customer information, personal data, confidential material, or access tokens.',
    },
  },
};
