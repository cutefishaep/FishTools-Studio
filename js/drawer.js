/**
 * OpenFishTools Studio - Modular Drawer Controller (DrawerManager)
 * 
 * Features:
 * 1. Bottom Sheet Drawer: Slides up from bottom with 60fps GPU acceleration.
 * 2. Top Drag Handle Resizer: Drag handle up to expand drawer height, strictly clamped
 *    when content is fully displayed ("sudah ke show semua") or hits container top boundary.
 * 3. Rapid Multi-Tool Switching: Immediately cleans and closes existing drawer before opening new one.
 * 4. Perfect Close (Drawer & Content Cleanup): Automatically empties and purges inner content upon closing.
 * 5. Content-adaptive Height: Fits content height without rigid overflow.
 * 6. Outside Backdrop & ESC Key Dismissal.
 * 7. Native Browser Back / Popstate Interception without URL mutations.
 * 8. Programmatic API: open(target, content), close(), clearContent(target), setContent(target, content).
 */

class DrawerManager {
  constructor() {
    this.activeDrawer = null;
    this.historyPushed = false;
    this.initGlobalListeners();
    this.initDragHandleListeners();
  }

  initGlobalListeners() {
    // 1. Close on backdrop or [data-drawer-close] click
    document.addEventListener('click', (e) => {
      const closeTrigger = e.target.closest('[data-drawer-close]');
      if (closeTrigger) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }

      const openTrigger = e.target.closest('[data-drawer-target]');
      if (openTrigger) {
        e.preventDefault();
        e.stopPropagation();
        const targetId = openTrigger.getAttribute('data-drawer-target');
        this.toggle(targetId);
        return;
      }

      // 2. Category Tab switcher inside Add Layer Drawer
      const categoryTab = e.target.closest('.category-tab-btn');
      if (categoryTab) {
        const bar = categoryTab.closest('.add-layer-categories-bar');
        if (bar) {
          bar.querySelectorAll('.category-tab-btn').forEach((btn) => {
            btn.classList.remove('is-selected');
            btn.setAttribute('aria-selected', 'false');
          });
          categoryTab.classList.add('is-selected');
          categoryTab.setAttribute('aria-selected', 'true');
        }
      }
    });

