self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const clientClaim = self.clients.claim();

  event.waitUntil(clientClaim);
});

self.addEventListener("fetch", () => {});
