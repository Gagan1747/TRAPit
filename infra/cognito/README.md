# Cognito setup notes

Use these settings to support separate admin and normal-user authentication with phone numbers and SMS verification.

## Recommended layout

1. Create one Cognito user pool.
2. Configure sign-in and verification around phone numbers in E.164 format.
2. Create two groups:
   - `admins`
   - `users`
3. Create separate app clients for web and mobile.
4. Allow public sign-up only for normal users.
5. Provision admin users manually or through a secure internal workflow.

## Flow mapping

- Web sign-up page: only creates normal users with a phone number.
- Web sign-up route: attempts to add the new account to the `users` group server-side.
- Web sign-up confirmation: uses the Cognito SMS confirmation code flow before first sign-in.
- Web sign-in page: allows both groups.
- Mobile sign-up page: calls the web API so the same `users` group assignment logic runs there too.
- Mobile sign-in page: allows both groups.
- Admin route access: only users in the `admins` group.
- User route access: users in the `users` group.

## Server prerequisites

The web app can call public Cognito sign-up and sign-in APIs with only the user pool app client IDs. Automatic assignment of new users to the `users` group is different: that requires AWS credentials on the Next.js server with permission to run `cognito-idp:AdminAddUserToGroup` against the target user pool.

## Important Cognito settings

1. Enable phone number as the username or sign-in alias.
2. Enable SMS for account verification.
3. Do not rely on email verification for this scaffold.
4. Enter test users in E.164 format, for example `+14155550123`.

## Renflair WhatsApp OTP delivery

TRAPit can keep Cognito as the source of truth for user creation and OTP verification while using Renflair WhatsApp as the delivery provider.

Use the Lambda in `infra/cognito/renflair-custom-sms-sender` as the Cognito Custom SMS Sender trigger. Cognito generates and validates the OTP, the Lambda decrypts the Cognito-generated code with KMS, and Renflair sends it to the user's WhatsApp number.

Required AWS resources:

1. KMS key for the Cognito custom sender encrypted code.
2. Secrets Manager secret containing the Renflair API key.
3. Lambda function using the `renflair-custom-sms-sender` package.
4. Lambda execution role with `secretsmanager:GetSecretValue` and `kms:Decrypt`.
5. Cognito Custom SMS Sender trigger pointing to the Lambda and KMS key.

The web and mobile sign-up confirmation screens can stay on the existing Cognito confirmation-code flow.

## What to wire next

1. Use Cognito hosted UI or SDK-based sign-in and sign-up.
2. Read the Cognito group or custom role claim from the ID token.
3. Redirect to `/admin` or `/user` after login based on the role claim.
4. Protect admin APIs server-side by checking the same claim.
