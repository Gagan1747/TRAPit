"use client";

import { useEffect, useState } from "react";

const DISMISS_UNTIL_KEY = "trapit.browserPushPrompt.dismissUntil";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

type BrowserPushPromptProps = {
  publicKey?: string | null;
};

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
  const dismissedUntil = Number(window.localStorage.getItem(DISMISS_UNTIL_KEY) ?? "0");

  return Number.isFinite(dismissedUntil) && dismissedUntil > Date.now();
}

async function registerBrowserPush(publicKey: string) {
  const registration = await navigator.serviceWorker.register("/sw.js");
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription = existingSubscription ?? await registration.pushManager.subscribe({
    applicationServerKey: urlBase64ToUint8Array(publicKey),
    userVisibleOnly: true,
  });
  const response = await fetch("/api/user/web-push-subscriptions", {
    body: JSON.stringify(subscription),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Unable to save browser notification settings.");
  }
}

export function BrowserPushPrompt({ publicKey }: BrowserPushPromptProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!publicKey || !isBrowserPushSupported()) {
      return;
    }

    if (Notification.permission === "granted") {
      void registerBrowserPush(publicKey).catch((error) => {
        console.warn("Unable to refresh browser push subscription.", error);
      });
      return;
    }

    if (Notification.permission === "default" && !isPromptDismissed()) {
      setIsVisible(true);
    }
  }, [publicKey]);

  async function handleEnable() {
    if (!publicKey || !isBrowserPushSupported()) {
      setFeedback("Browser notifications are not available in this browser.");
      return;
    }

    try {
      setIsRegistering(true);
      setFeedback(null);

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setFeedback("Notification permission was not granted.");
        return;
      }

      await registerBrowserPush(publicKey);
      setFeedback("Browser reminders are enabled for this device.");
      setIsVisible(false);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to enable browser reminders.");
    } finally {
      setIsRegistering(false);
    }
  }

  function handleDismiss() {
    window.localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_DURATION_MS));
    setIsVisible(false);
  }

  if (!isVisible && !feedback) {
    return null;
  }

  return (
    <div className="browser-push-prompt panel">
      <div>
        <p className="browser-push-prompt-title">Allow TRAPit to notify you before Tests and Polls</p>
        {feedback ? <p className="form-feedback">{feedback}</p> : null}
      </div>
      {isVisible ? (
        <div className="browser-push-prompt-actions">
          <button className="primary-button" disabled={isRegistering} type="button" onClick={() => void handleEnable()}>
            {isRegistering ? "Allowing..." : "Allow"}
          </button>
          <button className="secondary-button" type="button" onClick={handleDismiss}>
            Block
          </button>
        </div>
      ) : null}
    </div>
  );
}