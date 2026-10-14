"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ApportionCancellationDialog({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void | string>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector("textarea")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current) onClose();
      if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled)") ?? []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); previousFocus?.focus(); };
  }, [onClose]);
  async function confirm() {
    if (pendingRef.current) return;
    if (!reason.trim()) { setError("A cancellation reason is required."); return; }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm(reason.trim());
      if (typeof result === "string") throw new Error(result);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to cancel. Please retry.");
    } finally { pendingRef.current = false; setPending(false); }
  }
  return createPortal(<div className="apportion-thread-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="apportion-cancel-title" className="apportion-thread-drawer">
      <header className="apportion-thread-header"><h2 id="apportion-cancel-title">Cancel appointment</h2><button className="button-secondary" type="button" disabled={pending} onClick={onClose}>Close</button></header>
      <div className="apportion-thread-body"><p>The reason will be added to Notes. Closing this dialog leaves the booking unchanged.</p><label htmlFor="apportion-cancel-reason">Cancellation reason</label><textarea id="apportion-cancel-reason" rows={4} maxLength={2000} value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} />{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
      <footer className="apportion-thread-footer"><button className="button" type="button" disabled={pending || !reason.trim()} onClick={() => void confirm()}>{pending ? "Cancelling..." : "Confirm cancellation"}</button></footer>
    </section>
  </div>, document.body);
}
