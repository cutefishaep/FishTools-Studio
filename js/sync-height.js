(function() {
  function syncAppHeight() {
    var h = window.innerHeight;
    document.documentElement.style.setProperty('--app-height', h + 'px');
  }
  syncAppHeight();
  window.addEventListener('resize', syncAppHeight, { passive: true });
  window.addEventListener('orientationchange', syncAppHeight, { passive: true });
})();
