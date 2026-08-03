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

Required environment variables:

1. `RENFLAIR_SECRET_ID` - Secrets Manager secret id for Renflair credentials JSON (must include `apiKey`).
2. `COGNITO_CUSTOM_SENDER_KMS_KEY_ARN` - KMS key ARN used by Cognito custom sender encryption.
3. `RENFLAIR_COUNTRY_CODE` - Optional country code override (defaults to `91`).

The web and mobile sign-up confirmation screens can stay on the existing Cognito confirmation-code flow.

## OTP troubleshooting for unconfirmed users

If users are created in Cognito but do not receive OTP:

1. Confirm the user status in Cognito is `UNCONFIRMED` and capture the masked phone suffix for log lookup.
2. Check CloudWatch logs for the Renflair custom sender Lambda and verify entries with `delivery: renflair-whatsapp`.
3. If `status: failed`, inspect `stage`:
   - `decrypt-and-load-secret`: verify `RENFLAIR_SECRET_ID`, `COGNITO_CUSTOM_SENDER_KMS_KEY_ARN`, and IAM permissions.
   - `send-whatsapp`: verify Renflair API key validity, country code, and Indian mobile number format.
4. Ensure Lambda execution role includes `secretsmanager:GetSecretValue`, `kms:Decrypt`, and CloudWatch log write permissions.
5. Ensure Cognito user pool messaging configuration points to this Lambda as Custom SMS Sender with the same KMS key.
6. For users blocked by pre-existing unconfirmed accounts, use the sign-up flow again to trigger OTP resend.

## What to wire next

1. Use Cognito hosted UI or SDK-based sign-in and sign-up.
2. Read the Cognito group or custom role claim from the ID token.
3. Redirect to `/admin` or `/user` after login based on the role claim.
4. Protect admin APIs server-side by checking the same claim.
