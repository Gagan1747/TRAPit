"use client";

import { APPORTION_NEW_DURATION_MINUTES, getApportionBookableServices, getApportionServiceLimit, getApportionWeeklyIntervals, participantIdentifiersMatch, resolveApportionDailySchedule, type AppointmentLocation, type ApportionDailyHours, type ApportionProviderSettings, type ApportionService, type ApportionWeeklyInterval } from "@trapit/testing";
import { ChevronLeft, ChevronRight, Plus, Save, Search, Unlink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApportionPanelInput, getApportionPanel } from "../lib/apportion-directory";
import { BusinessHoursGrid } from "./business-hours-grid";

type Panel = Omit<Awaited<ReturnType<typeof getApportionPanel>>, "canCreateBusiness"> & { canCreateBusiness?: boolean };
type Business = Panel["businesses"][number];
type Membership = Panel["memberships"][number];
type SaveOperation = (input: ApportionPanelInput) => Promise<void>;

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Unable to update Business Panel.");
  return payload;
}

function RegisteredPhone({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [match, setMatch] = useState<{ identifier: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => { setMatch(null); setError(null); }, [value]);
  async function lookup() {
    setSearching(true);
    setError(null);
    try {
      const result = await readResponse<{ user: { identifier: string; name: string } }>(await fetch(`/api/user/apportion?lookupPhone=${encodeURIComponent(value)}`));
      setMatch(result.user);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to find user.");
    } finally { setSearching(false); }
  }
  return <div>
    <div className="button-row">
      <input aria-label="Registered phone number" type="tel" value={value} disabled={disabled || searching} onChange={(event) => onChange(event.target.value)} />
      {!disabled ? <button aria-label="Find registered user" title="Find registered user" className="button-secondary icon-button" type="button" disabled={searching || !value.trim()} onClick={() => void lookup()}><Search size={18} /></button> : null}
    </div>
    {match ? <p className="muted-text">User Name: {match.name}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

function ServiceRow({ business, service, draft, setDraft, locationId, busy, save }: { business: Business; service: ApportionService; draft: ApportionService; setDraft: (value: ApportionService) => void; locationId: string; busy: boolean; save: SaveOperation }) {
  const consultation = service.id === "consultation";
  const enabled = business.role !== "staff" && getApportionServiceLimit(business.ownerCategory) > 0;
  return <fieldset disabled={busy || !enabled} className="workspace-card-stack">
    <label>Service<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Active</label>
    <label>Assigned staff</label>
    <RegisteredPhone disabled={consultation || !enabled} value={draft.assignedIdentifier || ""} onChange={(value) => setDraft({ ...draft, assignedIdentifier: value.trim() || null })} />
    <div className="button-row">
      {(business.branding.appointmentLocations ?? []).map((location) => {
        const providerIdentifier = service.assignedIdentifier || business.business.ownerIdentifier;
        const membership = business.memberships.find((entry) => entry.locationId === location.id && participantIdentifiersMatch(entry.providerIdentifier, providerIdentifier));
        const schedule = resolveApportionDailySchedule(membership ?? location);
        return <div className="apportion-service-location" key={location.id}>
          <label><input type="checkbox" checked={draft.locationIds.includes(location.id)} onChange={(event) => setDraft({ ...draft, locationIds: event.target.checked ? [...draft.locationIds, location.id] : draft.locationIds.filter((id) => id !== location.id) })} /> {location.address}</label>
          {location.id === locationId && service.assignedIdentifier && !participantIdentifiersMatch(service.assignedIdentifier, business.business.ownerIdentifier) ? <span className="muted-text">{schedule.filter((entry) => entry.workingHours || entry.workingHoursSecondWindow).map((entry) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][entry.weekday]} ${[entry.workingHours, entry.workingHoursSecondWindow].filter(Boolean).join(" / ")}`).join(" · ") || "No provider hours set"}</span> : null}
        </div>;
      })}
    </div>
    <span className="status-chip">{getApportionBookableServices(business.business, business.ownerCategory, locationId).some((entry) => entry.id === service.id) ? "Bookable" : service.active ? "Paused" : "Inactive"}</span>
    {enabled ? <button className="button-secondary" type="button" onClick={() => void save({ operation: "set-service", ownerIdentifier: business.business.ownerIdentifier, service: draft })}><Save size={16} /> Save service</button> : null}
  </fieldset>;
}

function BusinessRoles({ business, save, busy }: { business: Business; save: SaveOperation; busy: boolean }) {
  const [delegate, setDelegate] = useState(business.business.adminDelegateIdentifier || "");
  const [branding, setBranding] = useState(business.branding);
  const [drafts, setDrafts] = useState(() => Object.fromEntries(business.business.services.map((service) => [service.id, service])));
  useEffect(() => { setDrafts(Object.fromEntries(business.business.services.map((service) => [service.id, service]))); }, [business.business.services]);
  useEffect(() => { setDelegate(business.business.adminDelegateIdentifier || ""); setBranding(business.branding); }, [business]);
  const canEdit = business.role !== "staff" && getApportionServiceLimit(business.ownerCategory) > 0;
  return <section className="workspace-card-stack">
    <h3>{business.branding.instituteName || "Business"} <span className="status-chip">{business.role}</span></h3>
    {business.role === "owner" ? <fieldset disabled={busy}>
      <label>Admin phone</label>
      <RegisteredPhone value={delegate} onChange={setDelegate} />
      <button className="button-secondary" type="button" onClick={() => void save({ operation: "set-delegate", ownerIdentifier: business.business.ownerIdentifier, delegateIdentifier: delegate.trim() || null })}><Save size={16} /> Save Admin</button>
    </fieldset> : null}
    {(business.branding.appointmentLocations ?? []).map((location, index) => {
      const activeCount = business.business.services.filter((service) => service.active && service.locationIds.includes(location.id)).length;
      const services = business.business.services.filter((service) => service.locationIds.includes(location.id) || (!service.locationIds.length && index === 0));
      return <section className="apportion-address-services" key={location.id}>
        <header><h4>{location.address}</h4><span>{activeCount} / {getApportionServiceLimit(business.ownerCategory)} active services</span></header>
        {services.map((service) => <ServiceRow key={service.id} business={business} service={service} draft={drafts[service.id] ?? service} setDraft={(value) => setDrafts((current) => ({ ...current, [service.id]: value }))} locationId={location.id} busy={busy} save={save} />)}
        {canEdit ? <button className="button-secondary" type="button" disabled={busy || activeCount >= getApportionServiceLimit(business.ownerCategory)} onClick={() => void save({ operation: "set-service", ownerIdentifier: business.business.ownerIdentifier, service: { id: `service-${crypto.randomUUID()}`, name: "New service", active: false, assignedIdentifier: null, locationIds: [location.id] } })}><Plus size={16} /> Add service</button> : null}
      </section>;
    })}
    {business.role === "admin" && canEdit ? <fieldset disabled={busy} className="workspace-card-stack">
      <label>Business name<input value={branding.instituteName} onChange={(event) => setBranding({ ...branding, instituteName: event.target.value })} /></label>
      {(branding.appointmentLocations ?? []).map((location) => <div key={location.id}>
        <label>Address<input value={location.address} onChange={(event) => setBranding({ ...branding, appointmentLocations: branding.appointmentLocations?.map((entry) => entry.id === location.id ? { ...entry, address: event.target.value } : entry) })} /></label>
      </div>)}
      <button className="button-secondary" type="button" onClick={() => void save({ operation: "business-branding", ownerIdentifier: business.business.ownerIdentifier, branding })}><Save size={16} /> Save business</button>
    </fieldset> : null}
  </section>;
}

const SCHEDULE_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getWeeklyIntervals(dailyHours: ApportionDailyHours[]) {
  return getApportionWeeklyIntervals({ dailyHours });
}

function ProviderScheduleEditor({
  dailyHours,
  blockedWeeklyIntervals,
  masterDailyHours,
  masterWeeklyIntervals,
  onDayToggle,
  onHoursChange,
}: {
  dailyHours: ApportionDailyHours[];
  blockedWeeklyIntervals: ApportionWeeklyInterval[];
  masterDailyHours: ApportionDailyHours[];
  masterWeeklyIntervals: ApportionWeeklyInterval[];
  onDayToggle: (weekday: number, enabled: boolean) => void;
  onHoursChange: (weekday: number, field: "workingHours" | "workingHoursSecondWindow", value: string) => void;
}) {
  const activeWeekdays = dailyHours.filter((entry) => entry.workingHours || entry.workingHoursSecondWindow).map((entry) => entry.weekday);
  return <BusinessHoursGrid label="Staff" dailyHours={dailyHours} activeWeekdays={activeWeekdays} disabledWeekdays={SCHEDULE_WEEKDAYS.flatMap((_, weekday) => {
    const master = masterDailyHours.find((entry) => entry.weekday === weekday);
    return master?.workingHours || master?.workingHoursSecondWindow ? [] : [weekday];
  })} allowedWeeklyIntervals={masterWeeklyIntervals} blockedWeeklyIntervals={blockedWeeklyIntervals} onDayToggle={(weekday) => onDayToggle(weekday, !activeWeekdays.includes(weekday))} onHoursChange={onHoursChange} />;
}

function getOtherProviderWeeklyIntervals(panel: Panel, membership: Membership, actorIdentifier: string | null) {
  if (!actorIdentifier || !participantIdentifiersMatch(membership.providerIdentifier, actorIdentifier)) return [];
  const schedules: ApportionDailyHours[][] = panel.memberships
    .filter((entry) => participantIdentifiersMatch(entry.providerIdentifier, actorIdentifier)
      && !(participantIdentifiersMatch(entry.ownerIdentifier, membership.ownerIdentifier) && entry.locationId === membership.locationId))
    .map((entry) => resolveApportionDailySchedule(entry));
  for (const business of panel.businesses) {
    if (business.role !== "owner" || !participantIdentifiersMatch(business.business.ownerIdentifier, actorIdentifier)) continue;
    const consultation = business.business.services.find((service) => service.id === "consultation");
    const providerIdentifier = consultation?.assignedIdentifier || business.business.ownerIdentifier;
    if (!consultation || !participantIdentifiersMatch(providerIdentifier, actorIdentifier)) continue;
    for (const location of business.branding.appointmentLocations ?? []) {
      if (consultation.locationIds.includes(location.id)
        && !(participantIdentifiersMatch(business.business.ownerIdentifier, membership.ownerIdentifier) && location.id === membership.locationId)) {
        schedules.push(resolveApportionDailySchedule(location));
      }
    }
  }
  return schedules.flatMap(getWeeklyIntervals);
}

function LinkedHours({ membership, address, master, blockedWeeklyIntervals, busy, save }: { membership: Membership; address: string; master?: AppointmentLocation; blockedWeeklyIntervals: ApportionWeeklyInterval[]; busy: boolean; save: SaveOperation }) {
  const masterDailyHours = resolveApportionDailySchedule(master ?? membership);
  const masterWeeklyIntervals = getWeeklyIntervals(masterDailyHours);
  const [hours, setHours] = useState(() => ({ dailyHours: resolveApportionDailySchedule(membership), closedDateKeys: membership.closedDateKeys }));
  useEffect(() => { setHours({ dailyHours: resolveApportionDailySchedule(membership), closedDateKeys: membership.closedDateKeys }); }, [membership]);
  const workingDays = hours.dailyHours.filter((entry) => entry.workingHours || entry.workingHoursSecondWindow).map((entry) => SCHEDULE_WEEKDAYS[entry.weekday]).join(", ");
  const firstHours = hours.dailyHours.find((entry) => entry.workingHours || entry.workingHoursSecondWindow);
  function updateDailyHours(dailyHours: ApportionDailyHours[]) {
    setHours((current) => ({ ...current, dailyHours }));
  }
  return <fieldset disabled={busy} className="workspace-card-stack">
    <legend>{address}</legend>
    <ProviderScheduleEditor
      dailyHours={hours.dailyHours}
      blockedWeeklyIntervals={blockedWeeklyIntervals}
      masterDailyHours={masterDailyHours}
      masterWeeklyIntervals={masterWeeklyIntervals}
      onDayToggle={(weekday, enabled) => {
        const source = masterDailyHours.find((entry) => entry.weekday === weekday);
        updateDailyHours(hours.dailyHours.map((entry) => entry.weekday === weekday
          ? enabled && source ? { ...source } : { ...entry, workingHours: "", workingHoursSecondWindow: "" }
          : entry));
      }}
      onHoursChange={(weekday, field, value) => updateDailyHours(hours.dailyHours.map((entry) => entry.weekday === weekday ? { ...entry, [field]: value } : entry))}
    />
    <div className="button-row">
      <button className="button-secondary" type="button" onClick={() => void save({ operation: "set-hours", ownerIdentifier: membership.ownerIdentifier, locationId: membership.locationId, hours: { dailyHours: hours.dailyHours, workingDays, workingHours: firstHours?.workingHours ?? "", workingHoursSecondWindow: firstHours?.workingHoursSecondWindow ?? "", closedDateKeys: hours.closedDateKeys } })}><Save size={16} /> Save hours</button>
      <button className="button-secondary" type="button" onClick={() => { if (window.confirm("Opt out of this address? Future bookings at this address will be cancelled.")) void save({ operation: "unlink-address", ownerIdentifier: membership.ownerIdentifier, locationId: membership.locationId }); }}><Unlink size={16} /> Opt out</button>
    </div>
  </fieldset>;
}

function localDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getProviderWorkingWeekdays(panel: Panel, actorIdentifier: string | null) {
  const weekdays = new Set<number>();
  if (!actorIdentifier) return weekdays;
  for (const business of panel.businesses) {
    const isOwner = business.role === "owner" && participantIdentifiersMatch(business.business.ownerIdentifier, actorIdentifier);
    for (const location of business.branding.appointmentLocations ?? []) {
      const membership = business.memberships.find((entry) => entry.locationId === location.id
        && participantIdentifiersMatch(entry.providerIdentifier, actorIdentifier));
      if (!isOwner && !membership) continue;
      const schedule = resolveApportionDailySchedule(membership ?? location);
      for (const entry of schedule) {
        if (entry.workingHours || entry.workingHoursSecondWindow) weekdays.add(entry.weekday);
      }
    }
  }
  return weekdays;
}

function ProviderLeaveCalendar({
  busy,
  closedDateKeys,
  save,
  workingWeekdays,
}: {
  busy: boolean;
  closedDateKeys: string[];
  save: SaveOperation;
  workingWeekdays: Set<number>;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const today = new Date(`${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00Z`);
  const maxDate = new Date(today);
  maxDate.setUTCMonth(today.getUTCMonth() + 6);
  const weekStart = new Date(today);
  weekStart.setUTCDate(today.getUTCDate() - today.getUTCDay() + weekOffset * 7);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setUTCDate(weekStart.getUTCDate() + index);
    return date;
  });
  const rangeLabel = `${dates[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} - ${dates[6].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  const nextWeek = new Date(weekStart);
  nextWeek.setUTCDate(weekStart.getUTCDate() + 7);

  return (
    <div className="business-exception-calendar apportion-provider-leaves">
      <div className="business-exception-calendar-head">
        <button aria-label="Previous leave week" className="button-secondary icon-button" disabled={weekOffset === 0 || busy} type="button" onClick={() => setWeekOffset((current) => Math.max(0, current - 1))}>
          <ChevronLeft aria-hidden="true" size={18} />
        </button>
        <strong>{rangeLabel}</strong>
        <button aria-label="Next leave week" className="button-secondary icon-button" disabled={nextWeek > maxDate || busy} type="button" onClick={() => setWeekOffset((current) => current + 1)}>
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="business-exception-grid">
        {dates.map((date) => {
          const key = localDateKey(date);
          const isScheduledDay = workingWeekdays.has(date.getUTCDay());
          const isClosed = closedDateKeys.includes(key);
          const isDisabled = busy || date < today || date > maxDate || !isScheduledDay;
          return (
            <button
              aria-label={`${date.toLocaleDateString()} ${isScheduledDay ? isClosed ? "leave" : "working" : "not scheduled"}`}
              aria-pressed={isScheduledDay && !isClosed}
              className={`business-exception-date${isScheduledDay && !isClosed ? " is-active" : " is-inactive"}${isClosed ? " is-closed" : ""}`}
              disabled={isDisabled}
              key={key}
              type="button"
              onClick={() => void save({
                operation: "set-leaves",
                closedDateKeys: isClosed ? closedDateKeys.filter((entry) => entry !== key) : [...closedDateKeys, key],
              })}
            >
              <span>{SCHEDULE_WEEKDAYS[date.getUTCDay()].slice(0, 3)}</span>
              <strong>{date.getUTCDate()}</strong>
              {isClosed ? <small>Leave</small> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ApportionRolePanel({ canCreateBusiness: fallbackCanCreateBusiness, actorIdentifier, personalBusinessForm, personalBusinessFooter, onUpgrade, onPersonalConsultationLocationsChange, onProviderSettingsSaved }: { canCreateBusiness: boolean; actorIdentifier: string | null; personalBusinessForm: ReactNode; personalBusinessFooter?: ReactNode; onUpgrade: () => void; onPersonalConsultationLocationsChange?: (locationIds: string[]) => void; onProviderSettingsSaved?: (settings: ApportionProviderSettings) => void }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const upgradeCallback = useRef(onUpgrade);
  const personalConsultationCallback = useRef(onPersonalConsultationLocationsChange);
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => { upgradeCallback.current = onUpgrade; }, [onUpgrade]);
  useEffect(() => { personalConsultationCallback.current = onPersonalConsultationLocationsChange; }, [onPersonalConsultationLocationsChange]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/user/apportion/business", { signal: controller.signal }).then(readResponse<Panel>).then((payload) => {
      setPanel(payload);
      if (!(payload.canCreateBusiness ?? fallbackCanCreateBusiness) && !payload.businesses.some((business) => business.role !== "owner")) upgradeCallback.current();
    }).catch((error: unknown) => { if (!controller.signal.aborted) setFeedback(error instanceof Error ? error.message : "Unable to load Business Panel."); });
    return () => controller.abort();
  }, [fallbackCanCreateBusiness]);
  useEffect(() => {
    const locationIds = panel?.businesses.flatMap((business) => {
      if (business.role !== "owner" || !participantIdentifiersMatch(business.business.ownerIdentifier, actorIdentifier || "")) return [];
      const consultation = business.business.services.find((service) => service.id === "consultation");
      const providerIdentifier = consultation?.assignedIdentifier || business.business.ownerIdentifier;
      return consultation && participantIdentifiersMatch(providerIdentifier, actorIdentifier || "") ? consultation.locationIds : [];
    }) ?? [];
    personalConsultationCallback.current?.(locationIds);
  }, [panel, actorIdentifier]);
  async function save(input: ApportionPanelInput) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const savedPanel = await readResponse<Panel>(await fetch("/api/user/apportion/business", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
      setPanel(savedPanel);
      if (input.operation === "set-settings") onProviderSettingsSaved?.(savedPanel.providerSettings);
      setFeedback("Saved.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Unable to save."); }
    finally { submitting.current = false; setBusy(false); }
  }
  if (!panel) return <p role="status">{feedback || "Loading Business Panel..."}</p>;
  const canCreateBusiness = panel.canCreateBusiness ?? fallbackCanCreateBusiness;
  const assignedBusinesses = panel.businesses.filter((business) => canCreateBusiness || business.role !== "owner");
  const providerWorkingWeekdays = getProviderWorkingWeekdays(panel, actorIdentifier);
  return <><div className="workspace-card-stack apportion-drawer-body">
    {feedback ? <p role="status">{feedback}</p> : null}
    <h3>Service &amp; Staff Matrix</h3>
    {assignedBusinesses.map((business) => <BusinessRoles key={business.business.ownerIdentifier} business={business} busy={busy} save={save} />)}
    {providerWorkingWeekdays.size ? (
      <fieldset disabled={busy} className="workspace-card-stack">
        <legend>Mark Leaves</legend>
        <ProviderLeaveCalendar busy={busy} closedDateKeys={panel.providerClosedDateKeys ?? []} save={save} workingWeekdays={providerWorkingWeekdays} />
      </fieldset>
    ) : null}
    {!canCreateBusiness && assignedBusinesses.length ? <fieldset disabled={busy} className="workspace-card-stack">
      <legend>My booking settings</legend>
      <span className="field-label">Appointments per slot</span>
      <div className="business-choice-row" role="group" aria-label="My appointments per slot">{[1, 2, 3, 4, 5, 6].map((capacity) => <button className="business-choice-button" aria-pressed={panel.providerSettings.appointmentsPerSlot === capacity} key={capacity} type="button" onClick={() => setPanel({ ...panel, providerSettings: { ...panel.providerSettings, appointmentsPerSlot: capacity } })}>{capacity}</button>)}</div>
      <span className="field-label">Slot duration</span>
      <div className="business-choice-row" role="group" aria-label="My slot duration">{APPORTION_NEW_DURATION_MINUTES.map((duration) => <button className="business-choice-button" aria-pressed={panel.providerSettings.slotDurationMinutes === duration} key={duration} type="button" onClick={() => setPanel({ ...panel, providerSettings: { ...panel.providerSettings, slotDurationMinutes: duration } })}>{duration === 1440 ? "All Day" : duration === 240 ? "4 hr" : duration === 60 ? "1 hr" : `${duration} min`}</button>)}</div>
      {!APPORTION_NEW_DURATION_MINUTES.some((duration) => duration === panel.providerSettings.slotDurationMinutes) ? <span className="muted-text">Current: {panel.providerSettings.slotDurationMinutes} min</span> : null}
      <div className="business-choice-row business-mode-choices" role="group" aria-label="My booking mode">{[{ label: "Slot Based", queue: false }, { label: "Queue Based", queue: true }].map((mode) => <button className="business-choice-button" aria-pressed={panel.providerSettings.justAddToList === mode.queue} key={mode.label} type="button" onClick={() => setPanel({ ...panel, providerSettings: { ...panel.providerSettings, justAddToList: mode.queue } })}>{mode.label}</button>)}</div>
      <button className="button-secondary" type="button" onClick={() => void save({ operation: "set-settings", settings: panel.providerSettings })}><Save size={16} /> Save my settings</button>
    </fieldset> : null}
    {panel.memberships.filter((membership) => !participantIdentifiersMatch(membership.ownerIdentifier, actorIdentifier || "")).map((membership) => {
      const business = panel.businesses.find((entry) => participantIdentifiersMatch(entry.business.ownerIdentifier, membership.ownerIdentifier));
      const master = business?.branding.appointmentLocations?.find((location) => location.id === membership.locationId);
      const blockedWeeklyIntervals = getOtherProviderWeeklyIntervals(panel, membership, actorIdentifier);
      return <LinkedHours key={`${membership.ownerIdentifier}:${membership.locationId}`} membership={membership} master={master} blockedWeeklyIntervals={blockedWeeklyIntervals} address={master?.address || membership.locationId} busy={busy} save={save} />;
    })}
    {canCreateBusiness ? personalBusinessForm : !assignedBusinesses.length ? <button className="button" type="button" onClick={onUpgrade}>Upgrade to Pro</button> : null}
  </div>{canCreateBusiness ? personalBusinessFooter : null}</>;
}