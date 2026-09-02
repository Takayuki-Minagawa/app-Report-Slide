export const supportedLocales = ['ja', 'en'] as const;

export type AppLocale = (typeof supportedLocales)[number];

export interface UiMessages {
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
    markdownFile: string;
    documentStructure: string;
    noOutline: string;
    importHint: string;
    openMarkdown: string;
    newReport: string;
    newSlide: string;
    visual: string;
    markdown: string;
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
  manual: {
    title: string;
    description: string;
    startTitle: string;
    startSteps: readonly string[];
    editTitle: string;
    editSteps: readonly string[];
    exportTitle: string;
    exportSteps: readonly string[];
    preferencesTitle: string;
    preferencesSteps: readonly string[];
    privacyTitle: string;
    privacyText: string;
  };
}

export const messages: Record<AppLocale, UiMessages> = {
  ja: {
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
    manual: {
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
        '「Markdown」では原稿を直接編集します。変更後は「Markdownを適用」または保存を選んでください。',
        '要素を選ぶと右側のPropertiesでテーマ、目次、番号、参照ラベル、図の代替テキストなどを設定できます。',
      ],
      exportTitle: '3. 確認・保存する',
      exportSteps: [
        '「完成プレビュー」でReportはA4ページ、Slideは16:9スライドとして確認できます。',
        'ヘッダーのMarkdownまたはJSONでファイルを保存します。Document JSONはMarkdownで表せない構造も保持できます。',
      ],
      preferencesTitle: '4. 表示を切り替える',
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
    manual: {
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
        'Use the Markdown tab to edit source directly. Choose “Apply Markdown” or save after making changes.',
        'Select an element to configure its theme, table of contents, numbering, reference label, or image alternative text in Properties.',
      ],
      exportTitle: '3. Review and save',
      exportSteps: [
        'Use Preview to review Reports as A4 pages and Slides as 16:9 slides.',
        'Save Markdown or JSON from the header. Document JSON preserves structures that Markdown cannot express.',
      ],
      preferencesTitle: '4. Change the display',
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
