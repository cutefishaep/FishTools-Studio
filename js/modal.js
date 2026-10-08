/**
 * OpenFishTools Studio - Modular Modal System (ModalManager)
 * 
 * Features:
 * 1. Modular: Open/Close any modal by ID or custom HTML content.
 * 2. Back Button Interception: Native browser back / swipe back closes popup without URL address changes.
 * 3. Outside Click: Clicking the empty backdrop closes popup smoothly.
 * 4. Responsive Transition: Mobile (bottom sheet slide-up), Desktop/Tablet (center scale-in).
 */

class ModalManager {
  constructor() {
    this.activeModal = null;
    this.historyPushed = false;
    this.initGlobalListeners();
  }

  initGlobalListeners() {
    // 1. Close on backdrop click (outside the modal card)
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) {
        this.close();
      }
    });

    // 2. Close on ESC key press
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal) {
        this.close();
      }
    });

    // 3. Native / Browser Back Button Interception (History popstate)
    window.addEventListener('popstate', (e) => {
      if (window._popoverClosingHistoryBack || window._contextMenuClosingHistoryBack) {
        return;
      }
      if (window.Popover && typeof window.Popover.getAwaitedPopstate === 'function' && window.Popover.getAwaitedPopstate() > 0) {
        return;
      }
      if (window.ContextMenu && typeof window.ContextMenu.getAwaitedPopstate === 'function' && window.ContextMenu.getAwaitedPopstate() > 0) {
        return;
      }
      if (e.state && e.state.modalOpen) {
        return;
      }
      if (this.activeModal) {
        // User clicked Back button: Close the modal without navigating away
        this.close(false); // don't call history.back again
      }
    });
  }

  /**
   * Opens a modal container by Element ID or reference
   * @param {string|HTMLElement} modalTarget 
   */
  open(modalTarget) {
    const el = typeof modalTarget === 'string' ? document.getElementById(modalTarget) : modalTarget;
    if (!el) return;

    // Close existing modal if open
    if (this.activeModal && this.activeModal !== el) {
      this.close(false);
    }

    this.activeModal = el;
    el.classList.add('is-active');

    // Push or replace history state so Back button closes modal without changing URL
    if (!this.historyPushed) {
      if (window.history.state && (window.history.state.contextMenuOpen || window.history.state.popoverOpen)) {
        window.history.replaceState({ modalOpen: true, modalId: el.id }, '');
        this.historyPushed = true;
      } else if (!window.history.state || !window.history.state.modalOpen) {
        window.history.pushState({ modalOpen: true, modalId: el.id }, '');
        this.historyPushed = true;
      }
    }

    // Auto-focus first input if present
    const firstInput = el.querySelector('input, select, textarea, button');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }

  /**
   * Closes the active modal
   * @param {string|HTMLElement|boolean} [modalTargetOrTriggerBack=true]
   * @param {boolean} [triggerHistoryBack=true]
   */
  close(modalTargetOrTriggerBack = true, triggerHistoryBack = true) {
    let shouldTriggerHistory = true;
    let targetEl = null;

    if (typeof modalTargetOrTriggerBack === 'boolean') {
      shouldTriggerHistory = modalTargetOrTriggerBack;
    } else if (typeof modalTargetOrTriggerBack === 'string') {
      targetEl = document.getElementById(modalTargetOrTriggerBack);
      if (typeof triggerHistoryBack === 'boolean') {
        shouldTriggerHistory = triggerHistoryBack;
      }
    } else if (modalTargetOrTriggerBack instanceof HTMLElement) {
      targetEl = modalTargetOrTriggerBack;
      if (typeof triggerHistoryBack === 'boolean') {
        shouldTriggerHistory = triggerHistoryBack;
      }
    }

    const el = targetEl || this.activeModal;
    if (!el) return;

    el.classList.remove('is-active');
    if (this.activeModal === el) {
      this.activeModal = null;
    }

    if (shouldTriggerHistory && this.historyPushed && window.history.state && window.history.state.modalOpen) {
      this.historyPushed = false;
      window.history.back();
    } else {
      this.historyPushed = false;
    }
  }
}

// Global Singleton Instance
window.Modal = new ModalManager();

