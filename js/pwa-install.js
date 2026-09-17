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

  // 2b. Detect macOS Safari
  function isMacSafari() {
    var ua = navigator.userAgent;
    var isMac = /Macintosh|MacIntel|MacPPC|Mac68K/i.test(navigator.platform || '') || /Macintosh/i.test(ua);
    var isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|Vivaldi|FxiOS/i.test(ua);
    return isMac && isSafari && !isIOS();
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

    // Always visible unless already running as installed standalone app
    btn.style.display = 'inline-flex';
  }

  // 5. Open Install Pop-up Modal
  function openInstallModal() {
    if (isInstalled) return;

    var modal = document.getElementById('modal-install-app');
    if (!modal) return;

    // Adapt content for iOS / macOS Safari / Generic Desktop / Native prompt
    var iosCard = document.getElementById('install-ios-instructions');
    var macCard = document.getElementById('install-mac-safari-instructions');
    var desktopCard = document.getElementById('install-desktop-instructions');
    var nativeAction = document.getElementById('install-pwa-action-btn');
    var actionText = nativeAction ? nativeAction.querySelector('span') : null;
    var defaultDesc = document.getElementById('install-modal-desc');

    if (iosCard) iosCard.style.display = 'none';
    if (macCard) macCard.style.display = 'none';
    if (desktopCard) desktopCard.style.display = 'none';

    // Primary action button is ALWAYS visible!
    if (nativeAction) {
      nativeAction.style.display = 'inline-flex';
    }

    if (deferredPrompt) {
      // Browser with native prompt ready (Chrome, Edge, Android)
      if (actionText) actionText.textContent = 'Install as App';
      if (defaultDesc) {
        defaultDesc.textContent = 'Install as a standalone app for faster startup, offline access, and durable local project storage.';
      }
    } else if (isMacSafari()) {
      // macOS Safari (Add to Dock)
      if (macCard) macCard.style.display = 'block';
      if (actionText) actionText.textContent = 'Got It (File → Add to Dock)';
      if (defaultDesc) {
        defaultDesc.textContent = 'Add OpenFishTools Studio to your Mac Dock for native window experience and persistent storage.';
      }
    } else if (isIOS()) {
      // iOS / iPadOS Safari (Add to Home Screen)
      if (iosCard) iosCard.style.display = 'block';
      if (actionText) actionText.textContent = 'Got It (Share → Home Screen)';
      if (defaultDesc) {
        defaultDesc.textContent = 'Add OpenFishTools Studio to your Home Screen for faster startup and offline access.';
      }
    } else {
      // Generic desktop browser without active prompt
      if (desktopCard) desktopCard.style.display = 'block';
      if (actionText) actionText.textContent = 'Got It (Address Bar Install)';
      if (defaultDesc) {
        defaultDesc.textContent = 'Install OpenFishTools Studio as a standalone desktop application directly from your browser.';
      }
    }

    if (window.Modal && typeof window.Modal.open === 'function') {
      window.Modal.open('modal-install-app');
    }
  }

  // 6. Header Action: Direct Browser Native Install Prompt (or Fallback Modal)
  async function handleInstallRequest() {
    if (deferredPrompt) {
      try {
        // Direct browser installation API invocation (Chromium / Android / Edge)
        deferredPrompt.prompt();
        var choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          console.log('[PWA] User accepted installation prompt');
          deferredPrompt = null;
          updateInstallButton();
          if (window.Modal && typeof window.Modal.close === 'function') {
            window.Modal.close();
          }
        } else {
          console.log('[PWA] User dismissed installation prompt');
        }
      } catch (err) {
        console.warn('[PWA] Direct prompt error, falling back to modal:', err);
        openInstallModal();
      }
      return;
    }

    // Browsers without beforeinstallprompt (Safari macOS, Safari iOS, Firefox, etc.)
    openInstallModal();
  }

  // 6b. Action Button Click INSIDE Modal Card
  async function handleModalActionClick() {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        var choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          console.log('[PWA] User accepted installation prompt');
          deferredPrompt = null;
          updateInstallButton();
        }
      } catch (err) {
        console.warn('[PWA] Modal action prompt error:', err);
      }
      if (window.Modal && typeof window.Modal.close === 'function') {
        window.Modal.close();
      } else {
        var m = document.getElementById('modal-install-app');
        if (m) m.classList.remove('is-active');
      }
      return;
    }

    // Modal closed for Safari / unsupported browser
    if (window.Modal && typeof window.Modal.close === 'function') {
      window.Modal.close();
    } else {
      var m = document.getElementById('modal-install-app');
      if (m) m.classList.remove('is-active');
    }

    if (isMacSafari()) {
      if (typeof window.showDashboardToast === 'function') {
        window.showDashboardToast("In Safari: Click File → 'Add to Dock...' in your menu bar");
      }
    } else if (isIOS()) {
      if (typeof window.showDashboardToast === 'function') {
        window.showDashboardToast("In Safari: Tap Share → 'Add to Home Screen'");
      }
    } else {
      if (typeof window.showDashboardToast === 'function') {
        window.showDashboardToast("Click the Install icon in your browser address bar");
      }
    }
  }

  // 7. Dismiss and record cooldown
  function dismissInstallPrompt() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (_) {}
    if (window.Modal && typeof window.Modal.close === 'function') {
      window.Modal.close();
    } else {
      var m = document.getElementById('modal-install-app');
      if (m) m.classList.remove('is-active');
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
    } else {
      var m = document.getElementById('modal-install-app');
      if (m) m.classList.remove('is-active');
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
    prompt: handleInstallRequest,
    handleInstallRequest: handleInstallRequest,
    onModalAction: handleModalActionClick,
    dismiss: dismissInstallPrompt,
    isInstalled: function () {
      return isInstalled;
    },
    isInstallable: function () {
      return !!deferredPrompt || isIOS() || isMacSafari();
    }
  };
})();
