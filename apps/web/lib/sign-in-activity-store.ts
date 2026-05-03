import "server-only";

import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { getDynamoDbDocumentClient } from "./dynamodb";

export type SignInActivityRecord = {
  actorKey: string;
  currentSignInAt: string;
  previousSignInAt: string | null;
};

function getSignInActivityTableName() {
  return process.env.TRAPIT_SIGNIN_ACTIVITY_TABLE?.trim() ?? "";
}

export function isSignInActivityStoreEnabled() {
  return Boolean(getSignInActivityTableName());
}

export async function getSignInActivity(actorKey: string): Promise<SignInActivityRecord | null> {
  if (!isSignInActivityStoreEnabled()) {
    return null;
  }

  const response = await getDynamoDbDocumentClient().send(new GetCommand({
    Key: { actorKey },
    TableName: getSignInActivityTableName(),
  }));

  return (response.Item as SignInActivityRecord | undefined) ?? null;
}

export async function recordSignInActivity(actorKey: string): Promise<SignInActivityRecord> {
  const currentSignInAt = new Date().toISOString();

  if (!isSignInActivityStoreEnabled()) {
    return {
      actorKey,
      currentSignInAt,
      previousSignInAt: null,
    };
  }

  const previousRecord = await getSignInActivity(actorKey);
  const nextRecord: SignInActivityRecord = {
    actorKey,
    currentSignInAt,
    previousSignInAt: previousRecord?.currentSignInAt ?? previousRecord?.previousSignInAt ?? null,
  };

  await getDynamoDbDocumentClient().send(new PutCommand({
    Item: nextRecord,
    TableName: getSignInActivityTableName(),
  }));

  return nextRecord;
}