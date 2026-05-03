import "server-only";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let documentClient: DynamoDBDocumentClient | null = null;

export function getDynamoDbRegion() {
  return process.env.TRAPIT_DYNAMODB_REGION?.trim()
    || process.env.AWS_REGION?.trim()
    || process.env.AWS_DEFAULT_REGION?.trim()
    || process.env.COGNITO_REGION?.trim()
    || "us-east-1";
}

export function getDynamoDbDocumentClient() {
  if (documentClient) {
    return documentClient;
  }

  const client = new DynamoDBClient({ region: getDynamoDbRegion() });

  documentClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });

  return documentClient;
}