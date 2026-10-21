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
- A registered person can provide one service per business. Staff links share the provider's two-address allowance with their personal business. Admin delegation covers the whole business and reserves exactly two slots even for a one-address business. Assignment requires both slots free; unavailable capacity displays "Admin address unavailable". Admin delegation and service assignment are globally exclusive. Removal releases reserved capacity without replacing personal addresses.
- Assigned staff, including Free users, can manage their own linked hours, leave dates and global queue/capacity/duration settings through Business Panel. They cannot create a personal business or personal branding on Free. Provider booking settings apply across assignments; saved appointments retain their original settings snapshot.
- Without delegation the owner configures the whole business. During delegation only the Admin controls business-wide services, staff assignments, operating hours, leave, booking configuration and branding. The owner retains business name/addresses, their service name, personal hours/leave/booking settings, delegation and owner-only business deactivation. Owner personal hours are bounded by the business schedule. Assigned providers control their bookings, while other owners retain read-only visibility. Unassigned services route controls to the delegate, or to the owner when there is no delegate.
- Staff opt-out or service unlink removes the selected linked address without cancelling existing appointments. Management transfers durably to the delegate, or owner when no delegate exists, while booked details/history remain unchanged. Relinking or reassignment does not return those historical appointments to staff. Pending handovers are retried by panel access and the existing notification worker.
- Legacy profiles migrate to Consultation without changing existing share codes, media, appointment IDs or history. The migration is repeatable and stored on subsequent mutations. Back up persistent data before deployment.
- Confirmed owner address removal persists immediately, unlinks only that location and preserves services at other active locations. Services without locations stop accepting new bookings. Removing the final address or clearing the business deactivates it, releases delegation and staff links, and preserves appointment snapshots/history. Staff service names and assignments remain editable only after all addresses are unlinked. Relinking enforces subscription/provider limits. Owner service names remain editable while linked. Reducing master hours clips provider schedules and creates durable recipient notices; existing bookings are preserved.
- Legacy conflicting delegations are removed on first directory/panel access with notices to the owner and former delegate. The version-two migration also clears obsolete date/weekly custom-hours overrides, preserving full-day leave and operating schedules. A one-time `testing-workspace.json.delegation-capacity-v2.backup` is retained beside the configured workspace store before migration. Back up the complete persistent data directory before deployment; owners must appoint replacements within the new limits.
- Persistence and realtime events remain single-process. Run one web app instance against the file-backed stores; these locks do not provide cross-process or distributed transactions.

### Business Panel and schedules

- Each address supports an independent Sunday-first seven-row daily grid with two windows and working-day toggle buttons. One stable timeline above the matrix edits the selected day/window; switching fields resets only an unfinished selection. Editing a day never copies its hours to other days. Timelines use 12-hour labels; the plus control reveals next-day times for overnight windows. Every weekly off day is closed: obsolete custom hours and legacy opening flags cannot reopen it. Browser and server use the same date-schedule resolver.
- Staff edit only their own linked schedules within master hours. Same-person address overlaps are rejected, including overnight and week-boundary overlaps. Owners see linked schedules against service rows.
- Staff/delegate configuration controls match the owner's presentation without expanding edit permissions. Booking type labels the Slot Based/Queue Based choices. Delegated businesses expose the owner's public booking destination through the linked business name and Copy/Open/QR actions.
- Mark Leaves stores personal dates across explicitly assigned services and addresses. Owner leave affects Consultation, not the whole business or unassigned services. New bookings and reschedules are blocked on leave; all existing appointments and invitation occurrences remain unchanged. Legacy pending leave-cancellation intents are retired without cancellation. Normal appointment/invitation expiry remains independent of configuration changes.
- New configurations start with queue mode, capacity one and ten-minute slots. Slot Based and Queue Based use matching selection controls. New duration choices are 5, 10, 15, 60, 240 and 1440 minutes. Existing settings with other supported legacy durations remain unchanged until explicitly replaced; booked snapshots are never converted. All Day means a fixed 24-hour slot and requires continuous 24-hour effective operating hours, not disjoint windows. Business name and Copy/Open/QR actions remain in the sticky header above the scrolling body.
- Business Panel sections follow name, addresses/operating matrices, leaves, Staff and Service Matrix, Bookings Configuration and branding. The matrix uses two-line Owner/Delegate/Staff rows and short address buttons. Registered-user lookup resolves assignments; valid linked services are bookable within plan limits without Active/Bookable/Save service controls. Business name and addresses are owner-editable only, including server-side enforcement for delegates.
- In-app schedule notifications persist even without browser push permission. Browser delivery uses the existing subscription worker and requires configured VAPID keys.
- Saving shows a rotating processing indicator and prevents duplicate submission. Modified settings show "Changes apply to new bookings and reschedules. Existing appointments remain unchanged" immediately above the save control. Confirmed clear/removal persists before resetting the form; failures preserve the draft. Staff retain only editable personal-hour cards, with readonly addresses and hatching outside master hours.

