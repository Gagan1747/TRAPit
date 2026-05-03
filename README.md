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

## Next implementation steps

1. Fill in `.env.local` with your real Cognito values and, if you want automatic user-group assignment, provide AWS credentials to the web server.
2. Start the web and mobile apps and test phone-number sign-up, SMS confirmation, sign-in, and role-based redirects with real Cognito users.
3. Add refresh-token handling and backend API authorization checks if you need long-lived authenticated sessions.
4. If you want mobile poll authoring and registered mobile poll responses to share the same backend state, add token-authenticated mobile API access next.
