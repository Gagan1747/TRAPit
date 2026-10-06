"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { participantIdentifiersMatch } from "@trapit/testing";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, MessageSquare, X } from "lucide-react";

type AppointmentStatus = "cancelled" | "done" | "missed" | "pending" | "present-in-person" | "pushed-back" | "rejected";
type HistoryEntry = {
  action: "booked" | "cancelled" | "done" | "missed" | "present-in-person" | "pushed-back" | "rejected" | "rescheduled" | "address-opt-out";
  actorIdentifier: string;
  at: string;
  fromStartsAt: string | null;
  note: string | null;
  toStartsAt: string | null;
};
type AppointmentMessage = { id: string; authorIdentifier: string; createdAt: string; body: string };

export type ApportionLogAppointment = {
  canManage?: boolean;
  canMessage?: boolean;
  currentStatus: AppointmentStatus;
  history: HistoryEntry[];
  id: string;
  locationId?: string;
  locationAddress: string;
  locationName: string;
  messages: AppointmentMessage[];
  notes: string | null;
  originalStartsAt?: string;
  queueConvertedAt?: string;
  queueExpiresAt?: string;
  queueOrder?: number;
  ownerIdentifier: string;
  ownerName: string | null;
  queuePosition: number | null;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone: string | null;
  scope: "owner" | "requester";
  serialLabel: string;
  createdAt: string;
  serviceId?: string;
  serviceName?: string;
  startsAt: string;
  statusUpdatedAt: string;
  justAddToList: boolean;
  serviceDateKey: string;
};

type AppointmentUpdate = {
  appointmentId: string;
  action: "done" | "reject" | "cancel";
};

type DashboardUpdate = { ownerAppointments?: ApportionLogAppointment[]; requesterAppointments?: ApportionLogAppointment[] };

type ApportionAppointmentLogProps = {
  appointments: ApportionLogAppointment[];
  currentIdentifier: string | null;
  initialAppointmentId?: string;
  isActive: (status: AppointmentStatus) => boolean;
  isRequester: (appointment: ApportionLogAppointment) => boolean;
  formatDateTime: (value: string) => string;
  getStatusLabel: (appointment: ApportionLogAppointment) => string;
  getStatusHelper?: (appointment: ApportionLogAppointment) => string | null;
  onAction: (action: AppointmentUpdate) => void;
  onCancel: (appointmentId: string) => void;
  onRefresh: () => void | Promise<void>;
  onReschedule: (appointment: ApportionLogAppointment) => void;
  isUpdating: boolean;
  rescheduleEditor?: ReactNode;
};

const PAGE_SIZE = 6;
const CLOSED_STATUSES = new Set<AppointmentStatus>(["cancelled", "done", "missed", "rejected"]);

function AppointmentHistory({ appointment, contactName, originalTime, formatDateTime }: {
  appointment: ApportionLogAppointment;
  contactName: string;
  originalTime: string;
  formatDateTime: (value: string) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  function openHistory() {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) setPosition({ left: Math.max(16, Math.min(bounds.left, window.innerWidth - 356)), top: Math.max(16, Math.min(bounds.bottom + 6, window.innerHeight - 336)) });
    setIsOpen(true);
  }

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <span className="apportion-history-details">
      <button aria-expanded={isOpen} aria-label={`View original appointment time and history for ${contactName}`} ref={triggerRef} type="button" onClick={openHistory} onMouseEnter={openHistory} onFocus={openHistory}>Re</button>
      {isOpen ? createPortal(
        <div className="apportion-history-popover is-visible" ref={popupRef} style={{ left: position.left, top: position.top }}>
          <strong>Originally {formatDateTime(originalTime)}</strong>
          <ol>
            {appointment.history.map((entry, historyIndex) => (
              <li key={`${appointment.id}-${historyIndex}`}>
                <strong>{historyActionLabel(entry.action)}</strong>
                <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
                {entry.fromStartsAt || entry.toStartsAt ? <span>{entry.fromStartsAt ? `${formatDateTime(entry.fromStartsAt)} to ` : ""}{entry.toStartsAt ? formatDateTime(entry.toStartsAt) : ""}</span> : null}
                {entry.note ? <span>{entry.note}</span> : null}
              </li>
            ))}
          </ol>
        </div>, document.body,
      ) : null}
    </span>
  );
}

