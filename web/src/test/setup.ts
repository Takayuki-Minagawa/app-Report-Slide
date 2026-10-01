import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(Element.prototype, 'getAnimations', {
  configurable: true,
  value: (): Animation[] => [],
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
});

// jsdom has no layout. ProseMirror measures a Range when a focus command
// scrolls the selection into view, which happens a frame after the command.
const emptyRect = {
  x: 0,
  y: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
} satisfies DOMRect;
Object.defineProperty(Range.prototype, 'getClientRects', {
  configurable: true,
  value: (): DOMRect[] => [],
});
Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: (): DOMRect => emptyRect,
});
