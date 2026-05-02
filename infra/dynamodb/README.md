# DynamoDB tables for shared poll storage

TRAPit can store poll questions, scheduled polls, and poll attempts in DynamoDB when the web app is started with:

```bash
TRAPIT_POLL_STORE_MODE=dynamodb
TRAPIT_DYNAMODB_REGION=us-east-1
TRAPIT_POLL_QUESTIONS_TABLE=trapit-poll-questions
TRAPIT_SCHEDULED_POLLS_TABLE=trapit-scheduled-polls
TRAPIT_POLL_ATTEMPTS_TABLE=trapit-poll-attempts
```

## Expected table schemas

`trapit-poll-questions`

- Partition key: `id` (String)
- Stores `PersistentPollQuestion` records.

`trapit-scheduled-polls`

- Partition key: `id` (String)
- Stores `ScheduledPoll` records.

`trapit-poll-attempts`

- Partition key: `pollId` (String)
- Sort key: `userId` (String)
- Stores one `PollAttempt` per poll per normalized user identifier.

The current implementation scans the poll question and scheduled poll tables for admin and share-code lookups, so no GSIs are required for the first migration.

## Example AWS CLI commands

```bash
aws dynamodb create-table \
  --table-name trapit-poll-questions \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

aws dynamodb create-table \
  --table-name trapit-scheduled-polls \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

aws dynamodb create-table \
  --table-name trapit-poll-attempts \
  --attribute-definitions AttributeName=pollId,AttributeType=S AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=pollId,KeyType=HASH AttributeName=userId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

## Required IAM permissions

Grant the web app role or user these actions on the three tables:

- `dynamodb:BatchGetItem`
- `dynamodb:GetItem`
- `dynamodb:PutItem`
- `dynamodb:Query`
- `dynamodb:Scan`

## Scope note

This migration only covers poll questions, scheduled polls, and poll attempts in the web app.

- Web admin poll creation and scheduling uses DynamoDB in this mode.
- Public/open poll loads and submissions use DynamoDB in this mode.
- Tests, groups, and the mobile local workspace still use their current stores.