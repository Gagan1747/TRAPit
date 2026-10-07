# TRAPit

TRAPit is a TypeScript monorepo for a role-aware web and mobile application. It includes:

- A Next.js web app for phone-number sign up, SMS confirmation, sign in, and separate admin and user experiences.
- An Expo mobile app with matching phone-first authentication flows.
- A shared package for role definitions, claim parsing, and redirect helpers.
- Cognito-ready environment variables and setup notes for separate admin and normal-user access.

## Apps and packages

- `apps/web`: Next.js web client.
- `apps/mobile`: Expo mobile client.
- `packages/auth`: Shared roles, labels, copy, and redirect helpers.
- `infra/cognito`: Setup notes for Amazon Cognito groups and app clients.

## Authentication model

- Normal users can sign up publicly.
- Both admins and normal users can sign in.
- Admins should be provisioned separately in Cognito and assigned to the `admins` group.
- Normal users should be assigned to the `users` group.

The current scaffold now includes real Cognito-backed handlers:

- Web sign-up uses a Next.js API route, creates the user in Cognito with a phone number, and attempts to add the user to the configured `users` group.
- Web sign-in verifies the returned Cognito ID token and stores the session in secure HTTP-only cookies.
- Web admin and user pages are server-protected and redirect if the token claims do not match the expected role.
- Mobile sign-up calls the same web API route so user-group assignment happens in one place.
- Mobile sign-in talks directly to Cognito and stores the resulting session in Expo Secure Store.
- Both web and mobile expect phone numbers in E.164 format, for example `+14155550123`.

## Getting started

1. Install dependencies:

   ```bash
   corepack pnpm install
   ```

2. Copy the environment template and fill in your Cognito values:

   ```bash
   copy .env.example .env.local
   ```

   Required notes:

   - `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_WEB_CLIENT_ID`, and `COGNITO_MOBILE_CLIENT_ID` must match your Cognito setup.
   - Set `TRAPIT_COOKIE_DOMAIN=trapit.in` in production when you serve both `trapit.in` and `www.trapit.in` so the web sign-in cookies work on both hosts.
   - `ADMIN_ACCESS_CONTACT_EMAIL` and `ADMIN_ACCESS_CONTACT_PHONE` are optional. If you set them, users who try to sign in as admins without the admin role will see who to contact for access.
   - Configure the Cognito user pool for phone-number sign-in and SMS verification. The current app flow does not use email-based confirmation.
   - `EXPO_PUBLIC_API_BASE_URL` should point to the web app base URL. For local simulator use, `http://localhost:3000` is usually fine. For a physical device, set it to your machine's LAN IP, for example `http://192.168.1.10:3000`.
   - Automatic assignment to the `users` group requires the Next.js server to have AWS credentials that can call `cognito-idp:AdminAddUserToGroup`.

   ### Shared poll storage

   The web poll APIs can now store poll questions, scheduled polls, and poll attempts in DynamoDB instead of the local JSON file.

   Set these variables in `.env.local` to enable that mode:

   ```bash
   TRAPIT_POLL_STORE_MODE=dynamodb
   TRAPIT_DYNAMODB_REGION=us-east-1
   TRAPIT_POLL_QUESTIONS_TABLE=trapit-poll-questions
   TRAPIT_SCHEDULED_POLLS_TABLE=trapit-scheduled-polls
   TRAPIT_POLL_ATTEMPTS_TABLE=trapit-poll-attempts
   TRAPIT_SIGNIN_ACTIVITY_TABLE=trapit-signin-activity
   ```

   Table details and example AWS CLI commands live in `infra/dynamodb/README.md`.

   Current scope note:

   - Web admin poll authoring, web/public poll access, and open-poll submissions use DynamoDB when this mode is enabled.
   - Polls can run once or recur weekly, bi-weekly, or monthly. Recurring results are released per completed instance, and editing a series replaces only cycles that have not started.
   - Tests, groups, question banks, and the mobile local workspace are still backed by their existing stores.
   - Dashboard notification baselines and the dashboard header's last-signed-in timestamp now come from `TRAPIT_SIGNIN_ACTIVITY_TABLE` in DynamoDB instead of the local JSON file.
   - Mobile poll flows are not device-shared yet because mobile still authenticates directly with Cognito and does not call the protected web poll APIs.

