"use client";

import { APPORTION_NEW_DURATION_MINUTES, getApportionServiceLimit, getApportionWeeklyIntervals, participantIdentifiersMatch, resolveApportionDailySchedule, type AppointmentLocation, type ApportionDailyHours, type ApportionProviderSettings, type ApportionService, type ApportionWeeklyInterval } from "@trapit/testing";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Plus, QrCode, Save, Search, Unlink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import type { ApportionPanelInput, getApportionPanel } from "../lib/apportion-directory";
import { buildApportionBookingPath } from "../lib/apportion-booking-path";
import { BusinessHoursGrid } from "./business-hours-grid";
import { readJsonResponse } from "../lib/read-json-response";

type Panel = Omit<Awaited<ReturnType<typeof getApportionPanel>>, "canCreateBusiness"> & { canCreateBusiness?: boolean };
type Business = Panel["businesses"][number];
type Membership = Panel["memberships"][number];
type SaveOperation = (input: ApportionPanelInput) => Promise<boolean>;

async function readResponse<T>(response: Response): Promise<T> {
  return readJsonResponse<T>(response);
}

export function BusinessBookingLink({ business, actions = false }: { business: Business; actions?: boolean }) {
  const code = business.branding.appointmentShareCode;
  const path = code ? buildApportionBookingPath(code) : "";
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCopied(false); setQr(""); setError(null);
    if (!actions || !path) return;
    let active = true;
    void QRCode.toDataURL(new URL(path, window.location.origin).href, { margin: 1, width: 512 })
      .then((value: string) => { if (active) setQr(value); })
      .catch(() => { if (active) setError("Unable to generate the booking QR code."); });
    return () => { active = false; };
  }, [actions, path]);
  return <div className="question-head">
    <h4>{path ? <a href={path} target="_blank" rel="noreferrer">{business.branding.instituteName || "Business"}</a> : business.branding.instituteName || "Business"} <span className="status-chip">{business.role}</span></h4>
    {actions && path ? <div className="apportion-link-actions" aria-label="Business booking link actions">
      <button aria-label={copied ? "Booking link copied" : "Copy booking link"} className="button-secondary small-button icon-button" title="Copy booking link" type="button" onClick={() => {
        void navigator.clipboard.writeText(new URL(path, window.location.origin).href).then(() => { setCopied(true); setError(null); }).catch(() => setError("Unable to copy the booking link."));
      }}>{copied ? <Check aria-hidden="true" className="apportion-action-icon" /> : <Copy aria-hidden="true" className="apportion-action-icon" />}</button>
      <a aria-label="Open booking page" className="button-secondary small-button icon-button" href={path} target="_blank" rel="noreferrer" title="Open booking page"><ExternalLink aria-hidden="true" className="apportion-action-icon" /></a>
      {qr ? <a aria-label="Download QR code" className="button-secondary small-button icon-button" download="trapit-apportion-qr.png" href={qr} title="Download QR code"><QrCode aria-hidden="true" className="apportion-action-icon" /></a>
        : <button aria-label="QR code unavailable" className="button-secondary small-button icon-button" disabled title={error || "Generating QR code..."} type="button"><QrCode aria-hidden="true" className="apportion-action-icon" /></button>}
    </div> : null}
    {error ? <p role="status">{error}</p> : null}
  </div>;
}

