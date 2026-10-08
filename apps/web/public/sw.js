function safeNotificationUrl(value) {
  try {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return `${self.location.origin}/user`;
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.href : `${self.location.origin}/user`;
  } catch {
    return `${self.location.origin}/user`;
  }
}

self.addEventListener("push", (event) => {
  let payload = {
    body: "Sign in to view your TRAPit.in update.",
    data: { url: "/user" },
    title: "TRAPit.in reminder",
  };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      // Malformed push payloads must not expose arbitrary content on the lock screen.
    }
  }

  const options = {
    body: "Sign in to view your TRAPit.in update.",
    data: { url: safeNotificationUrl(payload?.data?.url) },
    icon: "/favicon.ico",
    tag: payload?.data?.deliveryKey || `trapit:${Date.now()}`,
  };

  event.waitUntil(self.registration.showNotification("TRAPit.in notification", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = safeNotificationUrl(event.notification.data?.url);

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