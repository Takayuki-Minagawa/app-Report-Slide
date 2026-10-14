#!/usr/bin/env python3
"""Reproduce Kumi's OFL-1.1 print fonts from hash-pinned Google Fonts files."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import urllib.request

import brotli
import fontTools
from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
EXCLUDED = ((0x2E80, 0x2FFF), (0xF900, 0xFAFF), (0x2F800, 0x2FA1F))


def excluded(codepoint):
    return any(start <= codepoint <= end for start, end in EXCLUDED)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source_file(path, url, expected):
    if not path.exists():
        with urllib.request.urlopen(url, timeout=120) as response:
            path.write_bytes(response.read())
    data = path.read_bytes()
    if digest(data) != expected:
        raise ValueError(f"Unexpected source hash: {path}")
    return data


def axes(font):
    return [(axis.axisTag, axis.minValue, axis.defaultValue, axis.maxValue)
            for axis in font['fvar'].axes]


def cmap_by_glyph_id(font):
    return {codepoint: font.getGlyphID(glyph)
            for codepoint, glyph in font.getBestCmap().items()}


def variation_sequences(font, filtered=False):
    return [(table.platformID, table.platEncID,
             {selector: [(codepoint, None if glyph is None else font.getGlyphID(glyph))
                         for codepoint, glyph in entries
                         if not filtered or not excluded(codepoint)]
              for selector, entries in table.uvsDict.items()})
            for table in font['cmap'].tables if table.format == 14]


def verify(original, result):
    before = cmap_by_glyph_id(original)
    after = cmap_by_glyph_id(result)
    assert after == {cp: gid for cp, gid in before.items() if not excluded(cp)}
    assert len(original['cmap'].tables) == len(result['cmap'].tables)
    for left, right in zip(original['cmap'].tables, result['cmap'].tables):
        assert (left.platformID, left.platEncID, left.format) == (right.platformID, right.platEncID, right.format)
        expected = {cp: original.getGlyphID(glyph) for cp, glyph in getattr(left, 'cmap', {}).items() if not excluded(cp)}
        actual = {cp: result.getGlyphID(glyph) for cp, glyph in getattr(right, 'cmap', {}).items()}
        assert expected == actual
    assert variation_sequences(original, filtered=True) == variation_sequences(result)
    assert axes(original) == axes(result)
    assert len(original.getGlyphOrder()) == len(result.getGlyphOrder())
    assert len(original['fvar'].instances) == len(result['fvar'].instances)
    assert [item.coordinates for item in original['fvar'].instances] == [item.coordinates for item in result['fvar'].instances]
    assert original['OS/2'].fsType == result['OS/2'].fsType == 0
    for table in result['cmap'].tables:
        assert not any(excluded(cp) for cp in getattr(table, 'cmap', {}))
    # Drawing both normal and bold checks that compression retained variable outlines.
    for weight in (400, 700):
        assert any(tag == 'wght' and low <= weight <= high for tag, low, _, high in axes(result))
        original_glyphs = original.getGlyphSet(location={'wght': weight})
        result_glyphs = result.getGlyphSet(location={'wght': weight})
        for character in '日本語の本文検索構造解析ABC123':
            cp = ord(character)
            assert cp in after, f'Missing character: {character}'
            left, right = RecordingPen(), RecordingPen()
            original_glyphs[original.getBestCmap()[cp]].draw(left)
            result_glyphs[result.getBestCmap()[cp]].draw(right)
            assert left.value == right.value, f'Outline changed: {character}, {weight}'


def generate(key, source, cache, output_dir):
    ttf_path = cache / f'{key}.ttf'
    source_file(ttf_path, source['source_url'], source['source_sha256'])
    license_bytes = source_file(cache / f'{key}-OFL.txt', source['license_url'], source['license_sha256'])
    original = TTFont(ttf_path, recalcTimestamp=False)
    font = TTFont(ttf_path, recalcTimestamp=False)
    before = font.getBestCmap()
    removed = sorted(cp for cp in before if excluded(cp))
    for table in font['cmap'].tables:
        if hasattr(table, 'cmap'):
            table.cmap = {cp: glyph for cp, glyph in table.cmap.items() if not excluded(cp)}
        if table.format == 14:
            table.uvsDict = {selector: [(cp, glyph) for cp, glyph in entries if not excluded(cp)]
                             for selector, entries in table.uvsDict.items()}
    names = font['name']
    for record in list(names.names):
        value = record.toUnicode()
        if record.nameID not in (0, 7, 8, 9, 11, 12, 13, 14):
            value = value.replace(source['original_family'], source['family'])
            value = value.replace(source['original_postscript_prefix'], source['postscript_prefix'])
        if record.nameID in (1, 16, 21):
            value = source['family']
        elif record.nameID == 13:
            # The license travels with an embedded font as well as its separate file.
            value = license_bytes.decode('utf-8')
        names.setName(value, record.nameID, record.platformID, record.platEncID, record.langID)
    font.flavor = 'woff2'
    destination = output_dir / source['output']
    font.save(destination, reorderTables=True)
    (output_dir / source['license_file']).write_bytes(license_bytes)
    result = TTFont(destination, recalcTimestamp=False)
    verify(original, result)
    for name_id in (1, 16):
        assert all(record.toUnicode() == source['family'] for record in result['name'].names if record.nameID == name_id)
    data = destination.read_bytes()
    entry = {
        **source,
        'output_sha256': digest(data),
        'output_bytes': len(data),
        'source_bytes': ttf_path.stat().st_size,
        'glyph_count': len(result.getGlyphOrder()),
        'source_unicode_count': len(before),
        'output_unicode_count': len(result.getBestCmap()),
        'removed_codepoints': [f'U+{cp:04X}' for cp in removed],
        'axes': axes(result),
        'tested_weights': [400, 700],
    }
    print(f"{destination.name}: {len(data):,} bytes; {len(removed)} cmap entries removed; SHA256 {digest(data)}", flush=True)
    return entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, help='Optional hash-verified source cache; default uses a temporary directory.')
    parser.add_argument('--output-dir', type=Path, default=ROOT)
    args = parser.parse_args()
    assert fontTools.__version__ == '4.60.1', 'Install requirements.txt for reproducible output'
    assert brotli.__version__ == '1.1.0', 'Install requirements.txt for reproducible output'
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='kumi-print-fonts-') as temporary:
        cache = args.source_dir or Path(temporary)
        cache.mkdir(parents=True, exist_ok=True)
        sources = json.loads((ROOT / 'sources.json').read_text())
        report = {
            'fonttools': fontTools.__version__, 'brotli': brotli.__version__,
            'excluded_ranges': [[f'U+{low:04X}', f'U+{high:04X}'] for low, high in EXCLUDED],
            'fonts': {key: generate(key, source, cache, args.output_dir) for key, source in sources.items()},
        }
        (args.output_dir / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
