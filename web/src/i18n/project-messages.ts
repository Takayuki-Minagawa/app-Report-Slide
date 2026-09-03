export interface ProjectMessages {
  panel: string;
  newChapter: (index: number) => string;
  saveChapterMarkdown: string;
  saveChapterJson: string;
  chapterSaveHint: string;
  lockedHint: string;
  previewNavigation: string;
  page: string;
  rename: string;
  singleDocument: string;
  createProject: string;
  openProject: string;
  saveProject: string;
  exportProjectMarkdown: string;
  exportProjectJson: string;
  projectName: string;
  chapters: string;
  addBlankChapter: string;
  addChapterFiles: string;
  renameChapter: string;
  includeChapter: string;
  excludedChapter: string;
  chapterBreak: string;
  moveUp: string;
  moveDown: string;
  deleteChapter: string;
  deleteConfirmation: (title: string) => string;
  replaceConfirmation: string;
  activeChapter: string;
  projectBadge: string;
  previousPage: string;
  nextPage: string;
  pagePosition: (current: number, total: number) => string;
  status: {
    created: string;
    opened: (filename: string) => string;
    saved: string;
    chapterAdded: (title: string) => string;
    chapterSelected: (title: string) => string;
    chapterUpdated: string;
    chapterDeleted: (title: string) => string;
    projectExported: string;
    unableToOpen: string;
    unableToSave: string;
    unableToChange: string;
    reportOnly: string;
    invalidArchive: string;
    unsafePath: string;
    archiveTooLarge: string;
    tooManyFiles: string;
    missingFile: (filename: string) => string;
    missingImage: (filename: string) => string;
    unsupportedFile: (filename: string) => string;
    lastChapter: string;
  };
}

