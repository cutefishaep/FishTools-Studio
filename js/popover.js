/**
 * OpenFishTools Studio - Modular macOS-Style Popover Controller
 * Features:
 * - Dynamic Anchor scaling from pointy tail tip (transform-origin: tail tip)
 * - Auto smart flipping (top vs bottom, left vs right) and viewport margin clamping
 * - Fast tactile spring bounce animation (0 -> 1 -> 0)
 * - Browser popstate / back button closing integration
 * - Escape key & click-outside dismissal
 */

const Popover = (function () {
  let activePopover = null;
  let activeTrigger = null;
  let updatePositionRaf = null;
  let popstateAwaited = 0;

  const MARGIN = 10; // Minimum margin to viewport boundary
  const OFFSET = 8;  // Distance between trigger element and popover card

  /**
   * Recalculates and positions popover adjacent to trigger element with dynamic pointy tail
   */
  function updatePosition() {
    if (!activePopover || !activeTrigger) return;

    const isVirtual = !!(activeTrigger.isVirtual || (!activeTrigger.nodeType && typeof activeTrigger.getBoundingClientRect === 'function'));
    let triggerRect = null;
    try {
      triggerRect = activeTrigger.getBoundingClientRect();
    } catch (_) {}

    if (!isVirtual) {
      if ((!triggerRect || (triggerRect.width === 0 && triggerRect.height === 0)) || !activeTrigger.isConnected) {
        if (activeTrigger.id) {
          const liveEl = document.getElementById(activeTrigger.id);
          if (liveEl && liveEl.isConnected) {
            activeTrigger = liveEl;
            triggerRect = activeTrigger.getBoundingClientRect();
          }
        }
        if ((!triggerRect || (triggerRect.width === 0 && triggerRect.height === 0)) || !activeTrigger.isConnected) {
          // Fallback: try active gradient handle
          const fallbackEl = document.querySelector('#fill-grad-handles-container .fill-grad-handle.is-active') ||
                             document.getElementById('fill-grad-track-bar');
          if (fallbackEl && fallbackEl.isConnected && fallbackEl !== document.body) {
            activeTrigger = fallbackEl;
            triggerRect = activeTrigger.getBoundingClientRect();
          }
        }
      }
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popoverRect = activePopover.getBoundingClientRect();
    const tailEl = activePopover.querySelector('.popover-tail');

    const hasValidCoords = triggerRect && Number.isFinite(triggerRect.left) && Number.isFinite(triggerRect.top);

    // If trigger has valid coordinates (including 0x0 point anchors like right-click mouse cursor), use them directly.
    // Only fallback to screen center if coordinates are genuinely invalid/missing.
    const effectiveTriggerRect = hasValidCoords ? {
      left: triggerRect.left,
      right: Number.isFinite(triggerRect.right) ? triggerRect.right : triggerRect.left,
      top: triggerRect.top,
      bottom: Number.isFinite(triggerRect.bottom) ? triggerRect.bottom : triggerRect.top,
      width: Math.max(0, triggerRect.width || 0),
      height: Math.max(0, triggerRect.height || 0)
    } : {
      left: vw / 2 - 10,
      right: vw / 2 + 10,
      top: vh / 2 - 10,
      bottom: vh / 2 + 10,
      width: 20,
      height: 20
    };

    // Determine vertical placement (top vs bottom)
    const spaceBelow = vh - effectiveTriggerRect.bottom - OFFSET - MARGIN;
    const spaceAbove = effectiveTriggerRect.top - OFFSET - MARGIN;
    const popoverHeight = activePopover.offsetHeight;
    const popoverWidth = activePopover.offsetWidth;

    let placement = 'top';
    const isMobile = vw <= 600;
    const isControllerTrigger = activeTrigger && typeof activeTrigger.closest === 'function' && !!(activeTrigger.closest('.editor-controller') || activeTrigger.closest('.desktop-timeline-toolbar'));
    const isEmbedPanel = activePopover && activePopover.classList.contains('is-embed-panel');
    const explicitPlacement = (activeTrigger && activeTrigger.dataset ? activeTrigger.dataset.popoverPlacement : null) || activePopover.dataset.popoverPlacement;

    // Special Case: On Mobile, OpenFishTools embed panel pops UPWARD to completely fill upper preview area
    if (isMobile && isEmbedPanel) {
      const availableTopHeight = Math.max(160, Math.floor(effectiveTriggerRect.top - OFFSET - MARGIN));
      activePopover.style.width = `calc(100vw - ${MARGIN * 2}px)`;
      activePopover.style.height = `${availableTopHeight}px`;
      activePopover.style.maxHeight = `${availableTopHeight}px`;
      activePopover.setAttribute('data-placement', 'top');

      const triggerCenterX = effectiveTriggerRect.left + effectiveTriggerRect.width / 2;
      const left = MARGIN;
      const top = MARGIN;
      let tailOffset = triggerCenterX - left;
      tailOffset = Math.max(16, Math.min(vw - MARGIN * 2 - 16, tailOffset));

      if (tailEl) {
        tailEl.style.left = `${tailOffset}px`;
        tailEl.style.top = '';
        tailEl.style.bottom = '';
        tailEl.style.right = '';
      }

      // Anchor origin set at pointy tip of tail (bottom edge of card)
      activePopover.style.transformOrigin = `${tailOffset}px 100%`;
      activePopover.style.left = `${left}px`;
      activePopover.style.top = `${top}px`;
      return;
    }

    // Clear any previous inline width/height overrides when not mobile embed panel
    if (activePopover.style.width) activePopover.style.width = '';
    if (activePopover.style.height) activePopover.style.height = '';

    if (isMobile && isControllerTrigger) {
      // On mobile, other controller triggers pop DOWNWARD over timeline
      placement = 'bottom';
    } else if (!isMobile && (isControllerTrigger || isEmbedPanel)) {
      // On desktop, controller sits at bottom of preview pane. Always pop UPWARD above button ("kalau desktop muncul di atas")
      placement = 'top';
    } else if (explicitPlacement) {
      placement = explicitPlacement;
    } else if (isControllerTrigger || effectiveTriggerRect.top > vh / 2) {
      // In bottom half of screen or desktop controller bar, pop UPWARD above button (tail at bottom pointing down)
      if (spaceAbove >= popoverHeight || spaceAbove >= spaceBelow) {
        placement = 'top';
      } else {
        placement = 'bottom';
      }
    } else {
      // In top half of screen, pop DOWNWARD below button (tail at top pointing up)
      if (spaceBelow >= popoverHeight || spaceBelow >= spaceAbove) {
        placement = 'bottom';
      } else {
        placement = 'top';
      }
    }

    let top = 0;
    let left = 0;
    let tailOffset = 0;

    // Horizontal placement calculation centered on trigger
    const triggerCenterX = effectiveTriggerRect.left + effectiveTriggerRect.width / 2;
    left = triggerCenterX - popoverWidth / 2;

    // Viewport horizontal clamping
    const minLeft = MARGIN;
    const maxLeft = vw - popoverWidth - MARGIN;
    left = Math.max(minLeft, Math.min(maxLeft, left));

    if (placement === 'bottom') {
      const desiredTop = effectiveTriggerRect.bottom + OFFSET;
      // Strictly anchor top at desiredTop so popover NEVER shifts upwards ("asal ga sampe naik")
      top = desiredTop;
      activePopover.setAttribute('data-placement', 'bottom');

      // Allow card to extend downwards towards bottom of screen ("sampe ka bawah boleh kok")
      const maxAvailableHeight = Math.max(160, vh - desiredTop - MARGIN);
      activePopover.style.maxHeight = `${maxAvailableHeight}px`;
      
      // Calculate tail offset relative to popover left
      tailOffset = triggerCenterX - left;
      // Clamp tail within popover corner radius
      tailOffset = Math.max(16, Math.min(popoverWidth - 16, tailOffset));
      
      if (tailEl) {
        tailEl.style.left = `${tailOffset}px`;
        tailEl.style.top = '';
        tailEl.style.bottom = '';
        tailEl.style.right = '';
      }

      // Anchor origin set exactly at pointy tip of tail (top edge of card)
      activePopover.style.transformOrigin = `${tailOffset}px 0px`;
    } else {
      // Top placement (card above button, tail at bottom pointing down)
      const desiredTop = effectiveTriggerRect.top - popoverHeight - OFFSET;
      top = Math.min(effectiveTriggerRect.top - 2, Math.max(MARGIN, desiredTop));
      activePopover.setAttribute('data-placement', 'top');

      const maxAvailableHeight = Math.max(160, effectiveTriggerRect.top - OFFSET - MARGIN);
      activePopover.style.maxHeight = `${maxAvailableHeight}px`;

      tailOffset = triggerCenterX - left;
      tailOffset = Math.max(16, Math.min(popoverWidth - 16, tailOffset));

      if (tailEl) {
        tailEl.style.left = `${tailOffset}px`;
        tailEl.style.top = '';
        tailEl.style.bottom = '';
        tailEl.style.right = '';
      }

      // Anchor origin set exactly at pointy tip of tail (bottom edge of card)
      activePopover.style.transformOrigin = `${tailOffset}px 100%`;
    }

    activePopover.style.left = `${left}px`;
    activePopover.style.top = `${top}px`;
  }

  /**
   * Schedule smooth position recalculation via RAF
   */
  function scheduleUpdate() {
    if (updatePositionRaf) cancelAnimationFrame(updatePositionRaf);
    updatePositionRaf = requestAnimationFrame(updatePosition);
  }

  /**
   * Opens a popover anchored to a trigger element
   * @param {HTMLElement|string} trigger - Element or selector clicked
   * @param {HTMLElement|string} popover - Target popover card element or ID
   */
  function open(trigger, popover) {
    let triggerEl = null;
    if (typeof trigger === 'string') {
      triggerEl = document.querySelector(trigger);
    } else if (trigger && (trigger.nodeType || typeof trigger.getBoundingClientRect === 'function')) {
      triggerEl = trigger;
    }

    const popoverEl = typeof popover === 'string' ? document.getElementById(popover) : popover;

    if (!triggerEl || !popoverEl) return;

    // If already open on this trigger, just update position and return
    if (activePopover === popoverEl && activeTrigger === triggerEl) {
      updatePosition();
      return;
    }

    // Close any currently active popover first
    if (activePopover && activePopover !== popoverEl) {
      close(false);
    }

    // Mutually exclusive: Close active modal drawers before opening popover,
    // but preserve timeline-layer-drawer and timeline-add-drawer so in-drawer popovers do not close their parent drawer
    if (window.Drawer && window.Drawer.activeDrawer && window.Drawer.activeDrawer.id !== 'timeline-layer-drawer' && window.Drawer.activeDrawer.id !== 'timeline-add-drawer') {
      window.Drawer.close(false);
    }

    // Ensure tail element exists
    if (!popoverEl.querySelector('.popover-tail')) {
      const tail = document.createElement('div');
      tail.className = 'popover-tail';
      tail.setAttribute('aria-hidden', 'true');
      popoverEl.prepend(tail);
    }

    activeTrigger = triggerEl;
    activePopover = popoverEl;

    // Push popstate history for native back button / Android gesture support (exclude in-drawer popovers)
    if (popoverEl.id !== 'popover-graph-more' && popoverEl.id !== 'popover-effects-more' && popoverEl.id !== 'popover-graph-delete-confirm' && popoverEl.id !== 'popover-media-item-menu' && (!window.history.state || !window.history.state.popoverOpen)) {
      window.history.pushState({ popoverOpen: true, popoverId: popoverEl.id }, '');
    }

    // Position popover before scaling
    updatePosition();

    // Trigger scale-in animation on next tick
    requestAnimationFrame(() => {
      if (activePopover === popoverEl) {
        popoverEl.classList.add('is-open');
        popoverEl.setAttribute('aria-hidden', 'false');
      }
    });

    // Attach dynamic window resize & scroll handlers
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
  }

  /**
   * Closes active popover
   * @param {boolean} triggerPopstate - Whether to revert history state
   */
  function close(triggerPopstate = true) {
    if (!activePopover) return;

    const elToClose = activePopover;
    elToClose.classList.remove('is-open');
    elToClose.setAttribute('aria-hidden', 'true');

    // Pertahankan transformOrigin dan sizing selama transisi exit (0.16s)
    // agar animasi zoom-out dan fade-out tetap mengarah ke anchor tail (tidak loncat ke tengah)
    setTimeout(() => {
      if (elToClose !== activePopover) {
        elToClose.style.maxHeight = '';
        elToClose.style.height = '';
        elToClose.style.width = '';
        elToClose.style.transformOrigin = '';
      }
    }, 200);

    activePopover = null;
    activeTrigger = null;

    window.removeEventListener('resize', scheduleUpdate);
    window.removeEventListener('scroll', scheduleUpdate);

    if (triggerPopstate && elToClose.id !== 'popover-graph-more' && elToClose.id !== 'popover-effects-more' && elToClose.id !== 'popover-media-item-menu' && window.history.state && window.history.state.popoverOpen) {
      popstateAwaited++;
      window._popoverClosingHistoryBack = true;
      window.history.back();
      setTimeout(() => { window._popoverClosingHistoryBack = false; }, 300);
    }

    try {
      elToClose.dispatchEvent(new CustomEvent('popover:close', { bubbles: true }));
    } catch (_) {}
  }

  // Toggles popover open/closed
  function toggle(trigger, popover) {
    let triggerEl = null;
    if (typeof trigger === 'string') {
      triggerEl = document.querySelector(trigger);
    } else if (trigger && (trigger.nodeType || typeof trigger.getBoundingClientRect === 'function')) {
      triggerEl = trigger;
    }
    const popoverEl = typeof popover === 'string' ? document.getElementById(popover) : popover;
    if (!popoverEl) return;

    if (activePopover === popoverEl) {
      close();
    } else {
      open(triggerEl || trigger, popoverEl);
    }
  }

  // Global click outside listener
  document.addEventListener('pointerdown', (e) => {
    if (!activePopover) return;
    if (activePopover.contains(e.target)) return; // Clicked inside popover
    if (activeTrigger && typeof activeTrigger.contains === 'function' && activeTrigger.contains(e.target)) return; // Clicked active trigger

    // If clicking any other popover trigger, do not close via pointerdown! Let the trigger's click switch/toggle smoothly
    const otherTrigger = e.target.closest && e.target.closest('[data-popover-target]');
    if (otherTrigger) return;

    close();
  });

  // Global Escape key listener
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activePopover) {
      close();
    }
  });

  // Native popstate listener for back gesture / browser back button
  window.addEventListener('popstate', (e) => {
    if (popstateAwaited > 0) {
      popstateAwaited--;
      return;
    }
    if (window._popoverClosingHistoryBack) {
      return;
    }
    if (activePopover) {
      close(false);
    }
  });

  // Auto-bind elements with data-popover-target attribute
  function initPopoverTriggers() {
    document.querySelectorAll('[data-popover-target]').forEach(trigger => {
      if (trigger._hasPopoverBound) return;
      trigger._hasPopoverBound = true;
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetId = trigger.getAttribute('data-popover-target');
        toggle(trigger, targetId);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopoverTriggers);
  } else {
    initPopoverTriggers();
  }

  return {
    open,
    close,
    toggle,
    updatePosition,
    isOpen: () => !!activePopover,
    getAwaitedPopstate: () => popstateAwaited
  };
})();

// Export globally
window.Popover = Popover;
