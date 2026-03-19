// Intercepta push ANTES de que ngsw lo maneje
self.addEventListener('push', (event) => {
  event.stopImmediatePropagation();

  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); } catch { return; }

  const notif = payload?.notification;
  if (!notif) return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si alguna ventana tiene la app visible y en foco, no mostrar notificación
      const appVisible = windowClients.some((c) => c.visibilityState === 'visible');
      if (appVisible) return Promise.resolve();

      return self.registration.showNotification(notif.title, {
        body: notif.body,
        icon: notif.icon || '/icons/icon-192x192.png',
        badge: notif.badge || '/icons/icon-72x72.png',
        vibrate: notif.vibrate || [100, 50, 100],
        data: notif.data || {},
      });
    })
  );
});

// Manejar clic en notificación
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.onActionClick?.default?.url || '/chat';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const existing = windowClients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        return existing.navigate(url);
      }
      return clients.openWindow(url);
    })
  );
});

// Delegar todo lo demás (caching, etc.) a ngsw
importScripts('/ngsw-worker.js');