3. Start the web app:

   ```bash
   pnpm run dev:web
   ```

4. Start the mobile app:

   ```bash
   pnpm run dev:mobile
   ```

## Appointment booking

- Slot Selection and Queue Only bookings both use the location calendar and support dates up to six months ahead.
- Queue Only dates are disabled when the location is closed or the day's working-window capacity is full. Today's estimate starts from the current IST time; future estimates start from opening time.

### Apportion roles, services and addresses

- Pro businesses allow four active services per address; Pro Max allows ten per address. Consultation counts; Admin delegation and inactive services do not. A service linked to two addresses counts at each. Downgrades pause excess services independently at each address in saved order, without deleting bookings or history.
- A registered person can provide one service per business. Staff assignments activate immediately, consume one of the provider's two address slots per linked address, and lock the owner's address against staff edits. Admin-only delegation consumes no address slot.
- Assigned staff, including Free users, can manage their own linked hours, leave dates and global queue/capacity/duration settings through Business Panel. They cannot create a personal business or personal branding on Free. Provider booking settings apply across assignments; saved appointments retain their original settings snapshot.
- Owners and delegates can configure services; only owners appoint delegates. Assigned providers control their bookings, while owners retain read-only visibility. Unassigned services route controls to the delegate, or to the owner when there is no delegate.
- Staff opt-out removes only the selected linked address. Today's appointments remain with delegate/owner fallback; future appointments are cancelled with durable in-app notifications and browser push retries where subscriptions exist. Pending opt-outs are retried by panel access and the existing notification worker.
- Legacy profiles migrate to Consultation without changing existing share codes, media, appointment IDs or history. The migration is repeatable and stored on subsequent mutations. Back up persistent data before deployment.
- Address deletion and provider reassignment are intentionally blocked with a conflict until their booking-transfer policy is implemented. Reducing master hours clips linked provider schedules and creates durable recipient notifications; existing bookings are preserved.
- Persistence and realtime events remain single-process. Run one web app instance against the file-backed stores; these locks do not provide cross-process or distributed transactions.

### Business Panel and schedules

- Each address supports an independent Sunday-first seven-row daily grid with two windows. Editing a day never copies its hours to other days. Timelines use 12-hour labels; the plus control reveals next-day times for overnight windows. Legacy schedules and date overrides remain readable.
- Staff edit only their own linked schedules within master hours. Same-person address overlaps are rejected, including overnight and week-boundary overlaps. Owners see linked schedules against service rows.
- Mark Leaves stores personal dates across all explicitly assigned services and addresses. Owner leave affects Consultation, not the whole business or unassigned services. The calendar only closes or reopens normally scheduled dates. New bookings and reschedules are blocked on leave; same-day bookings are preserved and future bookings are cancelled by the lifecycle integration.
- New configurations start with queue mode, capacity one and ten-minute slots. Slot Based and Queue Based use matching selection controls. New duration choices are 5, 10, 15, 60, 240 and 1440 minutes. Existing settings with other supported legacy durations remain unchanged until explicitly replaced; booked snapshots are never converted. All Day means a fixed 24-hour slot and requires continuous 24-hour effective operating hours, not disjoint windows. Business name and Copy/Open/QR actions remain in the sticky header above the scrolling body.
- Services are grouped under their addresses. Assigned staff identifies the registered provider and controls routing, permissions, personal hours and leave. Active controls availability separately. Owner-assigned and unassigned services inherit address hours; only staff-specific hours are shown under staff services.
- In-app schedule notifications persist even without browser push permission. Browser delivery uses the existing subscription worker and requires configured VAPID keys.

### Booking page and access