### Booking page and access

- Personal booking links show personal and permitted linked-business addresses together. Linked addresses expose only the provider's assigned service; booking writes one canonical appointment visible to that provider and the owning business. Personal branding remains separate from the linked business's schedule and booking rules.
- Address cards show only the address; staff booking pages additionally show the corresponding service name. Service choices appear below addresses, using cards for up to four services and a dropdown above four. Explicitly assigned services show the provider's name and full phone; unassigned services show only service/business names.
- Staff without configured working hours at the selected address are omitted from that address's service choices, with the same eligibility rechecked server-side. Leave only removes affected availability; eligible owner/unassigned business-hour services remain bookable. The interactive date calendar does not repeat individual working-hours text.
- Calendars start Sunday and hatch unavailable days: past days, weekly offs, leave, exhausted availability and dates outside the horizon. Today's availability updates when hours or remaining slots elapse; overnight service days remain eligible while their effective windows allow booking. Standard booking shows six available times per page; queue booking has no time-slot picker. Capacity-one bookings hide remaining-count labels. Duplicate selected-time summaries and queue date labels are omitted.
- Unauthenticated links open the common landing page with a validated local return path preserved through sign-in and sign-up. Successful bookings link to the active dashboard ticket.
- Business Panel QR codes retain the existing destination and high error correction with a complete, logo-free matrix in displayed/downloaded images. Poll/test QR generation is unchanged. Super Admin owners use their own share code without additional access to other businesses. QR/link actions and Close have separate regions, and automated tests decode the plain QR image. Booking pages remain authentication-protected.
- Owner invitations retain phone search without a visible Customer phone label: Invite looks up the registered customer and Book submits the invitation. Monthly recurrence skips weekly offs/unavailable dates, previews skipped reasons and rejects all-unavailable selections without adding replacement dates. Weekly off days are disabled and rejected server-side for weekly recurrence. Existing manual slot/date selection is unchanged; account-specific reproduction and EC2 diagnostics remain deferred.
- Browser notification permission cards appear only on the user dashboard, independent of the removed notification icon. Permission requests require user interaction, with dismissible error feedback and retry controls. Denied permission is explained without repeatedly attempting subscription. In-app notices remain available without push permission.
- Opening the verified caller's Business Panel does not require listing Cognito users. Registered-user lookup and administrative directory operations still require valid AWS credentials and IAM permissions.

### Appointment logs, actions and messaging

- Active and Completed tables combine appointments and invitations, with six rows per page and no category headers. Appointment cells show IST date/time without a timezone suffix, followed by Business Name, Service Name and Address. Filters combine Address - Service and appear only for multiple authorized combinations: owners/staff use personal active assignments, while delegates use the delegated business. Up to four combinations use buttons, otherwise a dropdown. Clearing selection restores the complete log including customer bookings; selecting a management combination excludes unrelated customer bookings. Customer-facing contacts fall back to the owner when no staff is assigned; business-side customer contact is retained.
- Plain serial numbers mark received requests; squares mark sent requests. Circles mark outgoing invitations and double circles incoming invitations, including their accepted appointment entries. Queue positions remain separate from table serial numbers.
- Done remains restricted to the current controller. Absent is available only for queue appointments; slot appointments offer Done before and after delay, and reject Absent/queue movement server-side. Customers retain Cancel; the Reschedule UI is temporarily removed, without deleting its historical records or backend compatibility. Buttons disable immediately with loading feedback, and action menus close before dispatch.
- Notes open an append-only conversation. Only the customer and current controlling provider can send messages; owners and delegates with visibility are read-only when they are not the controller. The server authenticates the author and validates trimmed messages of 1–2000 characters.
- Every appointment or pending-invitation cancellation requires a nonempty reason. The authenticated author and reason are appended to Notes in the same persisted mutation as cancellation, without overwriting prior messages or duplicating a retry. Individual Cancel actions retain controller/customer permissions; leave does not grant additional owner authority and there is no bulk cancellation.
- Notes cells display the complete latest message with line breaks and long-word wrapping, without truncation, and show a green dot for unread incoming messages. Read cursors are server-persisted per user across devices. Opening a thread acknowledges the displayed last message only, not later unseen arrivals; own messages do not count as unread. Historical threads start read on migration. Pending invitation notes remain read-only until acceptance.
- Completed, missed, cancelled and legacy terminal absent appointments have read-only message history. New Absent actions leave appointments active in the queue with messaging available. Legacy booking notes migrate once into the initial customer message without removing the original note or appointment metadata.
- Re preserves the first originally booked time and every later history entry, including when an appointment returns to its original time. History popups and the Notes drawer render outside dashboard containers to avoid clipping on mobile.
- Legacy terminal rejected records remain unchanged. New Absent actions use the active queue behavior described below.

