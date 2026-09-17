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

  function showFeedback(text) {
    if (typeof window.showDashboardToast === 'function') {
      window.showDashboardToast(text, 3500);
    } else {
      console.log('[PWA]', text);
    }
  }

  // 3. Update Install Button Visibility
  function updateInstallButton() {
    var btn = document.getElementById('btn-install-app');
    if (!btn) return;

    // Sembunyikan hanya jika sudah berjalan di dalam app mode (standalone)
    if (isInstalled) {
      btn.style.display = 'none';
    } else {
      btn.style.display = 'inline-flex';
    }
  }

  // 4. Direct Install Trigger (Native API)
  async function promptInstall() {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        var choice = await deferredPrompt.userChoice;
        console.log('[PWA] Install prompt user choice:', choice ? choice.outcome : 'unknown');
        if (choice && choice.outcome === 'accepted') {
          deferredPrompt = null;
          isInstalled = true;
          updateInstallButton();
        }
      } catch (err) {
        console.warn('[PWA] Direct prompt error:', err);
      }
      return;
    }

    // Jika belum ada event native prompt (misal di Safari Mac/iOS atau di file://)
    if (window.location.protocol === 'file:') {
      showFeedback('Jalankan lewat server (http://localhost) untuk menginstal web app.');
      return;
    }

    var ua = navigator.userAgent;
    var isMac = /Macintosh|MacIntel/i.test(ua);
    var isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Edg|CriOS/i.test(ua);
    var isIOS = /iPad|iPhone|iPod/.test(ua);

    if (isSafari && isMac) {
      showFeedback("Safari Mac: Klik menu 'File' → 'Add to Dock...'");
    } else if (isIOS) {
      showFeedback("iOS Safari: Tap Share (⎋) → 'Add to Home Screen'");
    } else {
      showFeedback('Klik ikon Install di address bar browser untuk menginstal app.');
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