function historyActionLabel(action: HistoryEntry["action"]) {
  switch (action) {
    case "booked": return "Booked";
    case "rescheduled": return "Rescheduled";
    case "done": return "Done";
    case "rejected": return "Absent";
    case "missed": return "Missed";
    case "cancelled": return "Cancelled";
    case "pushed-back": return "Moved back in queue";
    case "present-in-person": return "Marked present";
    case "address-opt-out": return "Address unavailable";
  }
}

function groupKey(appointment: ApportionLogAppointment) {
  return `${appointment.ownerIdentifier}\u0000${appointment.locationId ?? ""}\u0000${appointment.serviceId || "consultation"}`;
}

function groupSortKey(appointment: ApportionLogAppointment) {
  return `${appointment.locationName}\u0000${appointment.serviceName || "Consultation"}\u0000${groupKey(appointment)}`;
}

export function ApportionAppointmentLog({
  appointments,
  currentIdentifier,
  initialAppointmentId,
  isActive,
  isRequester,
  formatDateTime,
  getStatusLabel,
  getStatusHelper,
  onAction,
  onCancel,
  onRefresh,
  onReschedule,
  isUpdating,
  rescheduleEditor,
}: ApportionAppointmentLogProps) {
  const [activePage, setActivePage] = useState(0);
  const [completedPage, setCompletedPage] = useState(0);
  const [threadAppointmentId, setThreadAppointmentId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<AppointmentMessage[] | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const focusedTicketRef = useRef<string | null>(null);
  const threadAppointment = threadAppointmentId
    ? appointments.find((appointment) => appointment.id === threadAppointmentId) ?? null
    : null;

  const activeAppointments = appointments
    .filter((appointment) => isActive(appointment.currentStatus))
    .sort((left, right) => groupSortKey(left).localeCompare(groupSortKey(right))
      || left.serviceDateKey.localeCompare(right.serviceDateKey)
      || Number(left.justAddToList) - Number(right.justAddToList)
      || (left.justAddToList && right.justAddToList ? (left.queueOrder ?? left.queuePosition ?? 0) - (right.queueOrder ?? right.queuePosition ?? 0) : new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()));
  const completedAppointments = appointments
    .filter((appointment) => !isActive(appointment.currentStatus))
    .sort((left, right) => groupSortKey(left).localeCompare(groupSortKey(right)) || completionTime(right) - completionTime(left));
  const activePageCount = Math.max(1, Math.ceil(activeAppointments.length / PAGE_SIZE));
  const completedPageCount = Math.max(1, Math.ceil(completedAppointments.length / PAGE_SIZE));
  const visibleActive = activeAppointments.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
  const visibleCompleted = completedAppointments.slice(completedPage * PAGE_SIZE, (completedPage + 1) * PAGE_SIZE);

  useEffect(() => setActivePage((page) => Math.min(page, activePageCount - 1)), [activePageCount]);
  useEffect(() => setCompletedPage((page) => Math.min(page, completedPageCount - 1)), [completedPageCount]);

  useEffect(() => {
    if (!initialAppointmentId || focusedTicketRef.current === initialAppointmentId) return;
    const activeIndex = activeAppointments.findIndex((appointment) => appointment.id === initialAppointmentId);
    if (activeIndex >= 0) {
      setActivePage(Math.floor(activeIndex / PAGE_SIZE));
      return;
    }
    const completedIndex = completedAppointments.findIndex((appointment) => appointment.id === initialAppointmentId);
    if (completedIndex >= 0) setCompletedPage(Math.floor(completedIndex / PAGE_SIZE));
  }, [activeAppointments, completedAppointments, initialAppointmentId]);

  useEffect(() => {
    if (!initialAppointmentId || focusedTicketRef.current === initialAppointmentId) return;
    const ticket = document.getElementById(`apportion-appointment-${initialAppointmentId}`);
    if (!ticket) return;
    focusedTicketRef.current = initialAppointmentId;
    ticket.scrollIntoView({ behavior: "smooth", block: "center" });
    ticket.focus({ preventScroll: true });
  }, [activePage, appointments, completedPage, initialAppointmentId]);

  useEffect(() => {
    if (!threadAppointmentId) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setThreadAppointmentId(null);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [threadAppointmentId]);

  async function sendMessage() {
    const message = messageDraft.trim();
    if (!threadAppointment || !message || sendingRef.current || !threadAppointment.canMessage
      || !isActive(threadAppointment.currentStatus) || CLOSED_STATUSES.has(threadAppointment.currentStatus)) return;
    sendingRef.current = true;
    setIsSending(true);
    setMessageError(null);
    try {
      const response = await fetch("/api/user/apportion", {
        body: JSON.stringify({ action: "send-message", appointmentId: threadAppointment.id, message }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await response.json() as DashboardUpdate & { error?: string; updatedAppointment?: Pick<ApportionLogAppointment, "id" | "messages"> };
      if (!response.ok) throw new Error(payload.error || "Unable to send the message.");
      const updatedAppointment = payload.updatedAppointment;
      if (updatedAppointment) {
        setThreadMessages(updatedAppointment.messages);
      }
      setMessageDraft("");
      await onRefresh();
      setThreadMessages(null);
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Unable to send the message.");
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  function renderRows(rows: ApportionLogAppointment[], completed: boolean) {
    let previousGroup = "";
    return rows.map((appointment, index) => {
      const key = groupKey(appointment);
      const groupHeading = key !== previousGroup;
      previousGroup = key;
      const requesterContext = isRequester(appointment);
      const canManage = appointment.canManage === true;
      const active = isActive(appointment.currentStatus);
      const canMessage = active && appointment.canMessage === true;
      const contactName = appointment.scope === "owner" ? appointment.requesterName : appointment.ownerName || "Business";
      const contactPhone = appointment.scope === "owner"
        ? appointment.requesterPhone || appointment.requesterIdentifier
        : appointment.ownerIdentifier;
      const completion = appointment.currentStatus === "done"
        ? [...appointment.history].reverse().find((entry) => entry.action === "done")?.at ?? appointment.statusUpdatedAt
        : null;
      const hasRescheduled = appointment.history.some((entry) => entry.action === "rescheduled");
      const originalTime = hasRescheduled
        ? appointment.originalStartsAt
          ?? appointment.history.find((entry) => entry.action === "booked")?.toStartsAt
          ?? appointment.history.find((entry) => entry.action === "rescheduled")?.fromStartsAt
        : null;
      const menuId = `apportion-actions-${appointment.id}`;
      const rowActions = (
        <details className="apportion-actions-menu" id={menuId}>
          <summary aria-label={`Actions for ${contactName}`} className="button-secondary small-button">Actions</summary>
          <div className="apportion-actions-menu-list">
            {canManage && active ? <button className="button-secondary small-button" disabled={isUpdating} type="button" onClick={() => { document.getElementById(menuId)?.removeAttribute("open"); onAction({ action: "done", appointmentId: appointment.id }); }}>Done</button> : null}
            {canManage && active ? <button className="button-secondary small-button" disabled={isUpdating} type="button" onClick={() => { document.getElementById(menuId)?.removeAttribute("open"); onAction({ action: "reject", appointmentId: appointment.id }); }}>Absent</button> : null}
            {requesterContext && active ? <button className="button-secondary small-button" disabled={isUpdating} type="button" onClick={() => { document.getElementById(menuId)?.removeAttribute("open"); onCancel(appointment.id); }}>Cancel</button> : null}
            {requesterContext && active && new Date(appointment.startsAt).getTime() > Date.now() && !appointment.justAddToList ? <button className="button-secondary small-button" disabled={isUpdating} type="button" onClick={() => { document.getElementById(menuId)?.removeAttribute("open"); onReschedule(appointment); }}>Reschedule</button> : null}
          </div>
        </details>
      );

      return (
        <Fragment key={appointment.id}>
          {groupHeading ? <tr className="apportion-log-group-row" key={`group-${appointment.id}`}><th colSpan={5} scope="rowgroup">{appointment.locationName} / {appointment.serviceName || "Consultation"}</th></tr> : null}
          <tr
            className={`apportion-log-row${appointment.id === initialAppointmentId ? " is-ticket-focus" : ""}`}
            data-apportion-appointment-id={appointment.id}
            id={`apportion-appointment-${appointment.id}`}
            key={appointment.id}
            tabIndex={appointment.id === initialAppointmentId ? -1 : undefined}
          >
            <td>{completed ? completedAppointments.findIndex((entry) => entry.id === appointment.id) + 1 : appointment.serialLabel}</td>
            <td>
              {appointment.queueConvertedAt ? (
                <><strong><s>{formatDateTime(appointment.startsAt)}</s></strong><span className="apportion-status-helper">Queue {appointment.queuePosition ?? appointment.queueOrder ?? ""}</span></>
              ) : <strong>{formatDateTime(appointment.startsAt)}</strong>}
              {originalTime ? (
                <AppointmentHistory appointment={appointment} contactName={contactName} originalTime={originalTime} formatDateTime={formatDateTime} />
              ) : null}
              <span className="apportion-status-helper">{appointment.scope === "owner" ? "Received" : "Booked"} · {appointment.locationName}: {appointment.locationAddress}</span>
            </td>
            <td>
              <strong>{contactName}</strong>
              <span className="apportion-status-helper">{contactPhone}</span>
            </td>
            <td>
              <button
                aria-label={`View appointment notes and messages for ${contactName}`}
                className="apportion-thread-trigger"
                type="button"
                onClick={() => {
                  setThreadAppointmentId(appointment.id);
                  setThreadMessages(null);
                  setMessageDraft("");
                  setMessageError(null);
                }}
              >
                <MessageSquare aria-hidden="true" size={15} />
                <span>{appointment.messages.length ? `${appointment.messages.length} message${appointment.messages.length === 1 ? "" : "s"}` : appointment.notes ? "View note" : "Open notes"}</span>
              </button>
            </td>
            <td>
              <span className={`status-chip apportion-status-chip is-${appointment.currentStatus}`}>{getStatusLabel(appointment)}</span>
              {getStatusHelper?.(appointment) ? <span className="apportion-status-helper">{getStatusHelper(appointment)}</span> : null}
              {!CLOSED_STATUSES.has(appointment.currentStatus) && (canManage || requesterContext) ? rowActions : null}
              {completion ? <span className="apportion-status-helper">Done {formatDateTime(completion)}</span> : null}
            </td>
          </tr>
        </Fragment>
      );
    });
  }

  function renderPager(label: string, page: number, pageCount: number, setPage: (page: number) => void) {
    if (pageCount < 2) return null;
    return (
      <nav aria-label={`${label} appointment pages`} className="apportion-log-pagination">
        <button aria-label={`Previous ${label.toLowerCase()} appointments`} className="button-secondary small-button" disabled={page === 0} type="button" onClick={() => setPage(page - 1)}><ArrowLeft aria-hidden="true" size={16} /></button>
        <span>{page + 1} / {pageCount}</span>
        <button aria-label={`Next ${label.toLowerCase()} appointments`} className="button-secondary small-button" disabled={page + 1 >= pageCount} type="button" onClick={() => setPage(page + 1)}><ArrowRight aria-hidden="true" size={16} /></button>
      </nav>
    );
  }

  const threadReadOnly = !threadAppointment?.canMessage || CLOSED_STATUSES.has(threadAppointment?.currentStatus ?? "cancelled");

  return (
    <section aria-label="Appointment log" className="apportion-appointment-log">
      <header className="question-head apportion-log-section-head">
        <strong>Active appointments</strong>
        <span className="status-chip">{activeAppointments.length}</span>
        {renderPager("Active", activePage, activePageCount, setActivePage)}
      </header>
      {activeAppointments.length ? (
        <div className="leaderboard-table-wrap apportion-log-table-wrap">
          <table className="leaderboard-table apportion-log-table">
            <thead><tr><th scope="col">S. No.</th><th scope="col">Appointment</th><th scope="col">Contact</th><th scope="col">Notes</th><th scope="col">Status</th></tr></thead>
            <tbody>{renderRows(visibleActive, false)}</tbody>
          </table>
        </div>
      ) : <p className="muted-text">No active appointments.</p>}
      <header className="question-head apportion-log-section-head apportion-log-completed-head">
        <strong>Completed appointments</strong>
        <span className="status-chip">{completedAppointments.length}</span>
        {renderPager("Completed", completedPage, completedPageCount, setCompletedPage)}
      </header>
      {completedAppointments.length ? (
        <div className="leaderboard-table-wrap apportion-log-table-wrap">
          <table className="leaderboard-table apportion-log-table">
            <thead><tr><th scope="col">S. No.</th><th scope="col">Appointment</th><th scope="col">Contact</th><th scope="col">Notes</th><th scope="col">Status</th></tr></thead>
            <tbody>{renderRows(visibleCompleted, true)}</tbody>
          </table>
        </div>
      ) : <p className="muted-text">No completed appointments.</p>}
      {rescheduleEditor}
      {threadAppointment ? createPortal(
        <div className="apportion-thread-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setThreadAppointmentId(null); }}>
          <section aria-labelledby="apportion-thread-title" aria-modal="true" className="apportion-thread-drawer" role="dialog">
            <header className="apportion-thread-header">
              <div><p className="eyebrow">{threadAppointment.locationName} / {threadAppointment.serviceName || "Consultation"}</p><h2 id="apportion-thread-title">Appointment notes</h2><p className="muted-text">{formatDateTime(threadAppointment.startsAt)} · {threadAppointment.scope === "owner" ? threadAppointment.requesterName : threadAppointment.ownerName || "Business"}</p></div>
              <button aria-label="Close appointment notes" className="icon-button apportion-thread-close" type="button" onClick={() => setThreadAppointmentId(null)}><X aria-hidden="true" size={19} /></button>
            </header>
            <div aria-label="Message history" aria-live="polite" className="apportion-thread-body">
              {(threadMessages ?? threadAppointment.messages).length ? (threadMessages ?? threadAppointment.messages).map((message) => {
                const isOwnMessage = Boolean(currentIdentifier && participantIdentifiersMatch(message.authorIdentifier, currentIdentifier));
                const isRequesterMessage = participantIdentifiersMatch(message.authorIdentifier, threadAppointment.requesterIdentifier);
                const authorLabel = isOwnMessage ? "You" : isRequesterMessage ? "Customer" : "Provider/Business";
                return <article className={`apportion-thread-message${isOwnMessage ? " is-outgoing" : " is-incoming"}`} key={message.id}><div><strong>{authorLabel}</strong><time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time></div><p>{message.body}</p></article>;
              }) : threadAppointment.notes ? <article className="apportion-thread-message is-incoming"><div><strong>Booking note</strong><time dateTime={threadAppointment.createdAt}>{formatDateTime(threadAppointment.createdAt)}</time></div><p>{threadAppointment.notes}</p></article> : <p className="muted-text">No notes or messages yet.</p>}
            </div>
            <footer className="apportion-thread-footer">
              {threadReadOnly ? <p className="muted-text">Read only. Messaging is unavailable for this appointment.</p> : <>
                <label htmlFor="apportion-thread-message">Message</label>
                <textarea id="apportion-thread-message" maxLength={2000} rows={3} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} />
                {messageError ? <p className="form-error" role="alert">{messageError}</p> : null}
                <div><span className="muted-text">{messageDraft.length} / 2000</span><button className="button small-button" disabled={!messageDraft.trim() || isSending} type="button" onClick={() => void sendMessage()}>{isSending ? "Sending..." : "Send message"}</button></div>
              </>}
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}

function completionTime(appointment: ApportionLogAppointment) {
  if (appointment.currentStatus === "done") {
    const doneEntry = [...appointment.history].reverse().find((entry) => entry.action === "done");
    if (doneEntry) return new Date(doneEntry.at).getTime();
  }
  return new Date(appointment.statusUpdatedAt).getTime();
}