### Lifecycle and notifications

- Queues are partitioned by business owner, address, service and service day. Queue Absent moves back four positions, capped at the tail. Unfinished slot appointments become Delayed at their saved slot end, remain active as slots with their original unstruck time, and can still be marked Done.
- Bookings save slot-end and queue-expiry boundaries using their booked duration and effective service schedule. Slot bookings additionally save `slotExpiresAt`, the first IST midnight at or after the saved slot end. Later schedule/settings changes do not overwrite those boundaries. Legacy active records acquire missing boundaries on migration.
- Daytime queues expire at IST midnight; overnight queues retain the existing first-midnight-strictly-after-service-window policy. Unresolved slots become Missed at `slotExpiresAt`, including slots ending exactly at midnight; overnight slots cannot expire before their saved end. Worker and request-time catch-up never expire future slots early, and repeated checks append no duplicate transition history or notices.
- Identifiable active slots automatically converted by the old lifecycle are restored without rewriting IDs, messages or historical events. Completed and manually converted records remain unchanged. Ambiguous system conversions are retained and logged once with their appointment ID for manual review; `queueConversionReviewAt` records that report. Back up appointment state before deployment.
- Personal leave changes availability for new bookings and reschedules only, including the day on which leave is marked. Existing active and historical appointments are not cancelled or rewritten, and previously cancelled bookings are not restored.
- Delayed transitions, queue Absent movement, Missed expiry and management handover persist recipient notices for the customer, owner and current controller as applicable. Removed staff are not notified as the current controller. Schedule-clipping notifications remain enabled. Push retries use the existing worker; in-app notices do not require browser permission.
- Browser appointment and invitation alerts go only to the customer on creation, thirty minutes before and one minute before each scheduled occurrence. Existing in-app/native recipients and native mobile reminder behavior remain unchanged.
- Browser test/poll notifications go to explicit invitees and assigned group members on creation/sharing, thirty minutes before and one minute before each scheduled instance, with no additional start-time alert. Reminders whose due time predates creation/sharing are skipped. Public/open access alone does not qualify. Eligibility, cancellation, rescheduling and instance end are rechecked before delivery. Successful sends are tracked per subscription; temporary failures retry and expired subscriptions are removed. The one-minute worker and browser/OS transport are best-effort, not exactly-once or exact-time.
- Scheduling intents, recipient/instance observation keys and the historical baseline persist in the existing notification store. Existing schedules are baselined rather than replayed as newly scheduled on upgrade. Scheduling hooks initialize that baseline before changes; the worker can reconstruct missing intents after a crash. Keep this file persistent even when polls use DynamoDB.
- The authenticated notification worker also runs lifecycle catch-up, durable management handovers and retirement of legacy leave intents without cancellation. Deploy the one-minute cron entry in `infra/ec2/README.md`; this local implementation does not install a production cron job. Both worker and store mutation queues remain process-local: use one web instance, not independent file-writing cron scripts.
- Address removal/deactivation use durable staff handover while retaining booked details and appointment access. Provider reassignment remains guarded.

### Search and invitations

