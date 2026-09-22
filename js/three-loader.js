/**
 * FishTools Studio - Three.js Lazy CDN Loader
 * Asynchronously loads Three.js and core extensions from CDN on demand.
 */

(function (window) {
  'use strict';

  var SCRIPTS = [
    'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/js/loaders/GLTFLoader.js',
    'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/js/controls/OrbitControls.js'
  ];

  var loadPromise = null;

  /**
   * Helper to load an external script via a script tag.
   * @param {string} src
   * @returns {Promise<void>}
   */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      // Return early if this script has already been loaded in DOM
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', function () { resolve(); }, { once: true });
        existing.addEventListener('error', function () {
          reject(new Error('Failed to load script: ' + src));
        }, { once: true });
        return;
      }

      var script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = src;
      script.async = true;

      script.onload = function () {
        script.dataset.loaded = 'true';
        resolve();
      };

      script.onerror = function () {
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        reject(new Error('Failed to load script: ' + src));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Lazy load Three.js and required add-ons.
   * @returns {Promise<typeof THREE>}
   */
  function loadThreeJS() {
    // If Three.js and required add-ons are already present on window, return immediately
    if (window.THREE && window.THREE.GLTFLoader && window.THREE.OrbitControls) {
      return Promise.resolve(window.THREE);
    }

    // Return cached promise if loading is in flight or already completed
    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = new Promise(function (resolve, reject) {
      var promise = Promise.resolve();

      // Load CDN scripts sequentially in order
      SCRIPTS.forEach(function (url) {
        promise = promise.then(function () {
          return loadScript(url);
        });
      });

      promise
        .then(function () {
          resolve(window.THREE);
        })
        .catch(function (err) {
          // Reset cache on error so subsequent attempts can retry
          loadPromise = null;
          console.error('[ThreeLoader] Failed to load Three.js:', err);
          reject(err);
        });
    });

    return loadPromise;
  }

  // Export to window
  window.loadThreeJS = loadThreeJS;
})(typeof window !== 'undefined' ? window : this);
