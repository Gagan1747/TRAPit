"use client";

import { useEffect, useState } from "react";

type LocalDateTimeTextProps = {
  fallback: string;
  value: string | null;
};

export function LocalDateTimeText({ fallback, value }: LocalDateTimeTextProps) {
  const [formattedValue, setFormattedValue] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setFormattedValue(null);
      return;
    }

    setFormattedValue(
      new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(value)),
    );
  }, [value]);

  return <span suppressHydrationWarning>{formattedValue ?? fallback}</span>;
}