"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { matchApportionIdentity } from "@trapit/testing";
import { ArrowRight, Search } from "lucide-react";

import { formatPhoneNumberForDisplay } from "../lib/privacy";
import { FloatingWindowCloseButton } from "./floating-window-close-button";

type Business = { name: string; ownerIdentifier: string; appointmentShareCode: string };

export function ApportionBusinessSearch({ businesses, onClose }: { businesses: Business[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const normalizedPhone = query.trim().replace(/[\s()-]/g, "");
  const fullPhone = /^(?:\+[1-9]\d{7,14}|\d{10})$/.test(normalizedPhone);
  const results = businesses.filter((business) => business.appointmentShareCode && (!query.trim()
    || business.name.toLowerCase().includes(query.trim().toLowerCase())
    || (fullPhone && matchApportionIdentity(business.ownerIdentifier, normalizedPhone))));

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, input, a[href]") ?? []);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, []);

  return createPortal(
    <div className="apportion-search-overlay" onClick={onClose}>
      <div aria-labelledby="apportion-search-heading" aria-modal="true" className="apportion-business-search-drawer" ref={dialogRef} role="dialog" onClick={(event) => event.stopPropagation()}>
        <header className="apportion-business-search-head">
          <h2 id="apportion-search-heading">Add Appointment</h2>
          <FloatingWindowCloseButton label="Close Add Appointment" onClick={onClose} />
        </header>
        <div className="apportion-business-search-body">
          <div className="field">
            <label htmlFor="apportion-business-query">Business name or owner phone</label>
            <div className="apportion-business-search-input">
              <Search aria-hidden="true" size={18} />
              <input autoComplete="off" id="apportion-business-query" ref={inputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>
          <ul className="apportion-business-search-results">
            {results.map((business) => (
              <li key={`${business.ownerIdentifier}::${business.appointmentShareCode}`}>
                <a href={`/apportion/${encodeURIComponent(business.appointmentShareCode)}`}>
                  <span><strong>{business.name}</strong><span>{formatPhoneNumberForDisplay(business.ownerIdentifier, { showFullPhoneNumber: true })}</span></span>
                  <ArrowRight aria-hidden="true" size={20} />
                </a>
              </li>
            ))}
          </ul>
          {!results.length ? <p className="muted-text" role="status">No businesses found.</p> : null}
        </div>
      </div>
    </div>, document.body,
  );
}