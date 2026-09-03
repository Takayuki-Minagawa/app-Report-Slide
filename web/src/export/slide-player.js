// This trusted script is embedded verbatim and authorized by its CSP hash.
(() => {
  const slides = Array.from(document.querySelectorAll('.deck-slide'));
  const previous = document.getElementById('deck-previous');
  const next = document.getElementById('deck-next');
  const counter = document.getElementById('deck-counter');
  const fullscreen = document.getElementById('deck-fullscreen');
  const controls = document.getElementById('deck-controls');
  const status = document.getElementById('deck-status');
  if (
    !slides.length ||
    !previous ||
    !next ||
    !counter ||
    !fullscreen ||
    !controls ||
    !status
  )
    return;
  let current = 0;

  function setHash(id) {
    try {
      history.replaceState(null, '', '#' + encodeURIComponent(id));
    } catch {
      /* Some local-file browsers restrict History API updates. */
    }
  }
  function show(index, updateHash = true) {
    current = Math.max(0, Math.min(index, slides.length - 1));
    slides.forEach((slide, i) => {
      slide.hidden = i !== current;
    });
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    counter.textContent = current + 1 + ' / ' + slides.length;
    if (updateHash) setHash(slides[current].id);
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
    if (target !== slide) target.scrollIntoView({ block: 'nearest' });
    return true;
  }
  function fit() {
    const scale = Math.max(
      0.1,
      Math.min(
        (window.innerWidth - 32) / 920,
        (window.innerHeight - 120) / 517.5,
      ),
    );
    document.documentElement.style.setProperty('--deck-scale', String(scale));
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      status.textContent = '';
    } catch {
      status.textContent = fullscreen.dataset.unavailable;
    }
  }
  previous.addEventListener('click', () => show(current - 1));
  next.addEventListener('click', () => show(current + 1));
  fullscreen.hidden = !document.documentElement.requestFullscreen;
  fullscreen.addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', (event) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.defaultPrevented
    )
      return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]'))
      return;
    if (event.key === ' ' && target?.closest('button, a')) return;
    if (
      event.key === 'ArrowRight' ||
      event.key === 'PageDown' ||
      event.key === ' '
    )
      show(current + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp')
      show(current - 1);
    else if (event.key === 'Home') show(0);
    else if (event.key === 'End') show(slides.length - 1);
    else if (event.key.toLowerCase() === 'f' && !fullscreen.hidden)
      void toggleFullscreen();
    else return;
    event.preventDefault();
  });
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
  window.addEventListener('hashchange', () => followHash(location.hash));
  window.addEventListener('resize', fit);
  fit();
  document.documentElement.classList.add('deck-ready');
  controls.hidden = false;
  if (!followHash(location.hash)) show(0, false);
})();
