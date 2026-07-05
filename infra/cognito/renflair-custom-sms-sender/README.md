# Renflair WhatsApp Custom SMS Sender

This Lambda is for Amazon Cognito's **Custom SMS Sender** trigger. Cognito still creates and verifies the OTP. This Lambda only decrypts the Cognito-generated code and sends it through Renflair's WhatsApp API.

Renflair sample contract found in `renflair-sample/send-otp.php`:

```text
GET https://whatsapp.renflair.in/V1.php?API=...&PHONE=...&OTP=...&COUNTRY=91
```

Do not commit real Renflair credentials. Store them in AWS Secrets Manager.

## Secret

Create one Secrets Manager secret, for example `trapit/renflair/whatsapp`, with this JSON shape:

```json
{
  "apiKey": "REPLACE_WITH_RENFLAIR_API_KEY",
  "countryCode": "91"
}
```

## Lambda Environment Variables

Set these variables on the Lambda:

```text
RENFLAIR_SECRET_ID=trapit/renflair/whatsapp
RENFLAIR_COUNTRY_CODE=91
COGNITO_CUSTOM_SENDER_KMS_KEY_ARN=arn:aws:kms:REGION:ACCOUNT_ID:key/KEY_ID
```

`RENFLAIR_COUNTRY_CODE` is optional if `countryCode` is present in the secret.

## IAM Permissions

The Lambda execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:trapit/renflair/whatsapp-*"
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "arn:aws:kms:REGION:ACCOUNT_ID:key/KEY_ID"
    }
  ]
}
```

The KMS key policy must also allow Cognito to encrypt OTP codes for this user pool and allow this Lambda role to decrypt them.

## Package

From this folder:

```powershell
npm install --omit=dev
npm run check
npm run bundle
```

Upload `renflair-custom-sms-sender.zip` to a Node.js 20 Lambda.

Recommended Lambda settings:

```text
Timeout: 15 seconds
Memory: 256 MB
```

The default 3-second Lambda timeout is too short for the Renflair WhatsApp API. If the Lambda times out after Renflair accepts the message, Cognito can retry the same custom sender event and the user may receive duplicate OTP messages.

## Cognito Configuration

In the Cognito user pool, configure Lambda triggers:

- Custom SMS Sender: this Lambda ARN
- KMS key: the same key ARN in `COGNITO_CUSTOM_SENDER_KMS_KEY_ARN`

This custom sender should cover sign-up confirmation, resend confirmation code, forgot password, and phone verification messages.

## Security Notes

- Never log the OTP.
- Never log the Renflair API key.
- The Lambda logs only the trigger source and the final four digits of the destination number.
- Rotate the Renflair API key if it has been pasted into chat, committed, or shared outside AWS Secrets Manager.
