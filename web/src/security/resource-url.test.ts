import { describe, expect, it } from 'vitest';

import { isSafeResourceUrl } from './resource-url';

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
