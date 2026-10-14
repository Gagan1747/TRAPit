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

export function BrowserPushPrompt({ mode = "triggered", publicKey }: BrowserPushPromptProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!publicKey || !isBrowserPushSupported()) {
      return;
    }

    if (Notification.permission === "denied") {
      setFeedback(BLOCKED_MESSAGE);
      return;
    }

    if (Notification.permission === "granted") {
      const refresh = () => {
        if (document.visibilityState === "hidden") return;
        void registerBrowserPush(publicKey).then(() => setFeedback(null)).catch((error) => {
          setFeedback(error instanceof Error ? error.message : "Unable to refresh browser notifications.");
        });
      };
      refresh();
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", refresh);
      return () => {
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", refresh);
      };
    }

    if (mode === "automatic" && Notification.permission === "default" && !isPromptDismissed()) {
      const showPromptTimer = window.setTimeout(() => {
        setIsVisible(true);
      }, 5000);

      return () => window.clearTimeout(showPromptTimer);
    }
  }, [mode, publicKey]);

  useEffect(() => {
    if (!publicKey || mode !== "triggered" || !isBrowserPushSupported()) {
      return;
    }

    function handlePromptOpportunity() {
      if (Notification.permission === "granted") {
        void registerBrowserPush(publicKey!).then(() => setFeedback(null)).catch((error) => setFeedback(error instanceof Error ? error.message : "Unable to refresh browser notifications."));
        return;
      }
      if (Notification.permission !== "default") return;
      if (isPromptDismissed()) {
        return;
      }

      let currentCount = 0;
      try {
        currentCount = Number(window.localStorage.getItem(PROMPT_TRIGGER_COUNT_KEY) ?? "0");
      } catch { /* Storage may be disabled in private browsing. */ }
      const nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
      try {
        window.localStorage.setItem(PROMPT_TRIGGER_COUNT_KEY, String(nextCount));
      } catch { /* Notification consent must not depend on local storage. */ }

      if (nextCount % 3 === 1) {
        setIsVisible(true);
      }
    }

    window.addEventListener(PROMPT_TRIGGER_EVENT, handlePromptOpportunity);

    return () => window.removeEventListener(PROMPT_TRIGGER_EVENT, handlePromptOpportunity);
  }, [mode, publicKey]);

  async function handleEnable() {
    if (!publicKey || !isBrowserPushSupported()) {
      setFeedback("Browser notifications are not available in this browser.");
      return;
    }

    try {
      setIsRegistering(true);
      setFeedback(null);

      const permission = await Notification.requestPermission();
      setIsVisible(false);

      if (permission !== "granted") {
        if (permission === "denied") setFeedback(BLOCKED_MESSAGE);
        return;
      }

      await registerBrowserPush(publicKey);
      setIsVisible(false);
    } catch (error) {
      setIsVisible(false);
      setFeedback(error instanceof Error ? error.message : "Unable to enable browser reminders. Retry here on this dashboard.");
    } finally {
      setIsRegistering(false);
    }
  }

  function handleDismiss() {
    try {
      window.localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_DURATION_MS));
    } catch { /* Dismiss for this visit when storage is unavailable. */ }
    setIsVisible(false);
    setFeedback(null);
  }

  if (!isVisible && !feedback) {
    return null;
  }

  return (
    <div className="browser-push-prompt panel">
      <div>
        <p className="browser-push-prompt-title">Enable Notifications</p>
        <p className="browser-push-prompt-copy">Receive alerts for invited tests and polls, your customer appointments, and reminders 30 minutes and 1 minute before they start.</p>
        {feedback ? <p className="form-feedback">{feedback}</p> : null}
      </div>
      {isVisible ? (
        <div className="browser-push-prompt-actions">
          <button className="browser-push-allow-button" disabled={isRegistering} type="button" onClick={() => void handleEnable()}>
            {isRegistering ? "Enabling..." : "Accept"}
          </button>
          <button className="browser-push-later-button" disabled={isRegistering} type="button" onClick={handleDismiss}>
            Decline
          </button>
        </div>
      ) : (
        <div className="browser-push-prompt-actions">
          <button className="browser-push-allow-button" disabled={isRegistering} type="button" onClick={() => void handleEnable()}>
            {isRegistering ? "Enabling..." : "Retry"}
          </button>
          <button className="browser-push-later-button" type="button" onClick={() => setFeedback(null)}>Dismiss message</button>
        </div>
      )}
    </div>
  );
}