    // 2. Close on ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeDrawer) {
        this.close();
      }
    });

    // 3. Native Back Button / Popstate support
    window.addEventListener('popstate', (e) => {
      // Never close timeline-layer-drawer on generic popstate
      if (this.activeDrawer && this.activeDrawer.id === 'timeline-layer-drawer') {
        return;
      }
      if (this.activeDrawer) {
        this.close(false); // Do not call history.back() again
      }
    });
  }

  /**
   * Interactive Pointer-Event Drag Handle Resizer
   */
  initDragHandleListeners() {
    let isDragging = false;
    let startY = 0;
    let startHeight = 0;
    let currentHandle = null;
    let currentCard = null;
    let currentContainer = null;
    let maxAllowedHeight = 0;
    let minAllowedHeight = 60;

    document.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.drawer-drag-handle');
      if (!handle) return;

      const card = handle.closest('.drawer-card');
      const container = handle.closest('.drawer-container');
      if (!card || !container) return;

      isDragging = true;
      currentHandle = handle;
      currentCard = card;
      currentContainer = container;
      startY = e.clientY;
      startHeight = card.getBoundingClientRect().height;

      // 1. Boundary: Container top boundary (mentok ke atas container)
      const containerH = container.clientHeight || window.innerHeight;
      const topLimit = Math.max(80, containerH - 16);

      // 2. Boundary: Full content shown limit ("jika UI mentok / sudah ke show semua")
      const prevHeight = card.style.height;
      const prevMaxHeight = card.style.maxHeight;
      card.style.height = 'auto';
      card.style.maxHeight = 'none';
      let contentHeight = card.scrollHeight;

      // If internal scrollable area exists (e.g. effects gallery/rack, blend, or media pool), include hidden scroll content
      const scrollableBody = card.querySelector('.effects-gallery-body, .effects-rack-body, .media-pool-body, .blend-work-area');
      if (scrollableBody) {
        const extraScroll = scrollableBody.scrollHeight - scrollableBody.clientHeight;
        if (extraScroll > 0) {
          contentHeight += extraScroll;
        }
      }

      card.style.height = prevHeight;
      card.style.maxHeight = prevMaxHeight;

      // Graph view has vector responsive content, allow dragging all the way up to topLimit
      const isGraphView = Boolean(card.querySelector('#layer-drawer-graph-view.is-active') || card.classList.contains('is-graph-view'));
      if (isGraphView) {
        contentHeight = topLimit;
      }

      // Stop expanding when all content is shown or when container top is reached
      maxAllowedHeight = Math.min(topLimit, contentHeight);
      minAllowedHeight = isGraphView ? Math.min(220, topLimit) : 50;

      handle.classList.add('is-dragging');
      card.style.transition = 'none';
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
      if (!isDragging || !currentCard) return;

      const deltaY = startY - e.clientY; // Dragging up increases height
      let targetHeight = startHeight + deltaY;

      // Clamp strictly within [minAllowedHeight, maxAllowedHeight]
      targetHeight = Math.max(minAllowedHeight, Math.min(maxAllowedHeight, targetHeight));

      currentCard.style.height = `${targetHeight}px`;
    });

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;

      if (currentHandle) {
        currentHandle.classList.remove('is-dragging');
        try {
          currentHandle.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }

      if (currentCard) {
        currentCard.style.transition = '';
        const currentH = currentCard.getBoundingClientRect().height;
        // If dragged down near minimum, smoothly close the drawer
        if (currentH <= minAllowedHeight + 10) {
          this.close();
        } else if (currentContainer && currentContainer.id === 'timeline-layer-drawer') {
          const mainTl = document.getElementById('main-editor-timeline');
          if (mainTl) mainTl.style.setProperty('--timeline-drawer-height', `${Math.round(currentH)}px`);
          if (typeof window.centerSelectedTimelineLayer === 'function') {
            window.centerSelectedTimelineLayer(true);
          }
        }
      }

      currentHandle = null;
      currentCard = null;
      currentContainer = null;
    };

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  /**
   * Resolves target element from string ID or element reference
   * @param {string|HTMLElement} target
   * @returns {HTMLElement|null}
   */
  resolveElement(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  /**
   * Sets content of drawer's body
   * @param {string|HTMLElement} target 
   * @param {string|HTMLElement} content 
   */
  setContent(target, content) {
    const el = this.resolveElement(target);
    if (!el) return;
    const body = el.querySelector('.drawer-body');
    if (!body) return;

    if (typeof content === 'string') {
      body.innerHTML = content;
    } else if (content instanceof Node) {
      body.innerHTML = '';
      body.appendChild(content);
    }
  }

  /**
   * Cleans and purges content inside drawer body
   * @param {string|HTMLElement} target 
   */
  clearContent(target) {
    const el = this.resolveElement(target);
    if (!el) return;

    const body = el.querySelector('.drawer-body');
    if (body) {
      body.querySelectorAll('input, select, textarea').forEach((input) => {
        if (input.type !== 'file') input.value = '';
      });
      if (body.hasAttribute('data-clear-body')) {
        body.innerHTML = '';
      }
    }

    const card = el.querySelector('.drawer-card');
    if (card) {
      card.style.height = '';
    }
  }

  /**
   * Fast cleanup of active elements, DOM state, and inner content
   * @param {HTMLElement} [exceptEl] - Container element to preserve
   */
  cleanup(exceptEl = null) {
    // 1. Release active focus inside closing drawers
    if (document.activeElement && document.activeElement.closest('.drawer-container')) {
      const parentDrawer = document.activeElement.closest('.drawer-container');
      if (parentDrawer !== exceptEl) {
        document.activeElement.blur();
      }
    }

    // 2. Immediate purge of any lingering active drawer states and content in DOM
    const activeDrawers = document.querySelectorAll('.drawer-container.is-active');
    let hasRemainingActive = false;
    activeDrawers.forEach((drawer) => {
      if (drawer !== exceptEl) {
        drawer.classList.remove('is-active');
        drawer.setAttribute('aria-hidden', 'true');
        this.clearContent(drawer);
      } else {
        hasRemainingActive = true;
      }
    });
    if (!hasRemainingActive && !exceptEl) {
      document.body.classList.remove('has-active-drawer');
      document.querySelectorAll('.editor-timeline.has-drawer-open').forEach(t => t.classList.remove('has-drawer-open'));
    }
  }

  /**
   * Opens target drawer. Instantly closes existing drawer without stacking delay.
   * @param {string|HTMLElement} target 
   * @param {string|HTMLElement} [content] - Optional dynamic content to set
   */
  open(target, content = null) {
    const el = this.resolveElement(target);
    if (!el) return;

    // Mutually exclusive: If a popover is active, automatically close it immediately
    if (window.Popover && typeof window.Popover.close === 'function') {
      window.Popover.close(false);
    }

    // If another drawer is already open, immediately close and purge it
    if (this.activeDrawer && this.activeDrawer !== el) {
      this.cleanup(el);
      if (this.historyPushed) {
        window.history.replaceState({ drawerOpen: true, drawerId: el.id }, '');
      }
    } else {
      this.cleanup(el);
    }

    // Inject content if provided
    if (content) {
      this.setContent(el, content);
    }

    // Reset height to natural content height
    const card = el.querySelector('.drawer-card');
    if (card) {
      card.style.height = '';
    }

    this.activeDrawer = el;
    el.classList.add('is-active');
    el.setAttribute('aria-hidden', 'false');

    document.body.classList.add('has-active-drawer');
    const timeline = el.closest('.editor-timeline') || document.querySelector('.editor-timeline');
    if (timeline) {
      timeline.classList.add('has-drawer-open');
    }
    const fab = document.getElementById('timeline-btn-add') || document.querySelector('.timeline-fab-add');
    if (fab && document.activeElement === fab) {
      fab.blur();
    }

    // Push invisible history state for native back gesture if not already active
    if (!this.historyPushed) {
      window.history.pushState({ drawerOpen: true, drawerId: el.id }, '');
      this.historyPushed = true;
    }

    // Auto-focus first focusable element inside drawer
    const focusable = el.querySelector('button, [tabindex="0"], input');
    if (focusable) {
      setTimeout(() => focusable.focus(), 50);
    }

    window.dispatchEvent(new CustomEvent('drawer-opened', { detail: { id: el.id, target: el } }));
  }

  /**
   * Perfect Close: Closes active drawer and purges its inner content
   * @param {boolean} triggerHistoryBack 
   */
  close(triggerHistoryBack = true) {
    const closingDrawer = this.activeDrawer;
    if (!closingDrawer) {
      this.cleanup(null);
      return;
    }

    // Deactivate drawer UI immediately
    closingDrawer.classList.remove('is-active');
    closingDrawer.setAttribute('aria-hidden', 'true');
    const closingCard = closingDrawer.querySelector('.drawer-card');
    if (closingCard) {
      closingCard.style.height = '';
    }
    this.activeDrawer = null;

    const remainingActive = document.querySelectorAll('.drawer-container.is-active');
    if (remainingActive.length === 0) {
      document.body.classList.remove('has-active-drawer');
      document.querySelectorAll('.editor-timeline.has-drawer-open').forEach(t => t.classList.remove('has-drawer-open'));
    }

    window.dispatchEvent(new CustomEvent('drawer-closed', { detail: { id: closingDrawer.id, target: closingDrawer } }));

    // Release active element focus
    if (document.activeElement && document.activeElement.closest('.drawer-container')) {
      document.activeElement.blur();
    }

    // Clean inner content: Purge upon slide-down animation completion
    setTimeout(() => {
      if (!this.isOpen(closingDrawer)) {
        this.clearContent(closingDrawer);
      }
    }, 260);

    if (triggerHistoryBack && this.historyPushed) {
      this.historyPushed = false;
      window.history.back();
    } else {
      this.historyPushed = false;
    }
  }

  /**
   * Immediately closes all drawers and purges all drawer content
   */
  closeAll() {
    const allDrawers = document.querySelectorAll('.drawer-container');
    allDrawers.forEach((d) => this.clearContent(d));
    this.cleanup(null);
    this.activeDrawer = null;
    this.historyPushed = false;
    document.body.classList.remove('has-active-drawer');
    document.querySelectorAll('.editor-timeline.has-drawer-open').forEach(t => t.classList.remove('has-drawer-open'));
  }

  /**
   * Toggles drawer state
   * @param {string|HTMLElement} target 
   * @param {string|HTMLElement} [content]
   */
  toggle(target, content = null) {
    const el = this.resolveElement(target);
    if (!el) return;

    if (this.activeDrawer === el) {
      this.close();
    } else {
      this.open(el, content);
    }
  }

  /**
   * Returns whether a drawer is open
   * @param {string|HTMLElement} target 
   * @returns {boolean}
   */
  isOpen(target) {
    const el = this.resolveElement(target);
    return this.activeDrawer === el;
  }
}

// Global Singleton Instance
window.Drawer = new DrawerManager();
