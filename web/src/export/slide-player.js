// This trusted script is embedded verbatim and authorized by its CSP hash.
(() => {
  const root = document.documentElement;
  const byId = (id) => document.getElementById(id);
  const slides = Array.from(document.querySelectorAll('.deck-slide'));
  const notes = Array.from(document.querySelectorAll('.deck-note'));
  const previous = byId('deck-previous');
  const next = byId('deck-next');
  const counter = byId('deck-counter');
  const overview = byId('deck-overview');
  const notesToggle = byId('deck-notes-toggle');
  const presenterButton = byId('deck-presenter');
  const fullscreen = byId('deck-fullscreen');
  const print = byId('deck-print');
  const timer = byId('deck-timer');
  const progress = byId('deck-progress');
  const controls = byId('deck-controls');
  const status = byId('deck-status');
  const viewport = byId('deck-viewport');
  const notesPanel = byId('deck-notes');
  const presenterTemplate = byId('deck-presenter-template');
  if (
    !slides.length ||
    notes.length !== slides.length ||
    !previous ||
    !next ||
    !counter ||
    !overview ||
    !notesToggle ||
    !presenterButton ||
    !fullscreen ||
    !print ||
    !timer ||
    !progress ||
    !controls ||
    !status ||
    !viewport ||
    !notesPanel ||
    !presenterTemplate
  )
    return;
  let current = 0;
  let started = Date.now();
  let jump = '';
  let presenter = null;
  let touch = null;

  const inOverview = () => root.classList.contains('deck-overview');
  /**
   * The filled presenter document, or null when the window is closed, was
   * reloaded (blank again), or has navigated away and may not be touched.
   */
  function presenterDocument() {
    try {
      const target = presenter && !presenter.closed ? presenter.document : null;
      return target?.getElementById('presenter-current') ? target : null;
    } catch {
      return null;
    }
  }

  function setHash(id) {
    try {
      history.replaceState(null, '', '#' + encodeURIComponent(id));
    } catch {
      /* Some local-file browsers restrict History API updates. */
    }
  }
  /** The presenter window has no script of its own: this window fills it. */
  function updatePresenter() {
    const target = presenterDocument();
    if (!target) return;
    const fill = (id, source) => {
      const frame = target.getElementById(id);
      if (!frame) return;
      if (!source) {
        frame.replaceChildren();
        return;
      }
      const copy = target.importNode(source, true);
      copy.hidden = false;
      copy.removeAttribute('id');
      frame.replaceChildren(copy);
    };
    fill('presenter-current', slides[current]);
    fill('presenter-next', slides[current + 1]);
    fill('presenter-notes', notes[current]);
    const position = target.getElementById('presenter-counter');
    if (position) position.textContent = counter.textContent;
  }
  function show(index, updateHash = true) {
    current = Math.max(0, Math.min(index, slides.length - 1));
    const grid = inOverview();
    slides.forEach((slide, i) => {
      slide.hidden = !grid && i !== current;
      slide.toggleAttribute('data-current', i === current);
    });
    notes.forEach((note, i) => {
      note.hidden = i !== current;
    });
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    counter.textContent = current + 1 + ' / ' + slides.length;
    progress.value = current + 1;
    if (updateHash) setHash(slides[current].id);
    // Notes differ in height per slide, and the overview grid may need scrolling.
    if (grid) slides[current].scrollIntoView?.({ block: 'nearest' });
    else fit();
    updatePresenter();
  }
  function followHash(hash) {
    let id;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return false;
    }
    const target = document.getElementById(id);
    const slide = target?.closest('.deck-slide');
    const index = slides.indexOf(slide);
    if (index < 0) return false;
    show(index, false);
    if (target !== slide) target.scrollIntoView?.({ block: 'nearest' });
    return true;
  }
  function fit() {
    const scale = Math.max(
      0.1,
      Math.min(
        (viewport.clientWidth - 32) / 920,
        (viewport.clientHeight - 24) / 517.5,
      ),
    );
    root.style.setProperty('--deck-scale', String(scale));
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
      status.textContent = '';
    } catch {
      status.textContent = fullscreen.dataset.unavailable;
    }
  }
  function setOverview(on) {
    root.classList.toggle('deck-overview', on);
    root.classList.remove('deck-blackout');
    overview.setAttribute('aria-pressed', String(on));
    show(current);
  }
  function toggleNotes() {
    notesPanel.hidden = !notesPanel.hidden;
    notesToggle.setAttribute('aria-pressed', String(!notesPanel.hidden));
    fit();
  }
  function tick() {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const text =
      String(Math.floor(seconds / 60)).padStart(2, '0') +
      ':' +
      String(seconds % 60).padStart(2, '0');
    timer.textContent = text;
    const elapsed = presenterDocument()?.getElementById('presenter-timer');
    if (elapsed) elapsed.textContent = text;
  }
  function openPresenter() {
    if (presenterDocument()) {
      presenter.focus();
      return;
    }
    let popup = null;
    try {
      popup = window.open('', 'kumi-presenter', 'popup,width=1040,height=720');
    } catch {
      /* Treated like a blocked popup below. */
    }
    if (!popup) {
      status.textContent = presenterButton.dataset.unavailable;
      return;
    }
    try {
      const target = popup.document;
      target.documentElement.lang = root.lang;
      target.head.replaceChildren(
        ...Array.from(document.querySelectorAll('style'), (style) =>
          target.importNode(style, true),
        ),
      );
      target.title = presenterButton.textContent + ' — ' + document.title;
      target.body.className = 'presenter';
      target.body.replaceChildren(
        target.importNode(presenterTemplate.content, true),
      );
      // Registering the same listener twice on a reused document is a no-op.
      target.addEventListener('keydown', onKey);
      target.addEventListener('click', onPresenterClick);
    } catch {
      status.textContent = presenterButton.dataset.unavailable;
      return;
    }
    status.textContent = '';
    presenter = popup;
    updatePresenter();
    tick();
  }
  /**
   * A blank window resolves "#id" against this deck's URL, so following such a
   * link there would load a second deck. Move this deck to the target instead.
   */
  function onPresenterClick(event) {
    const link =
      event.target && typeof event.target.closest === 'function'
        ? event.target.closest('a[href^="#"]')
        : null;
    if (!link) return;
    event.preventDefault();
    const hash = link.getAttribute('href');
    if (followHash(hash)) setHash(decodeURIComponent(hash.slice(1)));
  }
  /** A number typed in the presenter window is shown there, not to the audience. */
  function setJump(value, remote = false) {
    jump = value;
    const text = jump ? status.dataset.jump + ' ' + jump : '';
    const presenterStatus =
      presenterDocument()?.getElementById('presenter-status');
    status.textContent = remote && presenterStatus ? '' : text;
    if (presenterStatus) presenterStatus.textContent = remote ? text : '';
  }
  function onKey(event) {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.defaultPrevented
    )
      return;
    // Elements of the presenter window belong to another realm: check by method.
    const target =
      event.target && typeof event.target.closest === 'function'
        ? event.target
        : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]'))
      return;
    const key = event.key;
    const letter = key.toLowerCase();
    const pendingJump = jump;
    // Fullscreen and printing need the audience window itself to be active.
    const remote = event.currentTarget !== document;
    // A focused control keeps its own Space/Enter, except to confirm a typed number.
    if (
      (key === ' ' || (key === 'Enter' && !pendingJump)) &&
      target?.closest('button, a')
    )
      return;
    if (/^[0-9]$/.test(key)) {
      setJump((jump + key).slice(-4), remote);
      event.preventDefault();
      return;
    }
    if (pendingJump) setJump('');
    if (key === 'Enter' && pendingJump) {
      show(Number(pendingJump) - 1);
      if (inOverview()) setOverview(false);
    } else if (key === 'Enter' && inOverview()) setOverview(false);
    else if (key === 'Escape') {
      if (root.classList.contains('deck-blackout'))
        root.classList.remove('deck-blackout');
      else if (inOverview()) setOverview(false);
      else if (!pendingJump) return;
    } else if (key === 'ArrowRight' || key === 'PageDown' || key === ' ')
      show(current + 1);
    else if (key === 'ArrowLeft' || key === 'PageUp') show(current - 1);
    else if (key === 'Home') show(0);
    else if (key === 'End') show(slides.length - 1);
    else if (letter === 'o') setOverview(!inOverview());
    else if (letter === 'n' && !notesToggle.hidden) toggleNotes();
    else if (letter === 's') openPresenter();
    else if ((letter === 'b' || key === '.') && !inOverview())
      root.classList.toggle('deck-blackout');
    else if (letter === 'f' && !fullscreen.hidden && !remote)
      void toggleFullscreen();
    else if (letter === 'p' && !remote) window.print();
    else return;
    event.preventDefault();
  }

  previous.addEventListener('click', () => show(current - 1));
  next.addEventListener('click', () => show(current + 1));
  overview.addEventListener('click', () => setOverview(!inOverview()));
  notesToggle.hidden = notes.every((note) => note.hasAttribute('data-empty'));
  notesToggle.addEventListener('click', toggleNotes);
  presenterButton.addEventListener('click', openPresenter);
  fullscreen.hidden = !root.requestFullscreen;
  fullscreen.addEventListener('click', toggleFullscreen);
  print.addEventListener('click', () => window.print());
  timer.addEventListener('click', () => {
    started = Date.now();
    tick();
  });
  document.addEventListener('keydown', onKey);
  // In the overview a click chooses a slide; it must not follow links inside it.
  document.addEventListener(
    'click',
    (event) => {
      if (!inOverview()) return;
      const slide =
        event.target instanceof Element
          ? event.target.closest('.deck-slide')
          : null;
      const index = slides.indexOf(slide);
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      current = index;
      setOverview(false);
    },
    true,
  );
  document.addEventListener('click', (event) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest('a[href^="#"]')
        : null;
    const hash = link?.getAttribute('href');
    if (hash && followHash(hash)) {
      event.preventDefault();
      setHash(decodeURIComponent(hash.slice(1)));
    }
  });
  viewport.addEventListener(
    'touchstart',
    (event) => {
      const point = event.touches.length === 1 ? event.touches[0] : null;
      touch = point ? { x: point.clientX, y: point.clientY } : null;
    },
    { passive: true },
  );
  viewport.addEventListener(
    'touchend',
    (event) => {
      const start = touch;
      const point = event.changedTouches[0];
      touch = null;
      if (!start || !point || inOverview()) return;
      const dx = point.clientX - start.x;
      const dy = point.clientY - start.y;
      // A mostly horizontal swipe; vertical movement stays slide scrolling.
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5)
        show(current + (dx < 0 ? 1 : -1));
    },
    { passive: true },
  );
  window.addEventListener('hashchange', () => followHash(location.hash));
  window.addEventListener('resize', fit);
  window.addEventListener('pagehide', () => presenter?.close());
  root.classList.add('deck-ready');
  controls.hidden = false;
  progress.hidden = false;
  fit();
  if (!followHash(location.hash)) show(0, false);
  tick();
  setInterval(tick, 1000);
})();
