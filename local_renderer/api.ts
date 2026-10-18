// Use the same validation, rendering, serialization and ZIP format as the UI.
import { configure } from '@zip.js/zip.js';
configure({ useWebWorkers: false });
export { exportReportHtml } from '../web/src/export/report-html';
export { exportSlideHtml } from '../web/src/export/slide-html';
export {
  migrateDocumentData,
  validateDocumentData,
} from '../web/src/document/validation';
export { parseMarkdown } from '../web/src/markdown/parser';
export { serializeDocument } from '../web/src/markdown/serializer';
export {
  referencedAssets,
  documentAssetMime,
} from '../web/src/document/assets';
export {
  splitDocumentPages,
  analyzeDocument,
} from '../web/src/document/semantics';
export {
  writeDocumentArchive,
  readDocumentArchive,
} from '../web/src/workspace/document-archive';
export { revokeAssetUrls } from '../web/src/workspace/files';
export { projectLimits } from '../web/src/project/archive';