export const projectMessages: Record<'ja' | 'en', ProjectMessages> = {
  ja: {
    panel: '章別プロジェクト',
    newChapter: (index) => `第${index}章`,
    saveChapterMarkdown: '章 Markdown',
    saveChapterJson: '章 JSON',
    chapterSaveHint:
      '上部のMarkdown / JSONは編集中の章だけを保存します。構成・全章・画像はプロジェクトZIPで保存してください。',
    lockedHint:
      '章の操作を続けるには、Markdownを適用または破棄してビジュアル編集に戻ってください。',
    previewNavigation: 'プレビューページの移動',
    page: '表示ページ',
    rename: '名前を更新',
    singleDocument: '単一文書',
    createProject: '現在のReportをプロジェクト化',
    openProject: 'プロジェクトZIPを開く',
    saveProject: 'プロジェクトZIPを保存',
    exportProjectMarkdown: '全体をMarkdownで出力',
    exportProjectJson: '全体をJSONで出力',
    projectName: 'プロジェクト名',
    chapters: '章',
    addBlankChapter: '空の章を追加',
    addChapterFiles: '原稿を章として追加',
    renameChapter: '章名',
    includeChapter: '全体出力に含める',
    excludedChapter: '除外中',
    chapterBreak: '章の前で改ページ',
    moveUp: '上へ移動',
    moveDown: '下へ移動',
    deleteChapter: '章を削除',
    deleteConfirmation: (title) =>
      `「${title}」をプロジェクトから削除しますか？端末の元ファイルは削除されません。`,
    replaceConfirmation:
      '未保存のプロジェクト変更があります。別の文書を開いて変更を破棄しますか？',
    activeChapter: '編集中',
    projectBadge: 'PROJECT',
    previousPage: '前のページ',
    nextPage: '次のページ',
    pagePosition: (current, total) => `${current} / ${total} ページ`,
    status: {
      created: '章別プロジェクトを作成しました',
      opened: (filename) => `${filename}を開きました`,
      saved: 'プロジェクトZIPを保存しました',
      chapterAdded: (title) => `章「${title}」を追加しました`,
      chapterSelected: (title) => `章「${title}」を開きました`,
      chapterUpdated: 'プロジェクト構成を更新しました',
      chapterDeleted: (title) => `章「${title}」を削除しました`,
      projectExported: '有効な章を一つのレポートとして出力しました',
      unableToOpen: 'プロジェクトZIPを開けませんでした',
      unableToSave: 'プロジェクトを保存できませんでした',
      unableToChange: 'プロジェクト構成を変更できませんでした',
      reportOnly: '章別プロジェクトではReport文書だけを使用できます',
      invalidArchive: 'プロジェクトZIPの形式が正しくありません',
      unsafePath: 'プロジェクトに安全でないファイルパスがあります',
      archiveTooLarge: 'プロジェクトZIPまたは展開後のファイルが大きすぎます',
      tooManyFiles: 'プロジェクト内のファイル数が多すぎます',
      missingFile: (filename) => `必要なファイルがありません: ${filename}`,
      missingImage: (filename) => `画像が読み込まれていません: ${filename}`,
      unsupportedFile: (filename) =>
        `プロジェクト内に未対応のファイルがあります: ${filename}`,
      lastChapter: '最後の章は削除できません',
    },
  },
  en: {
    panel: 'Chapter project',
    newChapter: (index) => `Chapter ${index}`,
    saveChapterMarkdown: 'Chapter Markdown',
    saveChapterJson: 'Chapter JSON',
    chapterSaveHint:
      'The header saves only the active chapter. Save a project ZIP to keep the structure, all chapters and images.',
    lockedHint:
      'Apply or discard Markdown and return to the visual editor before changing chapters.',
    previewNavigation: 'Preview page navigation',
    page: 'Visible page',
    rename: 'Update name',
    singleDocument: 'Single document',
    createProject: 'Turn this report into a project',
    openProject: 'Open project ZIP',
    saveProject: 'Save project ZIP',
    exportProjectMarkdown: 'Export combined Markdown',
    exportProjectJson: 'Export combined JSON',
    projectName: 'Project name',
    chapters: 'Chapters',
    addBlankChapter: 'Add a blank chapter',
    addChapterFiles: 'Add source as chapter',
    renameChapter: 'Chapter name',
    includeChapter: 'Include in combined output',
    excludedChapter: 'Excluded',
    chapterBreak: 'Page break before chapter',
    moveUp: 'Move up',
    moveDown: 'Move down',
    deleteChapter: 'Delete chapter',
    deleteConfirmation: (title) =>
      `Delete “${title}” from this project? The original file on your device will not be deleted.`,
    replaceConfirmation:
      'This project has unsaved changes. Open another document and discard them?',
    activeChapter: 'Editing',
    projectBadge: 'PROJECT',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    pagePosition: (current, total) => `Page ${current} of ${total}`,
    status: {
      created: 'Created a chapter project',
      opened: (filename) => `Opened ${filename}`,
      saved: 'Saved the project ZIP',
      chapterAdded: (title) => `Added chapter “${title}”`,
      chapterSelected: (title) => `Opened chapter “${title}”`,
      chapterUpdated: 'Updated the project structure',
      chapterDeleted: (title) => `Deleted chapter “${title}”`,
      projectExported: 'Exported enabled chapters as one report',
      unableToOpen: 'Could not open the project ZIP',
      unableToSave: 'Could not save the project',
      unableToChange: 'Could not change the project structure',
      reportOnly: 'Chapter projects can contain Report documents only',
      invalidArchive: 'The project ZIP has an invalid format',
      unsafePath: 'The project contains an unsafe file path',
      archiveTooLarge: 'The project ZIP or an extracted file is too large',
      tooManyFiles: 'The project contains too many files',
      missingFile: (filename) => `A required file is missing: ${filename}`,
      missingImage: (filename) => `An image has not been loaded: ${filename}`,
      unsupportedFile: (filename) =>
        `The project contains an unsupported file: ${filename}`,
      lastChapter: 'The final chapter cannot be deleted',
    },
  },
};
