self.addEventListener("push", (event) => {
  let payload = {
    body: "A TRAPit.in item is starting soon.",
    data: { url: "/user" },
    title: "TRAPit.in reminder",
  };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    data: payload.data || { url: "/user" },
    icon: "/favicon.ico",
    tag: `${payload.data?.kind || "trapit"}:${payload.data?.testId || payload.data?.pollId || Date.now()}`,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || "/user", self.location.origin).href;

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });

    for (const client of windowClients) {
      if (client.url === targetUrl && "focus" in client) {
        return client.focus();
      }
    }

    return clients.openWindow(targetUrl);
  })());
});