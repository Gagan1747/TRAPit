"use client";

import { useEffect, useRef, useState } from "react";
import { matchApportionIdentity, participantIdentifiersMatch, type ApportionRecurrence } from "@trapit/testing";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, MessageSquare, X } from "lucide-react";
import type { ApportionInvitation as StoredInvitation } from "../lib/apportion-store";

export type ApportionInvitation = Omit<StoredInvitation, "notifications" | "bookedSettings">;
type LogRow = { kind: "appointment"; entry: ApportionLogAppointment } | { kind: "invitation"; entry: ApportionInvitation };

type AppointmentStatus = "cancelled" | "delayed" | "done" | "missed" | "pending" | "present-in-person" | "pushed-back" | "rejected";
type HistoryEntry = {
  action: "booked" | "cancelled" | "delayed" | "slot-restored" | "done" | "missed" | "present-in-person" | "pushed-back" | "rejected" | "rescheduled" | "address-opt-out";
  actorIdentifier: string;
  at: string;
  fromStartsAt: string | null;
  note: string | null;
  toStartsAt: string | null;
};
type AppointmentMessage = { id: string; authorIdentifier: string; createdAt: string; body: string };

export type ApportionLogAppointment = {
  sourceInvitationId?: string;
  hasUnreadMessages?: boolean;
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
  invitations?: ApportionInvitation[];
  currentIdentifier: string | null;
  initialAppointmentId?: string;
  isActive: (status: AppointmentStatus) => boolean;
  isRequester: (appointment: ApportionLogAppointment) => boolean;
  formatDateTime: (value: string) => string;
  getStatusLabel: (appointment: ApportionLogAppointment) => string;
  getStatusHelper?: (appointment: ApportionLogAppointment) => string | null;
  onAction: (action: AppointmentUpdate) => Promise<void | string>;
  onCancel: (appointmentId: string) => Promise<void | string>;
  onRefresh: () => void | Promise<void>;
  isUpdating: boolean;
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
    case "delayed": return "Delayed";
    case "slot-restored": return "Slot restored";
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

function rowTime(row: LogRow) {
  return row.kind === "appointment" ? row.entry.startsAt : row.entry.occurrences[0]?.startsAt ?? row.entry.createdAt;
}

function mergeActiveRows(rows: LogRow[]) {
  const owners: string[] = [];
  const streams = new Map<string, LogRow[]>();
  for (const row of rows) {
    const entry = row.entry;
    let owner = owners.find((identifier) => matchApportionIdentity(identifier, entry.ownerIdentifier));
    if (!owner) { owner = entry.ownerIdentifier; owners.push(owner); }
    const key = row.kind === "appointment" && row.entry.justAddToList
      ? `${owner}::${entry.locationId}::${entry.serviceId || "consultation"}::${row.entry.serviceDateKey}` : `${row.kind}::${entry.id}`;
    const stream = streams.get(key) ?? [];
    stream.push(row);
    streams.set(key, stream);
  }
  for (const stream of streams.values()) stream.sort((left, right) => left.kind === "appointment" && right.kind === "appointment"
    ? (left.entry.queueOrder ?? left.entry.queuePosition ?? 0) - (right.entry.queueOrder ?? right.entry.queuePosition ?? 0) || left.entry.id.localeCompare(right.entry.id) : left.entry.id.localeCompare(right.entry.id));
  const result: LogRow[] = [];
  const positions = Array.from(streams.values()).map((stream) => ({ stream, index: 0 }));
  while (positions.some((position) => position.index < position.stream.length)) {
    const next = positions.filter((position) => position.index < position.stream.length).sort((left, right) => rowTime(left.stream[left.index]).localeCompare(rowTime(right.stream[right.index])) || left.stream[left.index].entry.id.localeCompare(right.stream[right.index].entry.id))[0];
    result.push(next.stream[next.index++]);
  }
  return result;
}

function recurrenceLabel(recurrence: ApportionRecurrence | null | undefined) {
  if (!recurrence) return "";
  const frequency = recurrence.mode === "weekly" ? "Weekly" : "Monthly";
  return recurrence.durationCount ? `${frequency} · ${recurrence.durationCount} ${recurrence.mode === "weekly" ? "weeks" : "months"}` : `${frequency} · through ${recurrence.endDateKey}`;
}

function tableDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })}, ${date.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

export function ApportionAppointmentLog({
  appointments,
  invitations = [],
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
  isUpdating,
}: ApportionAppointmentLogProps) {
  const [now, setNow] = useState(() => Date.now());
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [invitationAction, setInvitationAction] = useState<"accept" | "decline" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noteInvitationId, setNoteInvitationId] = useState<string | null>(null);
  const actionPendingRef = useRef(false);
  const acknowledgedRef = useRef(new Set<string>());
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const threadRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const refresh = () => { setNow(Date.now()); void refreshRef.current(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
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

  const rows: LogRow[] = [
    ...appointments.map((entry): LogRow => ({ kind: "appointment", entry })),
    ...invitations.filter((entry) => entry.status !== "accepted" && currentIdentifier && (matchApportionIdentity(entry.ownerIdentifier, currentIdentifier) || matchApportionIdentity(entry.requesterIdentifier, currentIdentifier))).map((entry): LogRow => ({ kind: "invitation", entry: entry.status === "pending" && new Date(entry.expiresAt).getTime() <= now ? { ...entry, status: "expired", statusUpdatedAt: entry.expiresAt } : entry })),
  ];
  const activeAppointments = mergeActiveRows(rows.filter((row) => row.kind === "appointment" ? isActive(row.entry.currentStatus) : row.entry.status === "pending"));
  const completedAppointments = rows.filter((row) => row.kind === "appointment" ? !isActive(row.entry.currentStatus) : row.entry.status !== "pending").sort((left, right) => (right.kind === "appointment" ? completionTime(right.entry) : new Date(right.entry.statusUpdatedAt).getTime()) - (left.kind === "appointment" ? completionTime(left.entry) : new Date(left.entry.statusUpdatedAt).getTime()) || left.entry.id.localeCompare(right.entry.id));
  const activePageCount = Math.max(1, Math.ceil(activeAppointments.length / PAGE_SIZE));
  const completedPageCount = Math.max(1, Math.ceil(completedAppointments.length / PAGE_SIZE));
  const visibleActive = activeAppointments.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
  const visibleCompleted = completedAppointments.slice(completedPage * PAGE_SIZE, (completedPage + 1) * PAGE_SIZE);

  useEffect(() => setActivePage((page) => Math.min(page, activePageCount - 1)), [activePageCount]);
  useEffect(() => setCompletedPage((page) => Math.min(page, completedPageCount - 1)), [completedPageCount]);

  useEffect(() => {
    const targetId = initialAppointmentId || new URLSearchParams(window.location.search).get("invitationId");
    if (!targetId || focusedTicketRef.current === targetId) return;
    const activeIndex = activeAppointments.findIndex((row) => row.entry.id === targetId);
    if (activeIndex >= 0) {
      setActivePage(Math.floor(activeIndex / PAGE_SIZE));
      return;
    }
    const completedIndex = completedAppointments.findIndex((row) => row.entry.id === targetId);
    if (completedIndex >= 0) setCompletedPage(Math.floor(completedIndex / PAGE_SIZE));
  }, [activeAppointments, completedAppointments, initialAppointmentId]);

  useEffect(() => {
    const targetId = initialAppointmentId || new URLSearchParams(window.location.search).get("invitationId");
    if (!targetId || focusedTicketRef.current === targetId) return;
    const ticket = document.getElementById(`apportion-appointment-${targetId}`) || document.getElementById(`apportion-invitation-${targetId}`);
    if (!ticket) return;
    focusedTicketRef.current = targetId;
    ticket.scrollIntoView({ behavior: "smooth", block: "center" });
    ticket.focus({ preventScroll: true });
  }, [activePage, appointments, invitations, completedPage, initialAppointmentId]);

  useEffect(() => {
    if (!threadAppointmentId && !noteInvitationId) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setThreadAppointmentId(null); setNoteInvitationId(null); }
      if (event.key === "Tab") {
        const controls = Array.from(threadRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled), a[href]") ?? []);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    threadRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [threadAppointmentId, noteInvitationId]);

  const displayedLastMessageId = (threadMessages ?? threadAppointment?.messages)?.at(-1)?.id;
  useEffect(() => {
    if (!threadAppointmentId || !displayedLastMessageId) return;
    const key = `${threadAppointmentId}::${displayedLastMessageId}`;
    if (acknowledgedRef.current.has(key)) return;
    acknowledgedRef.current.add(key);
    void fetch("/api/user/apportion", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark-read", appointmentId: threadAppointmentId, lastMessageId: displayedLastMessageId }) }).then(async (response) => {
      if (!response.ok) throw new Error("Unable to mark messages read.");
      await refreshRef.current();
    }).catch(() => acknowledgedRef.current.delete(key));
  }, [threadAppointmentId, displayedLastMessageId]);

  async function actOnInvitation(entry: ApportionInvitation, action: "accept" | "decline" | "cancel") {
    if (actionPendingRef.current || isUpdating || !currentIdentifier || entry.status !== "pending" || new Date(entry.expiresAt).getTime() <= Date.now()) return;
    if (!matchApportionIdentity(action === "cancel" ? entry.ownerIdentifier : entry.requesterIdentifier, currentIdentifier)) return;
    actionPendingRef.current = true;
    setUpdatingId(entry.id);
    setInvitationAction(action);
    setActionError(null);
    try {
      const response = await fetch("/api/user/apportion/invitations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationId: entry.id, action }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to update invitation.");
      await onRefresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : "Unable to update invitation."); }
    finally { actionPendingRef.current = false; setUpdatingId(null); setInvitationAction(null); }
  }

  async function actOnAppointment(entry: ApportionLogAppointment, action: "done" | "reject" | "cancel") {
    if (actionPendingRef.current || isUpdating) return;
    document.getElementById(`apportion-actions-${entry.id}`)?.removeAttribute("open");
    actionPendingRef.current = true;
    setUpdatingId(entry.id);
    setActionError(null);
    try {
      const result = await (action === "cancel" ? onCancel(entry.id) : onAction({ appointmentId: entry.id, action }));
      if (typeof result === "string") throw new Error(result);
    } catch (error) { setActionError(error instanceof Error ? error.message : "Unable to update appointment."); }
    finally { actionPendingRef.current = false; setUpdatingId(null); }
  }

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

  function renderRows(visibleRows: LogRow[], completed: boolean) {
    return visibleRows.map((row, index) => {
      const serial = (completed ? completedPage : activePage) * PAGE_SIZE + index + 1;
      if (row.kind === "invitation") {
        const invitation = row.entry;
        const incoming = Boolean(currentIdentifier && matchApportionIdentity(invitation.requesterIdentifier, currentIdentifier));
        const contactName = incoming ? invitation.ownerName || "Business" : invitation.requesterName;
        return <tr className="apportion-log-row" id={`apportion-invitation-${invitation.id}`} key={invitation.id} tabIndex={-1}>
          <td><span className={`apportion-origin ${incoming ? "is-invite-incoming" : "is-invite-outgoing"}`} title={incoming ? "Incoming invitation" : "Outgoing invitation"}>{serial}</span></td>
          <td><strong>{tableDateTime(invitation.occurrences[0]?.startsAt ?? invitation.createdAt)}</strong><span className="apportion-status-helper">{invitation.serviceName} · {invitation.locationAddress}</span><details className="apportion-series-summary"><summary>{recurrenceLabel(invitation.recurrence) || "Once"} · {invitation.occurrences.length} appointment{invitation.occurrences.length === 1 ? "" : "s"}</summary><ul>{invitation.occurrences.map((occurrence) => <li key={occurrence.serviceDateKey}>{tableDateTime(occurrence.startsAt)}</li>)}</ul></details></td>
          <td><strong>{contactName}</strong><span className="apportion-status-helper">{incoming ? invitation.ownerIdentifier : invitation.requesterPhone || invitation.requesterIdentifier}</span></td>
          <td><button className="apportion-thread-trigger" type="button" aria-label={`View invitation note for ${contactName}`} onClick={() => setNoteInvitationId(invitation.id)}><MessageSquare aria-hidden="true" size={15} /><span>{invitation.notes || "Open notes"}</span></button></td>
          <td><span className={`status-chip apportion-status-chip is-${invitation.status}`}>{invitation.status === "pending" ? incoming ? "Pending invitation" : "Pending Acceptance" : invitation.status.charAt(0).toUpperCase() + invitation.status.slice(1)}</span>
            {invitation.status === "pending" ? <div className="inline-actions apportion-invitation-actions">
              {incoming ? <><button className="button small-button" disabled={!!updatingId || isUpdating} type="button" onClick={() => void actOnInvitation(invitation, "accept")}>{updatingId === invitation.id && invitationAction === "accept" ? <LoaderCircle className="apportion-spinner" size={16} /> : <Check size={16} />}Accept</button><button className="button-secondary small-button" disabled={!!updatingId || isUpdating} type="button" onClick={() => void actOnInvitation(invitation, "decline")}>{updatingId === invitation.id && invitationAction === "decline" ? <LoaderCircle className="apportion-spinner" size={16} /> : <X size={16} />}Decline</button></> : <button className="button-secondary small-button" disabled={!!updatingId || isUpdating} type="button" onClick={() => void actOnInvitation(invitation, "cancel")}>{updatingId === invitation.id ? <LoaderCircle className="apportion-spinner" size={16} /> : <X size={16} />}Cancel</button>}
            </div> : null}</td>
        </tr>;
      }
      const appointment = row.entry;
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
            {canManage && active ? <button className="button-secondary small-button" disabled={isUpdating || !!updatingId} type="button" onClick={() => void actOnAppointment(appointment, "done")}>Done</button> : null}
            {canManage && active && appointment.justAddToList ? <button className="button-secondary small-button" disabled={isUpdating || !!updatingId} type="button" onClick={() => void actOnAppointment(appointment, "reject")}>Absent</button> : null}
            {requesterContext && active ? <button className="button-secondary small-button" disabled={isUpdating || !!updatingId} type="button" onClick={() => void actOnAppointment(appointment, "cancel")}>Cancel</button> : null}
          </div>
        </details>
      );

      return (
          <tr
            className={`apportion-log-row${appointment.id === initialAppointmentId ? " is-ticket-focus" : ""}`}
            data-apportion-appointment-id={appointment.id}
            id={`apportion-appointment-${appointment.id}`}
            key={appointment.id}
            tabIndex={appointment.id === initialAppointmentId ? -1 : undefined}
          >
            <td><span className={`apportion-origin${appointment.sourceInvitationId ? requesterContext ? " is-invite-incoming" : " is-invite-outgoing" : requesterContext ? " is-direct-sent" : ""}`} title={appointment.sourceInvitationId ? requesterContext ? "Accepted incoming invitation" : "Accepted outgoing invitation" : requesterContext ? "Sent appointment" : "Received appointment"}>{serial}</span></td>
            <td>
              {appointment.queueConvertedAt ? (
                <><strong><s>{tableDateTime(appointment.startsAt)}</s></strong><span className="apportion-status-helper">Queue {appointment.queuePosition ?? appointment.queueOrder ?? ""}</span></>
              ) : <strong>{tableDateTime(appointment.startsAt)}</strong>}
              {originalTime ? (
                <AppointmentHistory appointment={appointment} contactName={contactName} originalTime={originalTime} formatDateTime={formatDateTime} />
              ) : null}
              <span className="apportion-status-helper">{appointment.serviceName || "Consultation"} · {appointment.locationAddress}</span>
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
                <span>{appointment.messages.at(-1)?.body || appointment.notes || "Open notes"}</span>
                {appointment.hasUnreadMessages ? <span className="apportion-unread-dot" aria-label="Unread incoming messages" /> : null}
              </button>
            </td>
            <td>
              <span className={`status-chip apportion-status-chip is-${appointment.currentStatus}`}>{getStatusLabel(appointment)}</span>
              {getStatusHelper?.(appointment) ? <span className="apportion-status-helper">{getStatusHelper(appointment)}</span> : null}
              {!CLOSED_STATUSES.has(appointment.currentStatus) && (canManage || requesterContext) ? rowActions : null}
              {updatingId === appointment.id ? <LoaderCircle aria-label="Updating appointment" className="apportion-spinner" size={16} /> : null}
              {completion ? <span className="apportion-status-helper">Done {formatDateTime(completion)}</span> : null}
            </td>
          </tr>
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
  const noteInvitation = invitations.find((entry) => entry.id === noteInvitationId);

  return (
    <section aria-label="Appointment log" className="apportion-appointment-log">
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
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
      {noteInvitation ? createPortal(<div className="apportion-thread-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setNoteInvitationId(null); }}><section ref={threadRef} aria-labelledby="apportion-invitation-note-title" aria-modal="true" className="apportion-thread-drawer" role="dialog"><header className="apportion-thread-header"><h2 id="apportion-invitation-note-title">Invitation note</h2><button className="icon-button" aria-label="Close invitation note" type="button" onClick={() => setNoteInvitationId(null)}><X size={18} /></button></header><div className="apportion-thread-body"><p>{noteInvitation.notes || "No note."}</p></div></section></div>, document.body) : null}
      {threadAppointment ? createPortal(
        <div className="apportion-thread-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setThreadAppointmentId(null); }}>
          <section ref={threadRef} aria-labelledby="apportion-thread-title" aria-modal="true" className="apportion-thread-drawer" role="dialog">
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
                <div><span className="muted-text">{messageDraft.length} / 2000</span><button className="button small-button" disabled={!messageDraft.trim() || isSending} type="button" onClick={() => void sendMessage()}>{isSending ? <LoaderCircle aria-hidden="true" className="apportion-spinner" size={16} /> : null}{isSending ? "Sending..." : "Send message"}</button></div>
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
