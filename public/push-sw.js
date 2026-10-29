/* Daily plan notification: the push carries no data; the text comes from what the app stored on
   this phone (IndexedDB "gt-notify", one entry per date), so the plan never leaves the device. */
const DB = 'gt-notify';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's text, or the "nothing planned" text the app stored under "fallback" (used by the test button). */
function readDigest(date) {
  return new Promise((resolve) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('days');
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      try {
        const store = open.result.transaction('days').objectStore('days');
        const req = store.get(date);
        req.onsuccess = () => {
          if (req.result) return resolve(req.result);
          const fb = store.get('fallback');
          fb.onsuccess = () => resolve(fb.result);
          fb.onerror = () => resolve(undefined);
        };
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    };
  });
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    readDigest(todayKey()).then((d) =>
      self.registration.showNotification(d?.title ?? 'Ground Time', {
        body: d?.body ?? '',
        tag: `plan-${todayKey()}`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: '/' },
      }),
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(event.notification.data?.url ?? '/');
    }),
  );
});