- Add Appointment searches business names, service names and full owner or assigned-staff mobile numbers. Staff phones are matched server-side rather than added to the result payload. Results open existing booking pages in a new tab with opener isolation.
- Only the business owner on their own public page can look up a registered customer by full phone and send an invitation. Staff and Admin delegation do not grant this permission. Targets are verified again on submission. Invitation identity matching distinguishes international numbers; ten-digit local aliases refer only to India.
- Owners can invite once or for a duration of 1–6 weeks/months, selecting weekly weekdays or monthly dates. Repeat (Once/Weekly/Monthly) and duration (1W–6W or 1M–6M) use selection grids immediately below customer phone verification. Weekly/monthly hide the normal calendar and derive the nearest upcoming selected day/date, including today only while the selected time remains available. Six weeks with two weekdays can create twelve appointments: the count is a duration, not an occurrence cap. The exclusive end is measured from the derived initial date. Missing monthly dates clamp to month end and deduplicate. Only working dates with matching times are included; durations crossing the current six-month booking horizon are rejected, not silently truncated. Existing saved series and legacy end-date requests keep their original semantics. Ordinary customers retain direct self-booking without recurrence.
- A pending series appears as one outgoing Pending Acceptance row and one incoming invitation with Accept/Decline. Pending invitations do not reserve capacity. Acceptance rechecks all remaining occurrences within one serialized appointment mutation; a full or invalid occurrence prevents partial booking. Accepted series become individual canonical appointments.
- The acceptance deadline remains the first saved slot end. Standard invitations retain their saved duration; queue estimates are rebuilt from current hours and counts. Pending series are consolidated in Active appointments; Declined, Expired and Cancelled series move to Completed. Accepted parents disappear and expand into chronological appointment entries, retaining invitation origin. Unattended accepted entries use the normal queue-expiry Missed lifecycle.
- Provider leave does not remove saved pending invitation occurrences or rewrite their deadlines. Acceptance still validates current availability and capacity; unavailable occurrences prevent partial acceptance. Ordinary invitation expiry remains unchanged.
- Invitation notices share the durable appointment outbox and existing one-minute worker. Registered-user lookup requires the configured Cognito directory permissions in authenticated deployments.
- Appointment capacity writes are atomic in one web process. Directory schedule changes are not covered by a cross-file transaction, so a configuration update concurrent with acceptance can take effect after the acceptance's validated snapshot. Keep the single-instance deployment limitation.

Sections 1 through 6 and recovery fix 21dbf49 were previously deployed. These booking/dashboard refinements are local changes and require a separate backup-first deployment.

Focused checks:

```bash
corepack pnpm --filter @trapit/testing test
corepack pnpm --filter @trapit/web typecheck
corepack pnpm --filter @trapit/web lint
corepack pnpm --filter @trapit/web build
```

### Verification and rollout

- Local regression tests, web typecheck, lint and production build validate the implementation. The shared testing-package typecheck has existing cross-project `TS6059`/`TS6307` errors from integration tests importing web files; these configuration errors are not addressed here.
- Business QR tests decode the actual PNG data URL produced by the renderer. Authenticated Edge/Chrome checks are still required for icon visibility, displayed/downloaded QR codes, responsive matrix interactions, autosaves and browser permission flows.
- Initial branding/dashboard requests run in parallel. Stable Business Panel reads reuse one reconciled workspace snapshot rather than repeatedly parsing it for empty retry queues. Appointment projections batch owner contexts, and public booking requests reuse service counts and owner snapshots. Versioned browser requests cannot overwrite newer service selections. These changes are not proof that the agreed performance target has been reached.
- In authenticated staging, compare baseline and updated Business Panel/Bookings pages using the same representative dataset, hardware, browser, network and cache conditions. Capture at least 30 navigations per page/browser; define interactive as visible current data with primary controls enabled. Report median and p95 load-to-interactive separately for each page/browser, and require at least 50% median reduction. Keep cold and warm runs separate. This measurement remains pending until an authenticated representative environment is available.
- Back up the complete persistent directory before deployment. Apply and validate the Nginx upload settings in [the deployment guide](infra/ec2/README.md); repository edits do not reload a live proxy. Verify delegation migration and owner notices on staged data before production rollout.

## Web assessments

