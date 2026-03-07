// player.js — phase 3 placeholder
// Full player implementation (slide renderer, HLS, progress tracking) in phase 3.

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  const root = document.querySelector('#app')?.dataset.courseRoot ?? '.';
  const swPath = root === '..' || root === '../..'
    ? root + '/sw.js'
    : './sw.js';
  navigator.serviceWorker.register(swPath, { scope: swPath.replace('sw.js', '') }).catch(() => {});
}
