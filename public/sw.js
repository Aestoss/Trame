// Minimal service worker — required by browsers for "Add to Home Screen" to
// register the app as installable. Deliberately does no offline caching yet
// (the app needs the network for every turn anyway); can be extended later.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {}); // no-op, passes requests through
