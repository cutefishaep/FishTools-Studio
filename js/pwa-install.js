/**
 * OpenFishTools Studio - PWA Installation & Service Worker Manager
 * Direct Browser Install API Trigger (No Pop-up Modals)
 */

(function () {
  'use strict';

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

  // 2. Register Service Worker
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

  // 3. Update Install Button Visibility
  function updateInstallButton() {
    var btn = document.getElementById('btn-install-app');
    if (!btn) return;

    if (isInstalled || !deferredPrompt) {
      btn.style.display = 'none';
    } else {
      btn.style.display = 'inline-flex';
    }
  }

  // 4. Direct Install Trigger (Native API)
  async function promptInstall() {
    if (!deferredPrompt) {
      console.log('[PWA] No deferred prompt available');
      return;
    }

    try {
      deferredPrompt.prompt();
      var choice = await deferredPrompt.userChoice;
      console.log('[PWA] Install prompt user choice:', choice ? choice.outcome : 'unknown');
      deferredPrompt = null;
      updateInstallButton();
    } catch (err) {
      console.warn('[PWA] Direct prompt error:', err);
    }
  }

  // 5. Event: beforeinstallprompt
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] beforeinstallprompt event captured');
    updateInstallButton();
  });

  // 6. Event: appinstalled
  window.addEventListener('appinstalled', function () {
    isInstalled = true;
    deferredPrompt = null;
    console.log('[PWA] OpenFishTools Studio successfully installed!');
    updateInstallButton();
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

  // Initialize button state on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateInstallButton);
  } else {
    updateInstallButton();
  }

  // Expose global controller
  window.PWAInstall = {
    prompt: promptInstall,
    handleInstallRequest: promptInstall,
    isInstalled: function () {
      return isInstalled;
    },
    isInstallable: function () {
      return !!deferredPrompt;
    }
  };
})();
