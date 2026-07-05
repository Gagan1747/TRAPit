"use client";

import { useEffect, useRef, useState } from "react";

export type NotificationBellItem = {
  actionHref?: string;
  actionLabel?: string;
  count: number;
  detail?: string;
  label: string;
  tone?: "default" | "live" | "soon";
};

type NotificationBellProps = {
  browserPushPublicKey?: string | null;
  enableBrowserPush?: boolean;
  items: NotificationBellItem[];
  subtitle: string;
  title: string;
};

function BellIcon() {
  return (
    <svg aria-hidden="true" className="notification-bell-icon" viewBox="0 0 24 24">
      <path
        d="M12 3.75a4.5 4.5 0 0 0-4.5 4.5v1.12c0 .8-.23 1.58-.67 2.25l-1.2 1.86a2.25 2.25 0 0 0 1.89 3.47h9.96a2.25 2.25 0 0 0 1.89-3.47l-1.2-1.86a4.1 4.1 0 0 1-.67-2.25V8.25a4.5 4.5 0 0 0-4.5-4.5Zm0 16.5a2.63 2.63 0 0 1-2.48-1.75h4.96A2.63 2.63 0 0 1 12 20.25Z"
        fill="currentColor"
      />
    </svg>
  );
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

export function NotificationBell({ browserPushPublicKey, enableBrowserPush = false, items, subtitle, title }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [browserPushStatus, setBrowserPushStatus] = useState<"idle" | "registered" | "registering" | "unavailable">("idle");
  const [browserPushFeedback, setBrowserPushFeedback] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  const canRegisterBrowserPush = enableBrowserPush && Boolean(browserPushPublicKey);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!canRegisterBrowserPush) {
      setBrowserPushStatus("unavailable");
      return;
    }

    if (!isBrowserPushSupported()) {
      setBrowserPushStatus("unavailable");
      return;
    }

    if (Notification.permission === "granted") {
      setBrowserPushStatus("registered");
    }
  }, [canRegisterBrowserPush]);

  async function registerBrowserPush() {
    if (!browserPushPublicKey || !isBrowserPushSupported()) {
      setBrowserPushFeedback("Browser notifications are not available here.");
      setBrowserPushStatus("unavailable");
      return;
    }

    try {
      setBrowserPushStatus("registering");
      setBrowserPushFeedback(null);

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setBrowserPushFeedback("Browser notification permission was not granted.");
        setBrowserPushStatus("idle");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription = existingSubscription ?? await registration.pushManager.subscribe({
        applicationServerKey: urlBase64ToUint8Array(browserPushPublicKey),
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

      setBrowserPushFeedback("Browser notifications are enabled.");
      setBrowserPushStatus("registered");
    } catch (error) {
      setBrowserPushFeedback(error instanceof Error ? error.message : "Unable to enable browser notifications.");
      setBrowserPushStatus("idle");
    }
  }

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="notification-bell-button"
        type="button"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <BellIcon />
        {totalCount ? <span className="notification-bell-badge">{totalCount}</span> : null}
        <span className="sr-only">Open notifications</span>
      </button>

      {isOpen ? (
        <div aria-label={title} className="notification-panel panel" role="dialog">
          <p className="eyebrow">Notifications</p>
          <h2 className="section-title">{title}</h2>
          <p className="muted-text notification-panel-subtitle">{subtitle}</p>
          {canRegisterBrowserPush ? (
            <div className="notification-browser-push">
              <button
                className="mini-link notification-browser-push-button"
                disabled={browserPushStatus === "registering" || browserPushStatus === "registered"}
                type="button"
                onClick={() => void registerBrowserPush()}
              >
                {browserPushStatus === "registered"
                  ? "Browser alerts enabled"
                  : browserPushStatus === "registering"
                    ? "Enabling..."
                    : "Enable browser alerts"}
              </button>
              {browserPushFeedback ? <small>{browserPushFeedback}</small> : null}
            </div>
          ) : null}
          <div className="notification-panel-list">
            {items.map((item) => (
              <div className={`notification-panel-item${item.tone ? ` is-${item.tone}` : ""}`} key={`${item.label}-${item.detail ?? item.count}`}>
                <div className="notification-panel-item-copy">
                  <span>{item.label}</span>
                  {item.detail ? <small>{item.detail}</small> : null}
                </div>
                {item.actionHref ? (
                  <a className="mini-link" href={item.actionHref} target="_blank" rel="noreferrer">
                    {item.actionLabel ?? "Open"}
                  </a>
                ) : (
                  <strong>{item.count}</strong>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}