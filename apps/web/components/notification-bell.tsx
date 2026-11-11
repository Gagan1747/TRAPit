"use client";

import { useEffect, useRef, useState } from "react";
import { registerBrowserPush as saveBrowserPushSubscription } from "./browser-push-prompt";

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

function isBrowserPushSupported() {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
    && window.isSecureContext;
}

export function NotificationBell({ items, subtitle, title }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [apportionItems, setApportionItems] = useState<NotificationBellItem[]>([]);
  const [whatsappEnabled, setWhatsappEnabled] = useState<boolean>(true);
  const [isSavingWhatsapp, setIsSavingWhatsapp] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const allItems = [...apportionItems, ...items];
  const totalCount = allItems.reduce((sum, item) => sum + item.count, 0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadApportionNotifications() {
      try {
        const response = await fetch("/api/user/apportion?notifications=1", { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as {
          notifications: Array<{ id: string; title: string; body: string; url: string }>;
          whatsappEnabled?: boolean;
        };
        if (!controller.signal.aborted) {
          setApportionItems(payload.notifications.map((entry) => ({ label: entry.title, detail: entry.body, count: 1, actionHref: entry.url, actionLabel: "Open" })));
          if (typeof payload.whatsappEnabled === "boolean") {
            setWhatsappEnabled(payload.whatsappEnabled);
          }
        }
      } catch { }
    }
    void loadApportionNotifications();
    const interval = window.setInterval(() => void loadApportionNotifications(), 60_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [isOpen]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  async function updateWhatsappPreference(nextEnabled: boolean) {
    setWhatsappEnabled(nextEnabled);
    setIsSavingWhatsapp(true);
    try {
      const response = await fetch("/api/user/apportion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-whatsapp-preference", whatsappEnabled: nextEnabled }),
      });
      if (response.ok) {
        const payload = await response.json() as { whatsappEnabled?: boolean };
        if (typeof payload.whatsappEnabled === "boolean") {
          setWhatsappEnabled(payload.whatsappEnabled);
        }
        window.dispatchEvent(new CustomEvent("trapit:whatsapp-preference-changed", { detail: { whatsappEnabled: nextEnabled } }));
      }
    } catch {
      // Keep local selection
    } finally {
      setIsSavingWhatsapp(false);
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
          <div className="notification-whatsapp-setting">
            <span className="field-label">Send whatsapp notification:</span>
            <div className="business-choice-row" role="group" aria-label="Send whatsapp notification">
              <button
                aria-pressed={whatsappEnabled}
                className="business-choice-button"
                disabled={isSavingWhatsapp}
                type="button"
                onClick={() => void updateWhatsappPreference(true)}
              >
                Yes
              </button>
              <button
                aria-pressed={!whatsappEnabled}
                className="business-choice-button"
                disabled={isSavingWhatsapp}
                type="button"
                onClick={() => void updateWhatsappPreference(false)}
              >
                No
              </button>
            </div>
          </div>
          <div className="notification-panel-list">
            {allItems.map((item) => (
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