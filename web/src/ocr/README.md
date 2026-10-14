# Browser OCR runtime

OCR runs on demand in a dedicated, same-origin Web Worker. Input image bytes stay in the browser. Models are cached in IndexedDB; source images and recognized text are never placed in that cache. Each job owns its worker and terminates it on success, error, cancellation or the two-minute timeout, including during initialization. Recognition accepts Japanese, English or both and returns unmodified text, word boxes and engine confidence scores for user review. Confidence is not a probability of correctness.

The image is decoded locally and normalized to an opaque PNG to handle transparency, WebP and EXIF orientation consistently. Processing is capped at 20 MiB input, 8 million pixels and 4,096 pixels on either side. Coordinates and crop rectangles always refer to the normalized original image. Cropping never changes the source asset.

## Pinned dependencies and assets

- `tesseract.js@6.0.1` provides `dist/worker.min.js` (Apache-2.0).
- `tesseract.js-core` is resolved by `package-lock.json`; the output URL includes its installed version. The four upstream `.wasm.js` builds are self-contained WASM bundles; the runtime selects SIMD/LSTM according to browser capabilities (Apache-2.0).
- `@tesseract.js-data/jpn@1.0.0` and `@tesseract.js-data/eng@1.0.0` provide only their `4.0.0_best_int/*.traineddata.gz` files to the site. The npm wrappers describe their package license as MIT; the underlying traineddata are from Tesseract's Apache-2.0 models. Combined compressed models total approximately 4.98 MB. The normal LSTM core downloaded by a capable browser is approximately 3.95 MB.
- `build/ocr-assets-plugin.ts` emits the worker, core, models and applicable licenses under an install-versioned `ocr/` path and respects the GitHub Pages repository prefix. It never emits or downloads user files.
- `build/ocr-licenses/TESSDATA_LICENSE.txt` is the unmodified model license from [tessdata_best at e12c65a](https://github.com/tesseract-ocr/tessdata_best/blob/e12c65a915945e4c28e237a9b52bc4a8f39a0cec/LICENSE).

## Upstream interface

The short adapter in `ocr-engine.ts` mirrors the fixed v6 worker messages in [createWorker.js](https://github.com/naptha/tesseract.js/blob/v6.0.1/src/createWorker.js): load → loadLanguage → initialize → setParameters → recognize. It owns the native worker because the public asynchronous `createWorker()` does not expose `terminate()` until initialization has finished. This enables immediate cancellation even during model loading. Upgrade the package only together with the adapter unit tests and the real worker browser test.

Sources: [local asset paths](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/local-installation.md), [recognition and blocks API](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/api.md), [language model distribution](https://github.com/naptha/tessdata), [model origin and license](https://github.com/tesseract-ocr/tessdata_best).

Printed, upright, sufficiently large text is the intended input. Handwriting, low resolution scans, vertical text, complex equations and merged table layouts require manual review and correction. This is reflected in the review UI; OCR never silently replaces source figures.
