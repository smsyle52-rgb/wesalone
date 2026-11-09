// Wesal One service worker: shows browser push notifications for new
// customer messages (sent by the worker via Web Push) and opens the chat on
// click. Kept dependency-free and served from the site root so its scope
// covers the whole app.

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

const DEFAULT_ICON = "/brand/favicon/web-app-manifest-192x192.png"

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || "Wesal One"
  const url = data.url || "/"

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      // The open inbox already chimes when it is in front of the agent.
      const inFront = windows.some(
        (client) => client.focused && client.visibilityState === "visible",
      )
      if (inFront) {
        return
      }
      await self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        dir: "auto",
        data: { url },
      })
    })(),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  ).href

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus()
          return client.navigate(target)
        }
      }
      return self.clients.openWindow(target)
    })(),
  )
})