- Personal booking links show personal and permitted linked-business addresses together. Linked addresses expose only the provider's assigned service; booking writes one canonical appointment visible to that provider and the owning business. Personal branding remains separate from the linked business's schedule and booking rules.
- Address cards show only the address; staff booking pages additionally show the corresponding service name. Service choices use cards for up to four services and a dropdown above four.
- Calendars start Sunday and hatch unavailable days: past days, weekly offs, leave, exhausted availability and dates outside the horizon. Today's availability updates when hours or remaining slots elapse; overnight service days remain eligible while their effective windows allow booking. Standard booking shows six available times per page; queue booking has no time-slot picker. Capacity-one bookings hide remaining-count labels. Duplicate selected-time summaries and queue date labels are omitted.
- Unauthenticated links open the common landing page with a validated local return path preserved through sign-in and sign-up. Successful bookings link to the active dashboard ticket.
- New QR downloads retain the existing destination and use high error correction with a centered TRAPit logo. Automated tests decode the branded QR image.
- Opening the verified caller's Business Panel does not require listing Cognito users. Registered-user lookup and administrative directory operations still require valid AWS credentials and IAM permissions.

### Appointment logs, actions and messaging

- Active and Completed tables combine appointments and invitations, with six rows per page and no category headers. Appointment cells show IST date/time without a timezone suffix, followed by Service Name and Address. Active entries use date/time ordering while retaining each service queue's relative order; completed entries use reverse completion order.
- Plain serial numbers mark received requests; squares mark sent requests. Circles mark outgoing invitations and double circles incoming invitations, including their accepted appointment entries. Queue positions remain separate from table serial numbers.
- Done and Absent remain restricted to the current controller. Customers retain Cancel; the Reschedule UI is temporarily removed, without deleting its historical records or backend compatibility. Buttons disable immediately with loading feedback, and action menus close before dispatch.
- Notes open an append-only conversation. Only the customer and current controlling provider can send messages; owners and delegates with visibility are read-only when they are not the controller. The server authenticates the author and validates trimmed messages of 1–2000 characters.
- Notes cells preview the latest message and show a green dot for unread incoming messages. Read cursors are server-persisted per user across devices. Opening a thread acknowledges the displayed last message only, not later unseen arrivals; own messages do not count as unread. Historical threads start read on migration. Pending invitation notes remain read-only until acceptance.
- Completed, missed, cancelled and legacy terminal absent appointments have read-only message history. New Absent actions leave appointments active in the queue with messaging available. Legacy booking notes migrate once into the initial customer message without removing the original note or appointment metadata.
- Re preserves the first originally booked time and every later history entry, including when an appointment returns to its original time. History popups and the Notes drawer render outside dashboard containers to avoid clipping on mobile.
- Legacy terminal rejected records remain unchanged. New Absent actions use the active queue behavior described below.

### Lifecycle and notifications

- Queues are partitioned by business owner, address, service and service day. Queue Absent moves back four positions, capped at the tail. Standard Absent and an unfinished slot reaching its saved end time move to the queue tail, retain the crossed-out booked time and show no replacement fixed-time estimate.
- Bookings save slot-end and queue-expiry boundaries using their booked duration and effective service schedule. Later schedule/settings changes do not overwrite those boundaries. Legacy active records acquire missing boundaries on migration.
- Daytime queues expire at IST midnight. Overnight and 24-hour bookings remain active until the first IST midnight strictly after their service window or booked slot ends. Catch-up never expires future service dates early, and repeated checks append no duplicate transition history or notices.
- Personal leave preserves the day on which leave was marked. Newly closed future dates cancel active bookings only for the explicitly assigned provider across their linked addresses/businesses. Durable leave intents save the original cutoff, recover after restart and check that dates remain closed; reopening does not restore bookings already cancelled.
- Queue conversion, Absent movement, Missed expiry and future-leave cancellation persist recipient notices for the customer, owner, historical assigned provider and current controller as applicable. Existing schedule-clipping notifications remain enabled. Push retries use the existing worker; in-app notices do not require browser permission.
- The authenticated notification worker also runs lifecycle catch-up and leave recovery. Deploy the one-minute cron entry in `infra/ec2/README.md`; this local implementation does not install a production cron job. Both worker and store mutation queues remain process-local: use one web instance, not independent file-writing cron scripts.
- Address deletion and provider reassignment remain guarded; their transfer policy is not changed by these lifecycle rules.

