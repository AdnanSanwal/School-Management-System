self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    fetch('/branding.json').then(r => r.json()).catch(() => ({ name: 'School ERP', icon: '/default-logo.svg' })).then(brand => self.registration.showNotification(data.title || brand.name, {
      body: data.body || '',
      icon: brand.icon,
      badge: brand.icon,
      data: { url: data.url || '/' },
    }))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
