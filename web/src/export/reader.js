// Runs offline under the export's CSP hash. Source markup is already rendered safely.
(() => {
  const dialog = document.getElementById('reader-dialog');
  const content = document.getElementById('reader-content');
  const close = document.getElementById('reader-close');
  if (!dialog || !content || !close) return;
  let opener = null;
  const dismiss = () => dialog.close();
  function open(source, trigger) {
    if (typeof dialog.showModal !== 'function') return;
    opener = trigger;
    const copy = source.cloneNode(true);
    copy.querySelectorAll?.('button').forEach((element) => element.remove());
    // SVG markers and clip paths need IDs; give the modal a private copy.
    const ids = new Map();
    copy.querySelectorAll?.('[id]').forEach((element) => {
      if (element.closest('svg')) {
        const old = element.id;
        const id = 'reader-copy-' + old;
        ids.set(old, id);
        element.id = id;
      } else element.removeAttribute('id');
    });
    copy.querySelectorAll?.('svg, svg *').forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const value = attribute.value.replace(
          /url\(#([^)]+)\)/g,
          (match, id) => (ids.has(id) ? 'url(#' + ids.get(id) + ')' : match),
        );
        const resolved =
          (attribute.name === 'href' || attribute.name === 'xlink:href') &&
          value.startsWith('#') &&
          ids.has(value.slice(1))
            ? '#' + ids.get(value.slice(1))
            : value;
        if (resolved !== attribute.value)
          element.setAttribute(attribute.name, resolved);
      });
    });
    if (copy.nodeType === 1) {
      copy.removeAttribute('id');
      copy.classList.remove('slide-positioned-figure', 'slide-flow-figure');
      copy.classList.add('reader-enlarged');
      copy.removeAttribute('style');
    }
    content.replaceChildren(copy);
    dialog.showModal();
    close.focus();
  }
  close.addEventListener('click', dismiss);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('close', () => {
    content.replaceChildren();
    opener?.focus({ preventScroll: true });
  });
  // The slide player's navigation shortcuts must not run while reading a modal.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  document.querySelectorAll('.reader-detail-launcher').forEach((button) =>
    button.addEventListener('click', () => {
      const template = document.getElementById(button.dataset.readerTemplate);
      if (template?.content) open(template.content, button);
    }),
  );
  document.querySelectorAll('[data-reader-reference]').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      const source = trigger.parentElement?.querySelector(
        '.figure-reference-content',
      );
      if (!source || typeof dialog.showModal !== 'function') return;
      event.preventDefault();
      open(source, trigger);
    });
  });
  document
    .querySelectorAll('.deck-slide figure, .report-sheet figure')
    .forEach((figure) => {
      if (!figure.querySelector('img, svg')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reader-zoom-button';
      button.textContent = '⤢';
      const label =
        figure.querySelector('img')?.alt ||
        figure.querySelector('svg title')?.textContent ||
        figure.querySelector('svg')?.getAttribute('aria-label') ||
        figure.querySelector('figcaption')?.textContent ||
        '';
      button.setAttribute(
        'aria-label',
        `${dialog.dataset.zoomLabel}${label ? ': ' + label : ''}`,
      );
      button.addEventListener('click', () => open(figure, button));
      figure.append(button);
      figure.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.target.closest?.('a, button'))
          return;
        if (event.target.closest?.('img, svg')) open(figure, button);
      });
    });
})();
