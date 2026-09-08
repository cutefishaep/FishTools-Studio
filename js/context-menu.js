/**
 * OpenFishTools Studio - Modular Context Menu & Press-Hold Action Popup Controller
 * Features:
 * - Desktop Right-Click (contextmenu event) trigger
 * - Mobile / Touch Press & Hold (Long-press pointerdown timer) trigger
 * - Suppresses normal click event on long press so card navigation is not fired
 * - High-performance viewport clamping (stays within screen margins)
 * - Native back button / popstate dismiss integration
 * - Escape key & click-outside dismissal
 * - 100% Theme token bound, flat aesthetics
 */

window.ContextMenu = (function () {
  let menuCard = null;
  let menuBackdrop = null;
  let isOpen = false;
  let currentCloseCallback = null;
  let suppressNextClickTarget = null;
  let suppressClickUntil = 0;

  const MARGIN = 10;
  const LONG_PRESS_MS = 450;

  /**
   * Lazily creates DOM elements for the context menu
   */
  function ensureDOMElements() {
    if (menuCard && menuBackdrop) return;

    menuBackdrop = document.createElement('div');
    menuBackdrop.className = 'context-menu-backdrop';
    menuBackdrop.setAttribute('aria-hidden', 'true');

    menuCard = document.createElement('div');
    menuCard.className = 'context-menu-card';
    menuCard.setAttribute('role', 'menu');
    menuCard.setAttribute('aria-hidden', 'true');

    // Backdrop click dismisses
    menuBackdrop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      close();
    });

    document.body.appendChild(menuBackdrop);
    document.body.appendChild(menuCard);

    // Global dismiss on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    });

    // Native browser back button / popstate handling
    window.addEventListener('popstate', () => {
      if (isOpen) {
        close(false);
      }
    });

    // Dismiss on window resize or scroll
    window.addEventListener('resize', () => {
      if (isOpen) close();
    }, { passive: true });

    window.addEventListener('scroll', () => {
      if (isOpen) close();
    }, { passive: true });
  }

  /**
   * Positions the menu card clamped within viewport
   */
  function positionMenu(x, y) {
    if (!menuCard) return;

    // Reset style to calculate natural size
    menuCard.style.left = '0px';
    menuCard.style.top = '0px';
    menuCard.style.visibility = 'hidden';
    menuCard.classList.add('is-open');

    const cardRect = menuCard.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let posX = x;
    let posY = y;

    // Flip or clamp horizontal
    if (posX + cardRect.width > vw - MARGIN) {
      posX = Math.max(MARGIN, x - cardRect.width);
    }

    // Flip or clamp vertical
    if (posY + cardRect.height > vh - MARGIN) {
      posY = Math.max(MARGIN, y - cardRect.height);
    }

    menuCard.style.left = `${Math.round(posX)}px`;
    menuCard.style.top = `${Math.round(posY)}px`;
    menuCard.style.visibility = '';
  }

  /**
   * Opens the context menu
   * @param {Object} options
   * @param {number} options.x - Pointer clientX
   * @param {number} options.y - Pointer clientY
   * @param {Array} options.items - [{ label, icon, danger, divider, action }]
   * @param {HTMLElement} [options.target] - Target element triggering menu
   * @param {Function} [options.onClose] - Callback when menu closes
   */
  function open(options) {
    options = options || {};
    ensureDOMElements();

    // Close any existing active popovers or drawers first
    if (window.Popover && typeof window.Popover.close === 'function') {
      window.Popover.close(false);
    }
    if (window.Drawer && typeof window.Drawer.close === 'function') {
      window.Drawer.close(false);
    }

    // Render items
    menuCard.innerHTML = '';
    const items = options.items || [];

    items.forEach((item) => {
      if (item.divider) {
        const div = document.createElement('div');
        div.className = 'context-menu-divider';
        menuCard.appendChild(div);
        return;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'context-menu-item' + (item.danger ? ' is-danger' : '');
      btn.setAttribute('role', 'menuitem');

      let iconHtml = '';
      if (item.icon) {
        if (item.icon.trim().startsWith('<svg')) {
          iconHtml = `<span class="context-menu-icon" aria-hidden="true">${item.icon}</span>`;
        } else {
          iconHtml = `<span class="context-menu-icon is-mask" style="--mask-url: url('${item.icon}');" aria-hidden="true"></span>`;
        }
      }

      btn.innerHTML = `${iconHtml}<span class="context-menu-label">${item.label || ''}</span>`;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        if (typeof item.action === 'function') {
          item.action(options.target);
        }
      });

      menuCard.appendChild(btn);
    });

    currentCloseCallback = options.onClose || null;

    // Push history state for back button navigation
    if (!window.history.state || !window.history.state.contextMenuOpen) {
      window.history.pushState({ contextMenuOpen: true }, '');
    }

    positionMenu(options.x || 0, options.y || 0);
    menuBackdrop.classList.add('is-open');
    menuCard.classList.add('is-open');
    menuCard.setAttribute('aria-hidden', 'false');
    isOpen = true;
  }

  /**
   * Closes the context menu
   * @param {boolean} [popHistory=true]
   */
  function close(popHistory = true) {
    if (!isOpen) return;

    if (menuCard) {
      menuCard.classList.remove('is-open');
      menuCard.setAttribute('aria-hidden', 'true');
    }
    if (menuBackdrop) {
      menuBackdrop.classList.remove('is-open');
    }

    isOpen = false;

    if (popHistory && window.history.state && window.history.state.contextMenuOpen) {
      window.history.back();
    }

    if (typeof currentCloseCallback === 'function') {
      const cb = currentCloseCallback;
      currentCloseCallback = null;
      cb();
    }
  }

  /**
   * Attaches unified Right-Click & Press-Hold gesture handler to target elements or parent container
   * @param {HTMLElement|string} container
   * @param {string} itemSelector
   * @param {Function} getItemsCallback - function(targetElement) returns items array
   */
  function bindTrigger(container, itemSelector, getItemsCallback) {
    const root = typeof container === 'string' ? document.querySelector(container) : container;
    if (!root) return;

    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let activeItem = null;

    function cancelPress() {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      if (activeItem) {
        activeItem.classList.remove('is-press-holding');
        activeItem = null;
      }
    }

    // 1. Right-Click Desktop ContextMenu
    root.addEventListener('contextmenu', (e) => {
      const target = e.target.closest(itemSelector);
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      cancelPress();
      const items = getItemsCallback(target);
      if (items && items.length > 0) {
        open({
          x: e.clientX,
          y: e.clientY,
          items: items,
          target: target
        });
      }
    });

    // 2. Press & Hold (Long-Press for Mobile & Touch Devices)
    root.addEventListener('pointerdown', (e) => {
      // Primary button / touch only
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const target = e.target.closest(itemSelector);
      if (!target) return;

      cancelPress();

      startX = e.clientX;
      startY = e.clientY;
      activeItem = target;

      pressTimer = setTimeout(() => {
        if (!activeItem) return;

        // Visual feedback
        activeItem.classList.remove('is-press-holding');

        // Haptic feedback if available
        if (navigator.vibrate) {
          try { navigator.vibrate(35); } catch (_) {}
        }

        // Suppress the ensuing synthetic click event
        suppressNextClickTarget = activeItem;
        suppressClickUntil = Date.now() + 500;

        const items = getItemsCallback(activeItem);
        if (items && items.length > 0) {
          open({
            x: startX,
            y: startY,
            items: items,
            target: activeItem
          });
        }

        pressTimer = null;
        activeItem = null;
      }, LONG_PRESS_MS);

      // Subtle indicator while holding
      activeItem.classList.add('is-press-holding');
    });

    root.addEventListener('pointermove', (e) => {
      if (!pressTimer) return;
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist > 8) {
        // User is scrolling or dragging, cancel long press
        cancelPress();
      }
    });

    root.addEventListener('pointerup', cancelPress);
    root.addEventListener('pointercancel', cancelPress);

    // Suppress click immediately after a long press was triggered
    root.addEventListener('click', (e) => {
      const target = e.target.closest(itemSelector);
      if (target && suppressNextClickTarget === target && Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        suppressNextClickTarget = null;
      }
    }, true);
  }

  return {
    open: open,
    close: close,
    bindTrigger: bindTrigger,
    get isOpen() { return isOpen; }
  };
})();
