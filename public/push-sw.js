// Simple service worker for web push notifications
// Handles push payloads from the server and displays notifications with click navigation.

self.addEventListener('push', (event) => {
  let payload = {};

  const mergeData = (raw) => {
    if (!raw || typeof raw !== 'object') return {};

    const nestedData = raw.data;
    let parsedNested = {};

    if (typeof nestedData === 'string') {
      try {
        parsedNested = JSON.parse(nestedData);
      } catch (error) {
        parsedNested = {};
      }
    } else if (nestedData && typeof nestedData === 'object') {
      parsedNested = nestedData;
    }

    return { ...parsedNested, ...raw };
  };

  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    try {
      payload = event.data ? { body: event.data.text() } : {};
    } catch (nested) {
      payload = {};
    }
  }

  payload = mergeData(payload);

  const title = payload.title || payload.notification?.title || '알림이 도착했습니다';
  const body = payload.body || payload.notification?.body || '';
  const icon = payload.iconUrl || payload.icon || '/icon.png';
  const clickUrl = payload.clickUrl || payload.url || '/';
  const dedupKey = payload.dedupKey;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};

  const options = {
    body,
    icon,
    data: {
      ...data,
      clickUrl,
      dedupKey
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const targetUrl = notification.data && notification.data.clickUrl ? notification.data.clickUrl : '/';
  notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client && client.url.includes(new URL(targetUrl, self.location.origin).pathname)) {
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
