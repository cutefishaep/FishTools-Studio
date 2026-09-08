/**
 * OpenFishTools Studio - Modular Segmented Switch Controller (SwitchManager)
 * 
 * Features:
 * 1. Modular Segment Switching: Instant, tactile switching across pill segments.
 * 2. High Performance: Global event delegation for zero setup overhead.
 * 3. Accessibility: Synchronous aria-selected state syncing.
 * 4. Programmatic API: Switch.select(target, valueOrIndex), Switch.getValue(target).
 * 5. Custom Event: Dispatches 'switch:change' on segment change.
 */

class SwitchManager {
  constructor() {
    this.initGlobalListeners();
  }

  initGlobalListeners() {
    document.addEventListener('click', (e) => {
      const item = e.target.closest('.segmented-switch-item');
      if (!item) return;

      const track = item.closest('.segmented-switch');
      if (!track) return;

      // Action buttons group (e.g. cut buttons in selected layer drawer) are buttons, not a persistent switch
      if (track.hasAttribute('data-action-buttons') || track.classList.contains('is-action-buttons') || track.closest('#timeline-layer-drawer') || track.closest('.layer-action-grid')) {
        return;
      }

      this.activateItem(track, item);
    });
  }

  /**
   * Resolves target switch track container
   * @param {string|HTMLElement} target 
   * @returns {HTMLElement|null}
   */
  resolveElement(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  /**
   * Activates a specific item within a track
   * @param {HTMLElement} track 
   * @param {HTMLElement} item 
   */
  activateItem(track, item) {
    if (!track || !item || item.classList.contains('is-active')) return;

    const items = Array.from(track.querySelectorAll('.segmented-switch-item'));
    const prevActive = track.querySelector('.segmented-switch-item.is-active, .segmented-switch-item.is-selected');

    items.forEach((btn) => {
      btn.classList.remove('is-active');
      btn.classList.remove('is-selected');
      btn.setAttribute('aria-selected', 'false');
    });

    item.classList.add('is-active');
    item.classList.add('is-selected');
    item.setAttribute('aria-selected', 'true');

    const value = item.dataset.value || item.getAttribute('data-category') || item.textContent.trim();
    const index = items.indexOf(item);

    // Dispatch custom event
    const event = new CustomEvent('switch:change', {
      bubbles: true,
      detail: {
        value,
        index,
        item,
        prevActive,
        track
      }
    });
    track.dispatchEvent(event);
  }

  /**
   * Selects a segment by value or index programmatically
   * @param {string|HTMLElement} target 
   * @param {string|number} valueOrIndex 
   */
  select(target, valueOrIndex) {
    const track = this.resolveElement(target);
    if (!track) return;

    const items = Array.from(track.querySelectorAll('.segmented-switch-item'));
    let itemToSelect = null;

    if (typeof valueOrIndex === 'number') {
      itemToSelect = items[valueOrIndex] || null;
    } else {
      itemToSelect = items.find(
        (i) => i.dataset.value === valueOrIndex || i.getAttribute('data-category') === valueOrIndex
      );
    }

    if (itemToSelect) {
      this.activateItem(track, itemToSelect);
    }
  }

  /**
   * Gets current active value of a switch track
   * @param {string|HTMLElement} target 
   * @returns {string|null}
   */
  getValue(target) {
    const track = this.resolveElement(target);
    if (!track) return null;

    const active = track.querySelector('.segmented-switch-item.is-active, .segmented-switch-item.is-selected');
    if (!active) return null;

    return active.dataset.value || active.getAttribute('data-category') || active.textContent.trim();
  }
}

// Global Singleton Instance
window.Switch = new SwitchManager();
