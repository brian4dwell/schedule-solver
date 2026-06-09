"use client";

import { useEffect } from "react";

const serviceWorkerPath = "/sw.js";

function reportServiceWorkerError(error: unknown) {
  console.error("Service worker registration failed.", error);
}

function registerServiceWorker() {
  const browserSupportsServiceWorker = "serviceWorker" in navigator;

  if (!browserSupportsServiceWorker) {
    return;
  }

  const registrationPromise = navigator.serviceWorker.register(serviceWorkerPath);

  registrationPromise.catch(reportServiceWorkerError);
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return null;
}