### Search and invitations

- Add Appointment searches business names, service names and full owner or assigned-staff mobile numbers. Staff phones are matched server-side rather than added to the result payload. Results open existing booking pages in a new tab with opener isolation.
- Only the business owner on their own public page can look up a registered customer by full phone and send an invitation. Staff and Admin delegation do not grant this permission. Targets are verified again on submission. Invitation identity matching distinguishes international numbers; ten-digit local aliases refer only to India.
- Owners can invite once or for a duration of 1–6 weeks/months, selecting weekly weekdays or monthly dates. Six weeks with two weekdays can create twelve appointments: the count is a duration, not an occurrence cap. The exclusive end is measured from the selected initial date. Missing monthly dates clamp to month end and deduplicate. Only working dates with matching times are included; durations crossing the current six-month booking horizon are rejected, not silently truncated. Existing saved series and legacy end-date requests keep their original semantics. Ordinary customers retain direct self-booking without recurrence.
- A pending series appears as one outgoing Pending Acceptance row and one incoming invitation with Accept/Decline. Pending invitations do not reserve capacity. Acceptance rechecks all remaining occurrences within one serialized appointment mutation; a full or invalid occurrence prevents partial booking. Accepted series become individual canonical appointments.
- The acceptance deadline remains the first saved slot end. Standard invitations retain their saved duration; queue estimates are rebuilt from current hours and counts. Pending series are consolidated in Active appointments; Declined, Expired and Cancelled series move to Completed. Accepted parents disappear and expand into chronological appointment entries, retaining invitation origin. Unattended accepted entries use the normal queue-expiry Missed lifecycle.
- Future provider leave removes only affected pending occurrences. Remaining dates stay pending with a recomputed deadline; an empty series closes with notifications. Recovery preserves unaffected occurrences even if a prior read expired the original first date. Same-day leave keeps existing invitations.
- Invitation notices share the durable appointment outbox and existing one-minute worker. Registered-user lookup requires the configured Cognito directory permissions in authenticated deployments.
- Appointment capacity writes are atomic in one web process. Directory schedule changes are not covered by a cross-file transaction, so a configuration update concurrent with acceptance can take effect after the acceptance's validated snapshot. Keep the single-instance deployment limitation.

Sections 1 through 6 and recovery fix 21dbf49 were previously deployed. These booking/dashboard refinements are local changes and require a separate backup-first deployment.

Focused checks:

```bash
corepack pnpm --filter @trapit/testing test
corepack pnpm run typecheck
corepack pnpm --filter @trapit/web build
```

## Multiplayer games

- Creating a web game opens a dedicated waiting-room tab. The creator must choose to join as a competitor or watch as a spectator before starting.
- Starting freezes the competitor roster and begins a synchronized 60-second countdown. Each of the 20 questions allows 30 seconds and advances early when every competitor answers.
- Incorrect and timed-out answers deduct 5 points. Completed reviews include chosen/correct options, per-question points, and response order.
- Invitees who did not accept before Start can watch while the game is in progress and are marked `Missed` only after completion.
- Game persistence uses `testing-workspace.json`, a process-local mutation queue, and in-process SSE. Run one web application instance until game persistence and events move to distributed infrastructure.

## Next implementation steps

1. Fill in `.env.local` with your real Cognito values and, if you want automatic user-group assignment, provide AWS credentials to the web server.
2. Start the web and mobile apps and test phone-number sign-up, SMS confirmation, sign-in, and role-based redirects with real Cognito users.
3. Add refresh-token handling and backend API authorization checks if you need long-lived authenticated sessions.
4. If you want mobile poll authoring and registered mobile poll responses to share the same backend state, add token-authenticated mobile API access next.
