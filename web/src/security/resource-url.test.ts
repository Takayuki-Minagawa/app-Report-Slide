import { describe, expect, it, vi } from 'vitest';

import { isSafeResourceUrl, resolveSafeImageUrl } from './resource-url';

describe('isSafeResourceUrl', () => {
  it.each([
    ['https://example.com/image.png', 'image'],
    ['assets/image.webp', 'image'],
    ['data:image/png;base64,AA==', 'image'],
    ['mailto:test@example.com', 'link'],
    ['#section', 'link'],
  ] as const)('%sを安全な%s URLとして受け入れる', (url, kind) => {
    expect(isSafeResourceUrl(url, kind)).toBe(true);
  });

  it.each([
    ['javascript:alert(1)', 'link'],
    ['vbscript:msgbox(1)', 'link'],
    ['file:///etc/passwd', 'image'],
    ['//example.com/tracker.png', 'image'],
    ['https://example.com/\u0000image.png', 'image'],
    ['https://example.com/\nimage.png', 'image'],
    ['data:text/html,<script>alert(1)</script>', 'image'],
  ] as const)('%sを拒否する', (url, kind) => {
    expect(isSafeResourceUrl(url, kind)).toBe(false);
  });
});

describe('resolveSafeImageUrl', () => {
  it('allows blob URLs only when a safe document path was resolved by the app', () => {
    const resolver = vi.fn(() => 'blob:local-image');
    expect(resolveSafeImageUrl(' chart.png ', resolver)).toBe(
      'blob:local-image',
    );
    expect(resolver).toHaveBeenCalledWith('chart.png');
    resolver.mockClear();
    expect(resolveSafeImageUrl('blob:untrusted', resolver)).toBeUndefined();
    expect(
      resolveSafeImageUrl('javascript:alert(1)', resolver),
    ).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('checks the resolved URL too and handles non-string attributes safely', () => {
    expect(
      resolveSafeImageUrl('image.png', () => 'javascript:alert(1)'),
    ).toBeUndefined();
    expect(resolveSafeImageUrl(undefined)).toBeUndefined();
    expect(resolveSafeImageUrl('constructor')).toBe('constructor');
    expect(resolveSafeImageUrl('https://example.com/image.png')).toBe(
      'https://example.com/image.png',
    );
  });
});
