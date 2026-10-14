# Kumi print fonts

These modified variable fonts are used only by the browser-print HTML export.
They provide a stable Japanese font for PDF text extraction instead of relying
on the operating system's font substitution. They are not the application's
general UI fonts.

| Output                   | Upstream family | Variable weight range | License                          |
| ------------------------ | --------------- | --------------------- | -------------------------------- |
| `KumiPrintSansJP.woff2`  | Noto Sans JP    | 100–900               | [OFL-Sans.txt](./OFL-Sans.txt)   |
| `KumiPrintSerifJP.woff2` | Noto Serif JP   | 200–900               | [OFL-Serif.txt](./OFL-Serif.txt) |

Source: Google's official [Noto Sans JP directory](https://github.com/google/fonts/tree/66a36c8c94b1a5d992ee4e7f392fccfe4945767c/ofl/notosansjp)
and [Noto Serif JP directory](https://github.com/google/fonts/tree/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoserifjp).
The downloaded TTF and license URLs, fixed revisions, and SHA-256 hashes are in
[`sources.json`](./sources.json). The output hashes, byte sizes, variable axes,
and exact removed codepoints are in [`manifest.json`](./manifest.json).

## Modifications

- Rename the internal font families to **Kumi Print Sans JP** and
  **Kumi Print Serif JP**, including PostScript names and variable-instance names.
- Remove cmap mappings only for U+2E80–U+2FFF (CJK radicals), U+F900–U+FAFF
  (compatibility ideographs), and U+2F800–U+2FA1F (supplementary compatibility
  ideographs). These aliases can cause PDF glyph-to-Unicode reverse lookup to
  return compatibility characters such as `⽇` instead of the original `日`.
  Variant-sequence mappings whose base character is in those ranges are removed
  too. All other character mappings, variation sequences, glyphs, and variable
  weight data remain present. This does not rewrite source-document text.
- Encode the result as WOFF2, preserving the original font timestamps so that
  pinned tool versions produce deterministic files.
- Keep upstream copyright and attribution metadata. Include the complete
  upstream SIL Open Font License in the font's name ID 13 as well as the adjacent
  license files. Keep those notices when distributing or embedding these fonts.

Intentional limitation: documents that explicitly contain characters from the
excluded ranges require another font for those characters. The print fonts do
not map them back to a unified ideograph or silently normalize document text.

## Regeneration and verification

Use Python 3.9 or newer in an isolated environment:

```sh
python3 -m venv /tmp/kumi-print-font-env
/tmp/kumi-print-font-env/bin/python -m pip install -r web/src/export/fonts/requirements.txt
/tmp/kumi-print-font-env/bin/python web/src/export/fonts/generate.py
```

The generator downloads only the fixed source URLs and rejects a SHA mismatch.
For an offline run, provide `--source-dir PATH` containing `sans.ttf`,
`serif.ttf`, `sans-OFL.txt`, and `serif-OFL.txt`; those cached files are also hash
checked. Use `--output-dir PATH` to verify regenerated files without overwriting
the checked-in files. `requirements.txt` pins the compression tool versions.

Each run reopens both compressed fonts and checks every retained Unicode-to-glyph
ID mapping, all retained variation sequences, every variable axis and named
instance coordinate, glyph counts, embedding permissions, and family names.
It compares representative Japanese and Latin outlines at weights **400 and 700**
against the original TTF. Browser PDF extraction is tested separately by the
print-export E2E suite; this structural check does not substitute for that test.

The modified font software remains under **SIL Open Font License 1.1**. The two
upstream notices differ and are preserved separately. This is an independent
modification, not an upstream release or endorsement.
