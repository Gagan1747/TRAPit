"use client";

import { useEffect, useRef, useState } from "react";
import { matchApportionIdentity } from "@trapit/testing";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";

import { formatPhoneNumberForDisplay } from "../lib/privacy";

export type ApportionInvitation = {
  id: string;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  creatorIdentifier: string;
  ownerIdentifier: string;
  ownerName: string | null;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone?: string | null;
  locationId: string;
  locationName: string;
  locationAddress: string;
  serviceId: string;
  serviceName: string;
  notes: string | null;
  createdAt: string;
  statusUpdatedAt: string;
  expiresAt: string;
  occurrences: Array<{ serviceDateKey: string; startsAt: string; slotEndsAt: string }>;
  appointmentIds: string[];
};

type Props = {
  invitations: ApportionInvitation[];
  currentIdentifier: string | null;
  formatDateTime: (value: string) => string;
  onRefresh: () => void | Promise<void>;
};

const PAGE_SIZE = 6;

export function ApportionInvitationLog({ invitations, currentIdentifier, formatDateTime, onRefresh }: Props) {
  const [pendingPage, setPendingPage] = useState(0);
  const [completedPage, setCompletedPage] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, ApportionInvitation["status"]>>({});
  const [now, setNow] = useState(Date.now());
  const pendingRef = useRef(false);
  const focusedRef = useRef<string | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => setLocalStatuses({}), [invitations]);

  const entries = invitations.filter((entry) => currentIdentifier && (
    matchApportionIdentity(entry.ownerIdentifier, currentIdentifier)
    || matchApportionIdentity(entry.requesterIdentifier, currentIdentifier)
  )).map((entry) => {
    const expired = entry.status === "pending" && new Date(entry.expiresAt).getTime() <= now;
    return { ...entry, status: localStatuses[entry.id] ?? (expired ? "expired" : entry.status), statusUpdatedAt: expired ? entry.expiresAt : entry.statusUpdatedAt };
  });
  const pending = entries.filter((entry) => entry.status === "pending").sort((first, second) => first.expiresAt.localeCompare(second.expiresAt));
  const completed = entries.filter((entry) => entry.status !== "pending" && entry.status !== "accepted").sort((first, second) => second.statusUpdatedAt.localeCompare(first.statusUpdatedAt));
  const pendingPages = Math.max(1, Math.ceil(pending.length / PAGE_SIZE));
  const completedPages = Math.max(1, Math.ceil(completed.length / PAGE_SIZE));
  useEffect(() => setPendingPage((page) => Math.min(page, pendingPages - 1)), [pendingPages]);
  useEffect(() => setCompletedPage((page) => Math.min(page, completedPages - 1)), [completedPages]);

  useEffect(() => {
    const invitationId = new URLSearchParams(window.location.search).get("invitationId");
    if (!invitationId || focusedRef.current === invitationId) return;
    const pendingIndex = pending.findIndex((entry) => entry.id === invitationId);
    const completedIndex = completed.findIndex((entry) => entry.id === invitationId);
    if (pendingIndex >= 0) setPendingPage(Math.floor(pendingIndex / PAGE_SIZE));
    if (completedIndex >= 0) setCompletedPage(Math.floor(completedIndex / PAGE_SIZE));
    const row = document.getElementById(`apportion-invitation-${invitationId}`);
    if (row) { focusedRef.current = invitationId; row.scrollIntoView({ block: "center" }); row.focus({ preventScroll: true }); }
  }, [pending, completed, pendingPage, completedPage]);

  async function act(entry: ApportionInvitation, action: "accept" | "decline" | "cancel") {
    if (pendingRef.current || entry.status !== "pending" || !currentIdentifier || new Date(entry.expiresAt).getTime() <= Date.now()) return;
    const allowed = action === "cancel" ? matchApportionIdentity(entry.ownerIdentifier, currentIdentifier) : matchApportionIdentity(entry.requesterIdentifier, currentIdentifier);
    if (!allowed) return;
    pendingRef.current = true;
    setUpdatingId(entry.id);
    setFeedback(null);
    try {
      const response = await fetch("/api/user/apportion/invitations", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationId: entry.id, action }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to update invitation.");
      setLocalStatuses((statuses) => ({ ...statuses, [entry.id]: action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled" }));
      setFeedback(action === "accept" ? "Invitation accepted." : action === "decline" ? "Invitation declined." : "Invitation cancelled.");
      await onRefresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to update invitation.");
    } finally {
      pendingRef.current = false;
      setUpdatingId(null);
    }
  }

  function renderList(list: ApportionInvitation[], page: number, pages: number, setPage: (page: number) => void, title: string) {
    return <div className="apportion-invitation-list">
      <div className="apportion-invitation-list-head">
        <h3>{title} <span className="muted-text">({list.length})</span></h3>
        <div className="apportion-log-pagination">
          <button aria-label={`Previous ${title.toLowerCase()}`} className="icon-button button-secondary" disabled={!page} type="button" onClick={() => setPage(page - 1)}><ArrowLeft aria-hidden="true" size={18} /></button>
          <span>{page + 1} / {pages}</span>
          <button aria-label={`Next ${title.toLowerCase()}`} className="icon-button button-secondary" disabled={page + 1 >= pages} type="button" onClick={() => setPage(page + 1)}><ArrowRight aria-hidden="true" size={18} /></button>
        </div>
      </div>
      {list.length ? <div className="apportion-invitation-table-wrap"><table className="apportion-invitation-table">
        <thead><tr><th scope="col">Appointment</th><th scope="col">Contact</th><th scope="col">Notes</th><th scope="col">Status</th></tr></thead>
        <tbody>{list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((entry) => {
          const outgoing = Boolean(currentIdentifier && matchApportionIdentity(entry.ownerIdentifier, currentIdentifier));
          const incoming = Boolean(currentIdentifier && matchApportionIdentity(entry.requesterIdentifier, currentIdentifier));
          const phone = formatPhoneNumberForDisplay(outgoing ? entry.requesterPhone || entry.requesterIdentifier : entry.ownerIdentifier, { showFullPhoneNumber: true });
          return <tr id={`apportion-invitation-${entry.id}`} key={entry.id} tabIndex={-1}>
            <td data-label="Appointment"><strong>{entry.serviceName}</strong><span>{entry.locationName}</span><span>{entry.locationAddress}</span>
              {entry.occurrences[0] ? <time dateTime={entry.occurrences[0].startsAt}>{formatDateTime(entry.occurrences[0].startsAt)}</time> : null}
              <details><summary>{entry.occurrences.length} appointment{entry.occurrences.length === 1 ? "" : "s"}</summary><ul>{entry.occurrences.map((occurrence) => <li key={`${occurrence.serviceDateKey}::${occurrence.startsAt}`}><time dateTime={occurrence.startsAt}>{formatDateTime(occurrence.startsAt)}</time></li>)}</ul></details>
            </td>
            <td data-label="Contact"><strong>{outgoing ? entry.requesterName : entry.ownerName}</strong><span>{phone}</span></td>
            <td data-label="Notes">{entry.notes || "-"}</td>
            <td data-label="Status"><strong>{entry.status === "pending" ? outgoing ? "Pending Acceptance" : "Pending invitation" : entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}</strong>
              {entry.status === "pending" ? <><span>Expires <time dateTime={entry.expiresAt}>{formatDateTime(entry.expiresAt)}</time></span>
                <div className="inline-actions apportion-invitation-actions">
                  {incoming ? <><button className="button small-button" disabled={updatingId !== null} type="button" onClick={() => void act(entry, "accept")}><Check aria-hidden="true" size={16} />Accept</button><button className="button-secondary small-button" disabled={updatingId !== null} type="button" onClick={() => void act(entry, "decline")}><X aria-hidden="true" size={16} />Decline</button></> : null}
                  {outgoing ? <button className="button-secondary small-button" disabled={updatingId !== null} type="button" onClick={() => void act(entry, "cancel")}><X aria-hidden="true" size={16} />Cancel</button> : null}
                  {updatingId === entry.id ? <span role="status">Updating...</span> : null}
                </div>
              </> : <time dateTime={entry.statusUpdatedAt}>{formatDateTime(entry.statusUpdatedAt)}</time>}
            </td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="muted-text">No {title.toLowerCase()}.</p>}
    </div>;
  }

  return <section aria-labelledby="apportion-invitation-heading" className="apportion-invitation-log">
    <h2 id="apportion-invitation-heading">Invitations</h2>
    {feedback ? <p className="muted-text" role="status">{feedback}</p> : null}
    {renderList(pending, pendingPage, pendingPages, setPendingPage, "Pending invitations")}
    {renderList(completed, completedPage, completedPages, setCompletedPage, "Completed invitations")}
  </section>;
}