"use client";

import { useEffect, useRef, useState } from "react";

export type NotificationBellItem = {
  count: number;
  label: string;
};

type NotificationBellProps = {
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

export function NotificationBell({ items, subtitle, title }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

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
          <div className="notification-panel-list">
            {items.map((item) => (
              <div className="notification-panel-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}