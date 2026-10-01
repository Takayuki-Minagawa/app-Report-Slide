import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportSlideHtml } from './slide-html';
import playerSource from './slide-player.js?raw';

const source = [
  '---',
  'type: slide',
  'title: Player',
  '---',
  '',
  '# One',
  '',
  '[jump](#slide-3)',
  '',
  '::: notes',
  'Notes for **one**.',
  ':::',
  '',
  '::: slidebreak',
  ':::',
  '',
  '# Two',
  '',
  '::: slidebreak',
  ':::',
  '',
  '# Three',
].join('\n');

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const visibleSlides = () =>
  [...document.querySelectorAll<HTMLElement>('.deck-slide')]
    .filter((slide) => !slide.hidden)
    .map((slide) => slide.id);
const press = (key: string, target: EventTarget = document.body) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
const root = () => document.documentElement;

// The player registers document listeners, so one deck is shared by every test.
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.useFakeTimers();
  const { html } = await exportSlideHtml(
    parseMarkdown(source).document,
    new Map(),
    'en',
  );
  const exported = new DOMParser().parseFromString(html, 'text/html');
  document.documentElement.lang = 'en';
  document.title = exported.title;
  document.body.innerHTML = exported.body.innerHTML;
  window.eval(playerSource);
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('standalone slide player', () => {
  it('starts on the first slide with its controls and notes ready', () => {
    expect(root().classList.contains('deck-ready')).toBe(true);
    expect(visibleSlides()).toEqual(['slide-1']);
    expect(byId('deck-controls').hidden).toBe(false);
    expect(byId('deck-counter').textContent).toBe('1 / 3');
    expect(byId('deck-notes').hidden).toBe(true);
    expect(byId('deck-notes-toggle').hidden).toBe(false);
    expect(byId<HTMLButtonElement>('deck-previous').disabled).toBe(true);
  });

  it('moves with keys and jumps to a typed slide number', () => {
    press('ArrowRight');
    expect(visibleSlides()).toEqual(['slide-2']);
    press('End');
    expect(visibleSlides()).toEqual(['slide-3']);
    expect(byId<HTMLButtonElement>('deck-next').disabled).toBe(true);
    press('1');
    expect(byId('deck-status').textContent).toBe(
      'Go to slide number (press Enter): 1',
    );
    press('Enter');
    expect(visibleSlides()).toEqual(['slide-1']);
    expect(byId('deck-status').textContent).toBe('');

    // Out-of-range numbers clamp; Escape and other keys cancel a pending number.
    press('9');
    press('9');
    press('Enter');
    expect(visibleSlides()).toEqual(['slide-3']);
    press('2');
    press('Escape');
    press('Enter');
    expect(visibleSlides()).toEqual(['slide-3']);
    press('1');
    press('Home');
    expect(byId('deck-status').textContent).toBe('');
    expect(visibleSlides()).toEqual(['slide-1']);
  });

  it('lets a focused button keep Enter unless a number is being typed', () => {
    const next = byId('deck-next');
    expect(press('Enter', next)).toBe(true);
    expect(press(' ', next)).toBe(true);
    press('3', next);
    expect(press('Enter', next)).toBe(false);
    expect(visibleSlides()).toEqual(['slide-3']);
    press('Home');
  });

  it('shows every slide in the overview and opens the chosen one', () => {
    press('o');
    expect(root().classList.contains('deck-overview')).toBe(true);
    expect(byId('deck-overview').getAttribute('aria-pressed')).toBe('true');
    expect(visibleSlides()).toEqual(['slide-1', 'slide-2', 'slide-3']);
    press('ArrowRight');
    expect(byId('slide-2').hasAttribute('data-current')).toBe(true);
    expect(visibleSlides()).toHaveLength(3);
    press('Enter');
    expect(root().classList.contains('deck-overview')).toBe(false);
    expect(visibleSlides()).toEqual(['slide-2']);

    // A click chooses the slide and must not follow the link inside it.
    press('Home');
    byId('deck-overview').click();
    const link = byId('slide-1').querySelector('a')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(visibleSlides()).toEqual(['slide-1']);
    press('o');
    press('Escape');
    expect(visibleSlides()).toEqual(['slide-1']);
  });

  it('follows in-deck links outside the overview', () => {
    byId('slide-1').querySelector('a')!.click();
    expect(visibleSlides()).toEqual(['slide-3']);
    press('Home');
  });

  it('toggles blackout and leaves it with Escape', () => {
    press('b');
    expect(root().classList.contains('deck-blackout')).toBe(true);
    press('.');
    expect(root().classList.contains('deck-blackout')).toBe(false);
    press('B');
    press('Escape');
    expect(root().classList.contains('deck-blackout')).toBe(false);
    expect(visibleSlides()).toEqual(['slide-1']);
  });

  it('shows the notes of the current slide', () => {
    press('n');
    const notes = [...document.querySelectorAll<HTMLElement>('.deck-note')];
    expect(byId('deck-notes').hidden).toBe(false);
    expect(byId('deck-notes-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(notes.map((note) => note.hidden)).toEqual([false, true, true]);
    expect(notes[0].textContent).toBe('Notes for one.');
    press('ArrowRight');
    expect(notes.map((note) => note.hidden)).toEqual([true, false, true]);
    expect(notes[1].textContent).toBe('This slide has no notes.');
    byId('deck-notes-toggle').click();
    expect(byId('deck-notes').hidden).toBe(true);
    press('Home');
  });

  it('changes slides on a horizontal swipe only', () => {
    const viewport = byId('deck-viewport');
    const swipe = (from: [number, number], to: [number, number]) => {
      const start = new Event('touchstart');
      Object.assign(start, {
        touches: [{ clientX: from[0], clientY: from[1] }],
      });
      const end = new Event('touchend');
      Object.assign(end, {
        changedTouches: [{ clientX: to[0], clientY: to[1] }],
      });
      viewport.dispatchEvent(start);
      viewport.dispatchEvent(end);
    };
    swipe([300, 200], [100, 220]);
    expect(visibleSlides()).toEqual(['slide-2']);
    swipe([300, 200], [280, 20]);
    swipe([300, 200], [270, 200]);
    expect(visibleSlides()).toEqual(['slide-2']);
    swipe([100, 200], [300, 190]);
    expect(visibleSlides()).toEqual(['slide-1']);
  });

  it('counts elapsed time and resets it on request', () => {
    const timer = byId('deck-timer');
    vi.advanceTimersByTime(65_000);
    expect(timer.textContent).toMatch(/^01:0[5-6]$/);
    timer.click();
    expect(timer.textContent).toBe('00:00');
  });

  it('reports a blocked presenter window instead of failing', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    press('s');
    expect(byId('deck-status').textContent).toContain('presenter view');
  });

  // The window the deck keeps a reference to, shared by the next two tests.
  const presenterWindow = {
    document: document.implementation.createHTMLDocument(''),
    closed: false,
    focus: vi.fn(),
    close: vi.fn(),
  };

  it('fills a presenter window with the current slide, the next slide and notes', () => {
    const popup = presenterWindow.document;
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue(presenterWindow as unknown as Window);
    byId('deck-presenter').click();
    expect(open).toHaveBeenCalledWith(
      '',
      'kumi-presenter',
      expect.stringContaining('popup'),
    );
    expect(byId('deck-status').textContent).toBe('');
    expect(popup.title).toBe('Presenter view — Player');
    const text = (id: string) => popup.getElementById(id)?.textContent;
    expect(text('presenter-current')).toContain('One');
    expect(text('presenter-next')).toContain('Two');
    expect(text('presenter-notes')).toBe('Notes for one.');
    expect(text('presenter-counter')).toBe('1 / 3');
    expect(popup.querySelector('[id^="slide-"]')).toBeNull();
    expect(popup.querySelector('.deck-slide[hidden]')).toBeNull();

    // Keys pressed in the presenter window drive the deck.
    popup.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    expect(visibleSlides()).toEqual(['slide-3']);
    expect(text('presenter-current')).toContain('Three');
    expect(popup.getElementById('presenter-next')?.childElementCount).toBe(0);
    expect(text('presenter-counter')).toBe('3 / 3');
    vi.advanceTimersByTime(2_000);
    expect(text('presenter-timer')).toBe(byId('deck-timer').textContent);

    // Asking again focuses the open window rather than opening another.
    press('s');
    expect(open).toHaveBeenCalledTimes(1);

    // The presenter's own keys and links act on the deck without disturbing
    // the audience window: no status text, print dialog or second deck.
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const key = (value: string) =>
      popup.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true }),
      );
    key('p');
    expect(print).not.toHaveBeenCalled();
    key('2');
    expect(byId('deck-status').textContent).toBe('');
    expect(text('presenter-status')).toBe(
      'Go to slide number (press Enter): 2',
    );
    key('Enter');
    expect(visibleSlides()).toEqual(['slide-2']);
    expect(text('presenter-status')).toBe('');
    key('Home');
    const link = popup.querySelector<HTMLAnchorElement>(
      '#presenter-current a[href="#slide-3"]',
    )!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(visibleSlides()).toEqual(['slide-3']);
    press('Home');
  });

  it('rebuilds a reloaded presenter window and survives one it may not touch', () => {
    // A reloaded popup is blank again: the next request fills it anew.
    const reloaded = document.implementation.createHTMLDocument('');
    presenterWindow.document = reloaded;
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue(presenterWindow as unknown as Window);
    expect(() => press('ArrowRight')).not.toThrow();
    press('Home');
    press('s');
    expect(open).toHaveBeenCalledTimes(1);
    expect(presenterWindow.focus).toHaveBeenCalledTimes(1);
    expect(reloaded.getElementById('presenter-current')?.textContent).toContain(
      'One',
    );

    // A window that navigated elsewhere throws on access; the deck keeps working.
    Object.defineProperty(presenterWindow, 'document', {
      get() {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    });
    expect(() => press('ArrowRight')).not.toThrow();
    expect(visibleSlides()).toEqual(['slide-2']);
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    press('s');
    expect(open).toHaveBeenCalledTimes(2);
    expect(byId('deck-status').textContent).toContain('presenter view');
    press('Home');
  });
});
