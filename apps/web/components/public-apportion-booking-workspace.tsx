"use client";

import { useEffect, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";

type BookingPayload = {
  business: {
    appointmentsPerSlot: number;
    imageDataUrl: string | null;
    name: string;
    workingDays: string;
    workingHours: string;
  };
  slotCounts: Array<{ count: number; startsAt: string }>;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

function toDateTimeInputValue(value: Date) {
  const offsetMs = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

type PublicApportionBookingWorkspaceProps = {
  shareCode: string;
};

export function PublicApportionBookingWorkspace({ shareCode }: PublicApportionBookingWorkspaceProps) {
  const [appointmentDateTime, setAppointmentDateTime] = useState(toDateTimeInputValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [payload, setPayload] = useState<BookingPayload | null>(null);

  async function loadBookingPage() {
    setIsLoading(true);

    try {
      const nextPayload = await readJson<BookingPayload>(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}`),
      );
      setPayload(nextPayload);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load this booking page.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadBookingPage();
  }, [shareCode]);

  async function handleBookAppointment() {
    if (!appointmentDateTime) {
      setFeedback("Choose an appointment date and time.");
      return;
    }

    setIsBooking(true);

    try {
      await readJson(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}`, {
          body: JSON.stringify({
            notes,
            startsAt: new Date(appointmentDateTime).toISOString(),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setFeedback("Appointment booked. You can see it in the Apportion tab on your dashboard.");
      setNotes("");
      await loadBookingPage();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to book the appointment.");
    } finally {
      setIsBooking(false);
    }
  }

  if (isLoading) {
    return <div className="empty-state"><p className="muted-text">Loading appointment page...</p></div>;
  }

  if (!payload) {
    return <div className="empty-state"><p className="muted-text">{feedback ?? "Unable to load this appointment page."}</p></div>;
  }

  return (
    <div className="workspace-card-stack">
      <section className="workspace-card apportion-booking-hero">
        {payload.business.imageDataUrl ? (
          <img alt="Business logo" className="branding-preview-image" src={payload.business.imageDataUrl} />
        ) : null}
        <div>
          <p className="eyebrow">Apportion booking</p>
          <h1>{payload.business.name || "Business appointment"}</h1>
          <p className="muted-text">Working days: {payload.business.workingDays || "Not specified"}</p>
          <p className="muted-text">Working hours: {payload.business.workingHours || "Not specified"}</p>
          <p className="muted-text">Appointments per slot: {payload.business.appointmentsPerSlot}</p>
        </div>
      </section>

      <section className="workspace-card">
        <p className="eyebrow">Choose appointment</p>
        <div className="form-stack">
          <div className="field">
            <label htmlFor="apportion-appointment-time">Day and time</label>
            <input
              id="apportion-appointment-time"
              min={toDateTimeInputValue(new Date())}
              type="datetime-local"
              value={appointmentDateTime}
              onChange={(event) => setAppointmentDateTime(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="apportion-notes">Notes</label>
            <textarea
              id="apportion-notes"
              placeholder="Reason for appointment"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {feedback ? <p className="muted-text">{feedback}</p> : null}
          <div className="inline-actions">
            <button className="button" disabled={isBooking} type="button" onClick={() => void handleBookAppointment()}>
              {isBooking ? "Booking..." : "Book appointment"}
            </button>
            <a className="button-secondary" href="/user?tab=apportion">Open Apportion dashboard</a>
          </div>
        </div>
      </section>

      <section className="workspace-card">
        <p className="eyebrow">Booked slots</p>
        {payload.slotCounts.length ? (
          <div className="notification-panel-list">
            {payload.slotCounts.map((slot) => (
              <div className="notification-panel-item" key={slot.startsAt}>
                <span>{formatShortDateTime(slot.startsAt)}</span>
                <strong>{slot.count}/{payload.business.appointmentsPerSlot}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-text">No booked slots yet.</p>
        )}
      </section>
    </div>
  );
}