- These changes cover desktop and mobile browsers, not the native Expo workspace. Newly created Standard and Instant tests use rules version 2; existing assessments retain their original configuration, scoring and issued test URLs. New tests are shared through one or more creator-owned groups, not separate test invitation links.
- New test, group and pool names are limited to 30 characters. Existing longer names remain valid when unchanged. Question counts are 20/40/60/100/200 and durations are 5/10/20/30/60 minutes; pools with insufficient questions are unavailable. Selected groups must contain at least one unique member for Standard or four for Instant/Rapid. Overlapping members count once.
- Standard entry opens one minute before the scheduled start. Name registration is required, and question content is withheld server-side until the scheduled start. Late entry does not extend the deadline. Standard scores +1 per correct answer and -1 per incorrect/unanswered answer; Instant scores +4/-1/-1.
- Instant uses a creator-controlled lobby, requires four accepted participants, locks entry at Start and runs a 60-second launch countdown before the configured duration begins. The creator counts only when joining as a participant. Standard recurrence retains the existing daily/weekly/monthly six-occurrence behavior.
- Participant sessions and answer revisions are persisted. The runner confirms Saved only after server acknowledgement, retries transient failures, and warns on persistent failure. At expiry, the latest server-saved selections are automatically submitted; never-joined users remain Absent. Reconciliation runs on assessment access and through the existing notification worker, so closing a browser does not prevent finalization. Keep that worker scheduled for background processing.
- Assessment logs have four columns and six rows per page, with no dynamic countdowns. Active runners retain duration/question timers. Participants see personal rank and score; non-participating creators see joined/shared counts.
- Final standings show masked phone numbers, combined incorrect/unanswered counts and elapsed time with the configured duration. Participants see the first ten rows plus their own highlighted row if outside the first ten; creators retain full standings. Individual answers of other participants are not returned. The heading Questions (X) & Responses uses the assessment's total question count. No additional top-ten notifications are introduced.
- Back up the persistent directory before rollout. Testing data still uses file-backed storage with process-local serialization; run a single web instance until shared persistence and cross-instance coordination are implemented.

## Multiplayer games

- Creating a web game opens a dedicated waiting-room tab. The creator must choose to join as a competitor or watch as a spectator before starting.
- New Rapid tests use rules version 4: select multiple creator-owned groups with at least four unique current members, a pool containing at least 20 questions, and a title of at most 30 characters. Each test has exactly 20 questions.
- Four accepted competitors are required to Start; the creator counts only when joining as a participant. Start freezes the roster and begins a 60-second launch countdown, followed by a strict ten-minute global deadline.
- Each participant's displayed question starts a persisted, independent window of up to 30 seconds, clipped at the global deadline. Submitting early never advances the window, and slow or disconnected participants do not block others. Refreshing or backgrounding cannot reset a started timer; server reconciliation resolves expired windows and closes absent participants at the hard deadline.
- Correct responses are ordered by their individual elapsed time rather than network arrival, earning 50/30/10/5/5/0 points; the server validates timing bounds and recomputes points as responses resolve. Incorrect and unanswered responses deduct 5 points. Results and personal answer reviews unlock only when everyone has resolved all questions or the global deadline expires.
- Timing contract: readiness persists the server's per-participant window start after display acknowledgement. A submitted elapsed duration must be finite, nonnegative, shorter than 30 seconds, and no greater than server-observed elapsed time. There is no fixed transport-difference limit or deadline grace: receipt must precede both the persisted question deadline and global cutoff. Thus transport exceeding two seconds is accepted within those deadlines, but even an earlier claimed click cannot rescue a late arrival. Browser-reported elapsed time is not tamper-proof; these checks bound claims but cannot authenticate the physical click time.
- Final standings preserve shared ranks for equal points. Creators see the full standings; participants see the top ten plus their own highlighted row. Other participants' selected answers are never returned. Historical rules versions 1–3 retain their original timing and progression.
- Invitees who did not accept before Start can watch while the game is in progress and are marked `Missed` only after completion.
- Game persistence uses `testing-workspace.json`, a process-local mutation queue, and in-process SSE. Run one web application instance until game persistence and events move to distributed infrastructure.

## Next implementation steps

1. Fill in `.env.local` with your real Cognito values and, if you want automatic user-group assignment, provide AWS credentials to the web server.
2. Start the web and mobile apps and test phone-number sign-up, SMS confirmation, sign-in, and role-based redirects with real Cognito users.
3. Add refresh-token handling and backend API authorization checks if you need long-lived authenticated sessions.
4. If you want mobile poll authoring and registered mobile poll responses to share the same backend state, add token-authenticated mobile API access next.
