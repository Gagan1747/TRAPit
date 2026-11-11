"use client";

import { useEffect, useState } from "react";

const DISMISS_UNTIL_KEY = "trapit.browserPushPrompt.dismissUntil";
const PROMPT_TRIGGER_COUNT_KEY = "trapit.browserPushPrompt.triggerCount";
const PROMPT_TRIGGER_EVENT = "trapit:notification-prompt-opportunity";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
let registrationQueue: Promise<void> = Promise.resolve();
const BLOCKED_MESSAGE = "Notifications are blocked. Allow notifications in your browser's site settings, then return here and retry.";

type BrowserPushPromptProps = {
  mode?: "automatic" | "triggered";
  publicKey?: string | null;
};

export function markNotificationPromptOpportunity() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(PROMPT_TRIGGER_EVENT));
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function isBrowserPushSupported() {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
    && window.isSecureContext;
}

function isPromptDismissed() {
  try {
    const dismissedUntil = Number(window.localStorage.getItem(DISMISS_UNTIL_KEY) ?? "0");
    return Number.isFinite(dismissedUntil) && dismissedUntil > Date.now();
  } catch {
    return false;
  }
}

export function registerBrowserPush(publicKey: string) {
  // Each queued call must bind against the current session, rather than reuse another account's result.
  const operation = registrationQueue.then(() => registerBrowserPushUnqueued(publicKey));
  registrationQueue = operation.catch((error: unknown) => {
    console.error("Browser notification registration failed:", error instanceof Error ? error.message : "Unknown error");
  });
  return operation;
}

async function registerBrowserPushUnqueued(publicKey: string) {
  if (Notification.permission === "denied") throw new Error(BLOCKED_MESSAGE);
  if (Notification.permission !== "granted") throw new Error("Accept browser notifications before enabling alerts.");
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    if (!registration.active) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("The notification service worker did not become ready. Reload this dashboard and retry.")), 15_000);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  } catch (error) {
    throw new Error(`Unable to start browser notifications. ${error instanceof Error ? error.message : "Reload this dashboard and retry."}`);
  }
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription = existingSubscription ?? await registration.pushManager.subscribe({
    applicationServerKey: urlBase64ToUint8Array(publicKey),
    userVisibleOnly: true,
  });
  try {
    const response = await fetch("/api/user/web-push-subscriptions", {
      body: JSON.stringify(subscription),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Unable to save browser notification settings.");
    }
  } catch (error) {
    // A failed account rebind must not leave this browser receiving the previous account's pushes.
    await subscription.unsubscribe();
    throw error;
  }
}

export function BrowserPushPrompt(_props: BrowserPushPromptProps) {
  return null;
}