function BookingChoices({ settings, onChange, label }: { settings: ApportionProviderSettings; onChange: (settings: ApportionProviderSettings) => void; label: string }) {
  return <div className="field business-field-card">
    <span className="field-label">Appointments per slot</span>
    <div className="business-choice-row" role="group" aria-label={`${label} appointments per slot`}>{[1, 2, 3, 4, 5, 6].map((capacity) => <button className="business-choice-button" aria-pressed={settings.appointmentsPerSlot === capacity} key={capacity} type="button" onClick={() => onChange({ ...settings, appointmentsPerSlot: capacity })}>{capacity}</button>)}</div>
    <span className="field-label">Slot duration</span>
    <div className="business-choice-row business-duration-choices" role="group" aria-label={`${label} slot duration`}>{APPORTION_NEW_DURATION_MINUTES.map((duration) => <button className="business-choice-button" aria-pressed={settings.slotDurationMinutes === duration} key={duration} type="button" onClick={() => onChange({ ...settings, slotDurationMinutes: duration })}>{duration === 1440 ? "All Day" : duration === 240 ? "4 hr" : duration === 60 ? "1 hr" : `${duration} min`}</button>)}</div>
    {!APPORTION_NEW_DURATION_MINUTES.some((duration) => duration === settings.slotDurationMinutes) ? <span className="muted-text">Current: {settings.slotDurationMinutes} min</span> : null}
    <span className="field-label business-booking-type-heading">Booking type</span>
    <div className="business-choice-row business-mode-choices" role="group" aria-label={`${label} booking type`}>{[{ label: "Slot Based", queue: false }, { label: "Queue Based", queue: true }].map((mode) => <button className="business-choice-button" aria-pressed={settings.justAddToList === mode.queue} key={mode.label} type="button" onClick={() => onChange({ ...settings, justAddToList: mode.queue })}>{mode.label}</button>)}</div>
  </div>;
}

