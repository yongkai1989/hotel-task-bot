/* Hallmark Hotel dashboard Web Push service worker. */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const taskId = String(payload.taskId || '').trim();
  const isUrgent = payload.kind === 'URGENT';
  const isTimed = isUrgent || payload.kind === 'CUSTOMER_WAITING';
  const title = String(
    payload.title || (isUrgent ? 'URGENT TASK' : 'Hotel task update')
  );
  const options = {
    body: String(payload.body || 'A hotel task requires your attention.'),
    tag: taskId ? `hotel-task-${taskId}` : 'hotel-task-alert',
    renotify: true,
    requireInteraction: isTimed,
    vibrate: isUrgent
      ? [300, 120, 300, 120, 600]
      : [220, 100, 220],
    timestamp: Number(payload.timestamp || Date.now()),
    data: {
      taskId,
      url: String(payload.url || '/dashboard'),
    },
    actions: [
      { action: 'open', title: 'Open task' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || '/dashboard',
    self.location.origin
  ).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) await client.navigate(targetUrl);
        return client.focus();
      }
    }

    return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CLEAR_TASK_NOTIFICATION') return;
  const taskId = String(event.data.taskId || '').trim();
  if (!taskId) return;

  event.waitUntil((async () => {
    const notifications = await self.registration.getNotifications({
      tag: `hotel-task-${taskId}`,
    });
    notifications.forEach((notification) => notification.close());
  })());
});
