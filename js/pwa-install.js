/**
 * OpenFishTools Studio - PWA Installation & Service Worker Manager
 * Handles:
 * 1. Service worker registration & lifecycle
 * 2. beforeinstallprompt event capture & prompt triggering
 * 3. Modular "Install as App" pop-up modal & header action button
 * 4. iOS Safari "Add to Home Screen" instructions detection
 * 5. Standalone mode detection (auto-hides prompts when installed)
 */

(function () {
  'use strict';

  var DISMISS_KEY = 'oft_pwa_dismissed_time';
  var COOLDOWN_DAYS = 7;
  var deferredPrompt = null;
  var isInstalled = false;

  // 1. Detect Standalone Display Mode
  function checkIsInstalled() {
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  isInstalled = checkIsInstalled();

  // 2. Detect iOS Device
  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  // 3. Register Service Worker
  function registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker
          .register('./sw.js')
          .then(function (reg) {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);
          })
          .catch(function (err) {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });
    }
  }

  registerServiceWorker();

  // 4. Update Header Install Button Visibility
  function updateInstallButton() {
    var btn = document.getElementById('btn-install-app');
    if (!btn) return;

    if (isInstalled) {
      btn.style.display = 'none';
      return;
    }

    // Visible on browsers that fired beforeinstallprompt or on iOS
    if (deferredPrompt || isIOS()) {
      btn.style.display = 'inline-flex';
    }
  }

  // 5. Open Install Pop-up Modal
  function openInstallModal() {
    if (isInstalled) return;

    var modal = document.getElementById('modal-install-app');
    if (!modal) return;

    // Adapt content for iOS if needed
    var iosCard = document.getElementById('install-ios-instructions');
    var nativeAction = document.getElementById('install-pwa-action-btn');
    var defaultDesc = document.getElementById('install-modal-desc');

    if (isIOS() && !deferredPrompt) {
      if (iosCard) iosCard.style.display = 'block';
      if (nativeAction) nativeAction.style.display = 'none';
      if (defaultDesc) {
        defaultDesc.textContent = 'To install OpenFishTools Studio on iOS, tap Share in Safari and select Add to Home Screen.';
      }
    } else {
      if (iosCard) iosCard.style.display = 'none';
      if (nativeAction) nativeAction.style.display = 'inline-flex';
    }

    if (window.Modal && typeof window.Modal.open === 'function') {
      window.Modal.open('modal-install-app');
    }
  }

  // 6. Trigger Browser Native Install Prompt
  async function triggerInstallPrompt() {
    if (!deferredPrompt) {
      if (isIOS()) {
        openInstallModal();
        return;
      }
      // If deferredPrompt not available, alert instructions or open modal
      openInstallModal();
      return;
    }

    try {
      deferredPrompt.prompt();
      var choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        console.log('[PWA] User accepted installation prompt');
        deferredPrompt = null;
        if (window.Modal && typeof window.Modal.close === 'function') {
          window.Modal.close();
        }
      } else {
        console.log('[PWA] User dismissed installation prompt');
        dismissInstallPrompt();
      }
    } catch (err) {
      console.warn('[PWA] Install prompt error:', err);
    }
  }

  // 7. Dismiss and record cooldown
  function dismissInstallPrompt() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (_) {}
    if (window.Modal && typeof window.Modal.close === 'function') {
      window.Modal.close();
    }
  }

  // 8. Check auto-show eligibility
  function shouldAutoShowPrompt() {
    if (isInstalled) return false;
    try {
      var raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return true;
      var dismissedTime = parseInt(raw, 10);
      if (isNaN(dismissedTime)) return true;
      var elapsedDays = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      return elapsedDays >= COOLDOWN_DAYS;
    } catch (_) {
      return true;
    }
  }

  // 9. Event: beforeinstallprompt
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] beforeinstallprompt event captured');

    updateInstallButton();

    // Polite auto-popup after page settles
    if (shouldAutoShowPrompt()) {
      setTimeout(function () {
        // Only open if no other modal is currently open
        if (!document.querySelector('.modal-backdrop.is-active')) {
          openInstallModal();
        }
      }, 2500);
    }
  });

  // 10. Event: appinstalled
  window.addEventListener('appinstalled', function () {
    isInstalled = true;
    deferredPrompt = null;
    console.log('[PWA] OpenFishTools Studio successfully installed!');
    updateInstallButton();
    if (window.Modal && typeof window.Modal.close === 'function') {
      window.Modal.close();
    }
  });

  // Check display-mode changes dynamically
  if (window.matchMedia) {
    var mediaMatch = window.matchMedia('(display-mode: standalone)');
    if (mediaMatch.addEventListener) {
      mediaMatch.addEventListener('change', function (e) {
        isInstalled = e.matches;
        updateInstallButton();
      });
    }
  }

  // Initialize button on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateInstallButton);
  } else {
    updateInstallButton();
  }

  // Expose global controller
  window.PWAInstall = {
    openModal: openInstallModal,
    prompt: triggerInstallPrompt,
    dismiss: dismissInstallPrompt,
    isInstalled: function () {
      return isInstalled;
    },
    isInstallable: function () {
      return !!deferredPrompt || isIOS();
    }
  };
})();