function RegisteredPhone({ value, onChange, onResolved, disabled = false }: { value: string; onChange: (value: string) => void; onResolved?: (identifier: string | null) => void; disabled?: boolean }) {
  const [match, setMatch] = useState<{ identifier: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const version = useRef(0);
  useEffect(() => {
    version.current += 1;
    setMatch(null); setError(null);
    if (!value.trim()) return;
    const current = version.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void fetch(`/api/user/apportion?lookupPhone=${encodeURIComponent(value)}`, { signal: controller.signal })
      .then(readResponse<{ user: { identifier: string; name: string } }>)
      .then((result) => { if (version.current === current) setMatch(result.user); })
      .catch((failure: unknown) => { if (!controller.signal.aborted && version.current === current) setError(failure instanceof Error ? failure.message : "Unable to find user."); }); }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value]);
  async function lookup() {
    const current = version.current;
    setSearching(true);
    setError(null);
    try {
      const result = await readResponse<{ user: { identifier: string; name: string } }>(await fetch(`/api/user/apportion?lookupPhone=${encodeURIComponent(value)}`));
      if (version.current !== current) return;
      setMatch(result.user);
      onResolved?.(result.user.identifier);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to find user.");
    } finally { setSearching(false); }
  }
  return <div>
    <strong aria-live="polite">{match?.name || (value ? "Registered user" : "Unassigned")}</strong>
    <div className="button-row">
      <input aria-label="Registered phone number" type="tel" value={value} disabled={disabled || searching} onChange={(event) => { onChange(event.target.value); if (!event.target.value.trim()) onResolved?.(null); }} />
      {!disabled ? <button aria-label="Find registered user" title="Find registered user" className="button-secondary icon-button" type="button" disabled={searching || !value.trim()} onClick={() => void lookup()}><Search size={18} /></button> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

export function BusinessAddresses({ business, busy, save }: { business: Business; busy: boolean; save: SaveOperation }) {
  const [branding, setBranding] = useState(business.branding);
  const [error, setError] = useState<string | null>(null);
  const [activeDays, setActiveDays] = useState(() => Object.fromEntries((business.branding.appointmentLocations ?? []).map((location) => [
    location.id, resolveApportionDailySchedule(location).filter((entry) => entry.workingHours || entry.workingHoursSecondWindow).map((entry) => entry.weekday),
  ])));
  useEffect(() => {
    setBranding(business.branding);
    setActiveDays(Object.fromEntries((business.branding.appointmentLocations ?? []).map((location) => [
      location.id, resolveApportionDailySchedule(location).filter((entry) => entry.workingHours || entry.workingHoursSecondWindow).map((entry) => entry.weekday),
    ])));
  }, [business.branding]);
  function setHours(locationId: string, weekday: number, field: "workingHours" | "workingHoursSecondWindow", value: string) {
    setBranding((current) => ({ ...current, appointmentLocations: current.appointmentLocations?.map((location) => {
      if (location.id !== locationId) return location;
      const dailyHours = resolveApportionDailySchedule(location).map((entry) => entry.weekday === weekday ? { ...entry, [field]: value } : entry);
      const active = dailyHours.filter((entry) => entry.workingHours || entry.workingHoursSecondWindow);
      return { ...location, dailyHours, workingDays: active.map((entry) => SCHEDULE_WEEKDAYS[entry.weekday]).join(", "), workingHours: active[0]?.workingHours ?? "", workingHoursSecondWindow: active[0]?.workingHoursSecondWindow ?? "" };
    }) }));
  }
  async function saveHours() {
    const incomplete = (branding.appointmentLocations ?? []).some((location) => {
      const hours = resolveApportionDailySchedule(location);
      return (activeDays[location.id] ?? []).some((weekday) => !hours[weekday]?.workingHours && !hours[weekday]?.workingHoursSecondWindow);
    });
    if (incomplete) {
      setError("Enter operating hours for each selected day, or mark that day closed.");
      return;
    }
    setError(null);
    await save({ operation: "business-branding", ownerIdentifier: business.business.ownerIdentifier, branding });
  }
  return <section className="business-details-panel"><div className="business-details-form">
    <BusinessBookingLink business={business} actions={business.role === "admin"} />
    <section className="business-form-section"><h3>Address &amp; Operating Hours</h3>
    <label>Business name<input readOnly value={branding.instituteName} /></label>
    {(branding.appointmentLocations ?? []).map((location, index) => {
      const dailyHours = resolveApportionDailySchedule(location);
      return <fieldset className="field business-field-card" disabled={busy || business.role !== "admin"} key={location.id}>
        <legend>Address #{index + 1}</legend>
        <label>Address<input readOnly value={location.address} /></label>
        <BusinessHoursGrid label={`Address ${index + 1}`} dailyHours={dailyHours} activeWeekdays={activeDays[location.id] ?? []}
          onDayToggle={(weekday) => {
            const enabled = activeDays[location.id]?.includes(weekday);
            setActiveDays((current) => ({ ...current, [location.id]: enabled ? (current[location.id] ?? []).filter((day) => day !== weekday) : [...(current[location.id] ?? []), weekday] }));
            if (enabled) {
              setHours(location.id, weekday, "workingHours", "");
              setHours(location.id, weekday, "workingHoursSecondWindow", "");
            }
          }}
          onHoursChange={(weekday, field, value) => setHours(location.id, weekday, field, value)} />
      </fieldset>;
    })}
    </section>
    <fieldset disabled={busy || business.role !== "admin"} className="business-form-section">
      <legend>Business-wide configuration</legend>
      <BookingChoices label="Business" settings={{ appointmentsPerSlot: branding.appointmentsPerSlot ?? 1, slotDurationMinutes: branding.slotDurationMinutes ?? 10, justAddToList: branding.justAddToList ?? true }}
        onChange={(settings) => setBranding((current) => ({ ...current, ...settings, showRemainingBookings: !settings.justAddToList }))} />
      <label>Notes explanation text<input value={branding.appointmentNotesPrompt ?? ""} onChange={(event) => setBranding((current) => ({ ...current, appointmentNotesPrompt: event.target.value }))} /></label>
      {(["imageDataUrl", "profileImageDataUrl"] as const).map((field) => <label key={field}>{field === "imageDataUrl" ? "Business logo" : "Profile image"}<input accept="image/*" type="file" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { setError("Choose an image smaller than 2 MB."); return; }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") setBranding((current) => ({ ...current, [field]: reader.result as string }));
        };
        reader.readAsDataURL(file);
      }} />{branding[field] ? <img alt={field === "imageDataUrl" ? "Business logo preview" : "Profile preview"} src={branding[field]!} width={80} /> : null}</label>)}
      <label>Promotional images<input accept="image/*" multiple type="file" onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        if ((branding.promotionalImageDataUrls?.length ?? 0) + files.length > 4) { setError("Choose up to 4 promotional images."); return; }
        if (files.some((file) => file.size > 2 * 1024 * 1024)) { setError("Choose images smaller than 2 MB."); return; }
        for (const file of files) {
          const reader = new FileReader();
          reader.onload = () => { if (typeof reader.result === "string") setBranding((current) => ({ ...current, promotionalImageDataUrls: [...(current.promotionalImageDataUrls ?? []), reader.result as string].slice(0, 4) })); };
          reader.readAsDataURL(file);
        }
      }} /></label>
      {(branding.promotionalImageDataUrls ?? []).map((image, index) => <div key={index}><img alt={`Promotional preview ${index + 1}`} src={image} width={80} /><button className="button-secondary" type="button" onClick={() => setBranding((current) => ({ ...current, promotionalImageDataUrls: current.promotionalImageDataUrls?.filter((_, imageIndex) => imageIndex !== index) }))}>Remove promotional image {index + 1}</button></div>)}
      <label>Business leave date<input type="date" onChange={(event) => {
        const date = event.target.value;
        if (date) setBranding((current) => ({ ...current, appointmentDateOverrides: { closedDateKeys: Array.from(new Set([...(current.appointmentDateOverrides?.closedDateKeys ?? []), date])), openedDateKeys: (current.appointmentDateOverrides?.openedDateKeys ?? []).filter((entry) => entry !== date) } }));
      }} /></label>
      {(branding.appointmentDateOverrides?.closedDateKeys ?? []).map((date) => <button className="button-secondary" key={date} type="button" onClick={() => setBranding((current) => ({ ...current, appointmentDateOverrides: { closedDateKeys: (current.appointmentDateOverrides?.closedDateKeys ?? []).filter((entry) => entry !== date), openedDateKeys: current.appointmentDateOverrides?.openedDateKeys ?? [] } }))}>Remove business leave {date}</button>)}
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}
    {business.role === "admin" ? <button className="button-secondary" disabled={busy} type="button" onClick={() => void saveHours()}>Save business configuration</button> : null}
    {business.role === "admin" ? <button className="button-secondary" disabled={busy} type="button" onClick={async () => {
      if (!window.confirm("Clear business-wide services, leaves, operating hours, configuration and branding? The owner's business name, addresses and personal settings will remain unchanged. Existing appointments remain unchanged.")) return;
      for (const service of business.business.services.filter((entry) => entry.id !== "consultation")) {
        if (!await save({ operation: "set-service", ownerIdentifier: business.business.ownerIdentifier, service: { ...service, assignedIdentifier: null, locationIds: [], active: false } })) return;
      }
      await save({ operation: "business-branding", ownerIdentifier: business.business.ownerIdentifier, branding: {
        ...business.branding, imageDataUrl: null, profileImageDataUrl: null, promotionalImageDataUrls: [],
        appointmentDateOverrides: { closedDateKeys: [], openedDateKeys: [] }, appointmentDateHoursOverrides: [], appointmentWeeklyHoursOverrides: [],
        appointmentsPerSlot: 1, slotDurationMinutes: 10, justAddToList: true, showRemainingBookings: false, appointmentNotesPrompt: "",
        workingDays: "", workingHours: "", workingHoursSecondWindow: "",
        appointmentLocations: business.branding.appointmentLocations?.map((location) => ({ ...location, workingDays: "", workingHours: "", workingHoursSecondWindow: "", dailyHours: resolveApportionDailySchedule({}) })),
      } });
    }}>Clear business-wide settings</button> : null}
  </div></section>;
}

function ServiceRow({ business, service, index, busy, save }: { business: Business; service: ApportionService; index: number; busy: boolean; save: SaveOperation }) {
  const consultation = service.id === "consultation";
  const enabled = getApportionServiceLimit(business.ownerCategory) > 0 && (consultation
    ? business.role === "owner"
    : business.role === "admin" || (business.role === "owner" && !business.business.adminDelegateIdentifier));
  const [draft, setDraft] = useState(service);
  const [phone, setPhone] = useState(service.assignedIdentifier || "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(service); setPhone(service.assignedIdentifier || ""); }, [service]);
  async function persist(next: ApportionService) {
    if (!next.name.trim()) { setError("Enter a service name before saving or linking an address."); return; }
    if (next.locationIds.length && !consultation && (phone || next.assignedIdentifier)
      && !participantIdentifiersMatch(phone, next.assignedIdentifier || "")) {
      setError("Find the registered user before linking an address, or clear the phone field to leave the service unassigned.");
      return;
    }
    setError(null);
    if (await save({ operation: "set-service", ownerIdentifier: business.business.ownerIdentifier, service: { ...next, active: next.locationIds.length > 0 } })) setDraft(next);
  }
  const locked = !consultation && service.locationIds.length > 0;
  return <fieldset disabled={busy || !enabled} className="apportion-matrix-row">
    <div><strong>{consultation ? "Owner" : `Staff ${index}`}</strong>
      <input aria-label={`${consultation ? "Owner" : `Staff ${index}`} service name`} readOnly={locked || business.role === "staff" || (consultation && business.role !== "owner")} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onBlur={() => { if (draft.name !== service.name) void persist(draft); }} />
    </div>
    <RegisteredPhone disabled={consultation || locked || !enabled} value={phone} onChange={setPhone} onResolved={(identifier) => void persist({ ...draft, assignedIdentifier: identifier })} />
    <div className="button-row">{(business.branding.appointmentLocations ?? []).map((location, addressIndex) => <button aria-pressed={service.locationIds.includes(location.id)} className="business-choice-button" disabled={consultation} key={location.id} title={location.address} type="button" onClick={() => void persist({ ...draft, locationIds: service.locationIds.includes(location.id) ? service.locationIds.filter((id) => id !== location.id) : [...service.locationIds, location.id] })}>Address #{addressIndex + 1}</button>)}</div>
    {locked ? <small className="muted-text">Unselect all addresses to edit.</small> : null}
    {error ? <p role="alert">{error}</p> : null}
  </fieldset>;
}

export function BusinessRoles({ business, save, busy }: { business: Business; save: SaveOperation; busy: boolean }) {
  const [delegate, setDelegate] = useState(business.business.adminDelegateIdentifier || "");
  useEffect(() => { setDelegate(business.business.adminDelegateIdentifier || ""); }, [business.business.adminDelegateIdentifier]);
  const canEdit = (business.role === "admin" || (business.role === "owner" && !business.business.adminDelegateIdentifier)) && getApportionServiceLimit(business.ownerCategory) > 0;
  return <section className="workspace-card-stack">
    <BusinessBookingLink business={business} />
    {business.business.services.filter((service) => service.id === "consultation").map((service) => <ServiceRow key={service.id} business={business} service={service} index={0} busy={busy} save={save} />)}
    {business.role !== "staff" ? <fieldset disabled={busy || business.role !== "owner"} className="apportion-matrix-row">
      <div><strong>Delegate</strong><span>Admin</span></div>
      <RegisteredPhone disabled={business.role !== "owner"} value={delegate} onChange={setDelegate} onResolved={(identifier) => void save({ operation: "set-delegate", ownerIdentifier: business.business.ownerIdentifier, delegateIdentifier: identifier })} />
      <div className="button-row">{(business.branding.appointmentLocations ?? []).map((location, index) => <button aria-pressed className="business-choice-button" disabled key={location.id} type="button">Address #{index + 1}</button>)}</div>
    </fieldset> : null}
    {canEdit || business.role === "staff" ? business.business.services.filter((service) => service.id !== "consultation").map((service, index) => <ServiceRow key={service.id} business={business} service={service} index={index + 1} busy={busy} save={save} />) : null}
    {canEdit ? <button className="button-secondary" type="button" disabled={busy} onClick={() => void save({ operation: "set-service", ownerIdentifier: business.business.ownerIdentifier, service: { id: `service-${crypto.randomUUID()}`, name: "New service", active: false, assignedIdentifier: null, locationIds: [] } })}><Plus size={16} /> Add service</button> : null}
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
    if (business.role !== "owner" || business.business.adminDelegateIdentifier || !participantIdentifiersMatch(business.business.ownerIdentifier, actorIdentifier)) continue;
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

export function LinkedHours({ membership, address, master, blockedWeeklyIntervals, busy, save }: { membership: Membership; address: string; master?: AppointmentLocation; blockedWeeklyIntervals: ApportionWeeklyInterval[]; busy: boolean; save: SaveOperation }) {
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
    <label>Address<input readOnly value={address} /></label>
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

export function ApportionRolePanel({ canCreateBusiness: fallbackCanCreateBusiness, actorIdentifier, refreshVersion = 0, personalBusinessForm, personalBusinessConfiguration, personalBusinessBranding, personalBusinessFooter, onUpgrade, onPersonalAddressLimitChange, onPersonalConsultationLocationsChange, onProviderSettingsSaved, onOwnerDelegationChange }: { canCreateBusiness: boolean; actorIdentifier: string | null; refreshVersion?: number; personalBusinessForm: ReactNode; personalBusinessConfiguration?: ReactNode; personalBusinessBranding?: ReactNode; personalBusinessFooter?: ReactNode; onUpgrade: () => void; onPersonalAddressLimitChange?: (limit: number) => void; onPersonalConsultationLocationsChange?: (locationIds: string[]) => void; onProviderSettingsSaved?: (settings: ApportionProviderSettings) => void; onOwnerDelegationChange?: (delegated: boolean) => void }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState(false);
  const [providerSettingsDirty, setProviderSettingsDirty] = useState(false);
  const submitting = useRef(false);
  const panelRequestVersion = useRef(0);
  const upgradeCallback = useRef(onUpgrade);
  const personalConsultationCallback = useRef(onPersonalConsultationLocationsChange);
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => { upgradeCallback.current = onUpgrade; }, [onUpgrade]);
  useEffect(() => { personalConsultationCallback.current = onPersonalConsultationLocationsChange; }, [onPersonalConsultationLocationsChange]);
  useEffect(() => { if (panel) onPersonalAddressLimitChange?.(panel.personalAddressLimit); }, [panel, onPersonalAddressLimitChange]);
  const ownerDelegated = Boolean(panel?.businesses.some((business) => business.role === "owner" && business.business.adminDelegateIdentifier));
  useEffect(() => { if (panel) onOwnerDelegationChange?.(ownerDelegated); }, [panel, ownerDelegated, onOwnerDelegationChange]);
  useEffect(() => {
    const controller = new AbortController();
    const version = ++panelRequestVersion.current;
    void fetch("/api/user/apportion/business", { signal: controller.signal }).then(readResponse<Panel>).then((payload) => {
      if (controller.signal.aborted || version !== panelRequestVersion.current) return;
      setPanel(payload);
      if (!(payload.canCreateBusiness ?? fallbackCanCreateBusiness) && !payload.businesses.some((business) => business.role !== "owner")) upgradeCallback.current();
    }).catch((error: unknown) => { if (!controller.signal.aborted && version === panelRequestVersion.current) setFeedback(error instanceof Error ? error.message : "Unable to load Business Panel."); });
    return () => controller.abort();
  }, [fallbackCanCreateBusiness, refreshVersion]);
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
    if (submitting.current) { setFeedback("A save is already in progress. Please retry this change when it finishes."); return false; }
    submitting.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const savedPanel = await readResponse<Panel>(await fetch("/api/user/apportion/business", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
      panelRequestVersion.current += 1;
      setPanel(savedPanel);
      if (input.operation === "set-settings") {
        setProviderSettingsDirty(false);
        onProviderSettingsSaved?.(savedPanel.providerSettings);
      }
      setFeedback("Saved.");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save.";
      setFeedback(message);
      if (message === "Admin address unavailable") window.alert("Admin address unavailable");
      return false;
    }
    finally { submitting.current = false; setBusy(false); }
  }
  if (!panel) return <p role="status">{feedback || "Loading Business Panel..."}</p>;
  const canCreateBusiness = panel.canCreateBusiness ?? fallbackCanCreateBusiness;
  const assignedBusinesses = panel.businesses.filter((business) => canCreateBusiness || business.role !== "owner");
  const providerWorkingWeekdays = getProviderWorkingWeekdays(panel, actorIdentifier);
  return <><div className="workspace-card-stack apportion-drawer-body">
    {feedback ? <p role="status">{feedback}</p> : null}
    {canCreateBusiness ? personalBusinessForm : null}
    {assignedBusinesses.filter((business) => business.role === "admin").map((business) => <BusinessAddresses key={business.business.ownerIdentifier} business={business} busy={busy} save={save} />)}
    {panel.memberships.filter((membership) => ownerDelegated || !participantIdentifiersMatch(membership.ownerIdentifier, actorIdentifier || "")).map((membership) => {
      const business = panel.businesses.find((entry) => participantIdentifiersMatch(entry.business.ownerIdentifier, membership.ownerIdentifier));
      const master = business?.branding.appointmentLocations?.find((location) => location.id === membership.locationId);
      const blockedWeeklyIntervals = getOtherProviderWeeklyIntervals(panel, membership, actorIdentifier);
      return <LinkedHours key={`${membership.ownerIdentifier}:${membership.locationId}`} membership={membership} master={master} blockedWeeklyIntervals={blockedWeeklyIntervals} address={master?.address || membership.locationId} busy={busy} save={save} />;
    })}
    {providerWorkingWeekdays.size ? (
      <fieldset disabled={busy} className="workspace-card-stack">
        <legend>Mark Leaves</legend>
        <ProviderLeaveCalendar busy={busy} closedDateKeys={panel.providerClosedDateKeys ?? []} save={save} workingWeekdays={providerWorkingWeekdays} />
      </fieldset>
    ) : null}
    <h3>Staff and Service Matrix</h3>
    {assignedBusinesses.map((business) => <BusinessRoles key={business.business.ownerIdentifier} business={business} busy={busy} save={save} />)}
    {canCreateBusiness && !ownerDelegated ? personalBusinessConfiguration : null}
    {(ownerDelegated || !canCreateBusiness) && panel.memberships.length ? <fieldset disabled={busy} className="business-form-section">
      <legend>My booking configuration</legend>
      <BookingChoices label="My" settings={panel.providerSettings} onChange={(settings) => { setProviderSettingsDirty(true); setPanel({ ...panel, providerSettings: settings }); }} />
      {providerSettingsDirty ? <p className="muted-text">Changes apply to new bookings and reschedules. Existing appointments remain unchanged</p> : null}
      <button className="button-secondary" type="button" onClick={() => void save({ operation: "set-settings", settings: panel.providerSettings })}><Save size={16} /> Save my settings</button>
    </fieldset> : null}
    {canCreateBusiness && !ownerDelegated ? personalBusinessBranding : !canCreateBusiness && !assignedBusinesses.length ? <button className="button" type="button" onClick={onUpgrade}>Upgrade to Pro</button> : null}
  </div>{canCreateBusiness ? personalBusinessFooter : null}</>;
}