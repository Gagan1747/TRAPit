import { NextResponse } from "next/server";

import {
  hasNotificationDelivery,
  listPushTokens,
  recordNotificationDelivery,
} from "../../../../../lib/notification-store";
import {
  listAvailablePollsForParticipant,
  listAvailableTestsForParticipant,
} from "../../../../../lib/testing-store";

const REMINDER_WINDOW_MS = 15 * 60 * 1000;
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

type ExpoPushMessage = {
  body: string;
  data?: Record<string, string>;
  sound: "default";
  title: string;
  to: string;
};

function isAuthorized(request: Request) {
  const workerSecret = process.env.TRAPIT_NOTIFICATION_WORKER_SECRET?.trim();

  if (!workerSecret) {
    return false;
  }

  const authorizationHeader = request.headers.get("authorization")?.trim() ?? "";

  return authorizationHeader === `Bearer ${workerSecret}`;
}

function isStartingSoon(startsAt: string) {
  const startsAtMs = new Date(startsAt).getTime();
  const remainingMs = startsAtMs - Date.now();

  return remainingMs > 0 && remainingMs <= REMINDER_WINDOW_MS;
}

function formatStartTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function sendExpoPushNotifications(messages: ExpoPushMessage[]) {
  if (!messages.length) {
    return;
  }

  const response = await fetch(EXPO_PUSH_ENDPOINT, {
    body: JSON.stringify(messages),
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Expo push request failed with HTTP ${response.status}.`);
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Notification worker access is required." }, { status: 401 });
  }

  const pushTokens = await listPushTokens();
  const queuedMessages: Array<{ deliveryKey: string; message: ExpoPushMessage; tokenId: string }> = [];

  for (const pushToken of pushTokens) {
    const identifier = pushToken.userIdentifier?.trim();

    if (!identifier) {
      continue;
    }

    const [availableTests, availablePolls] = await Promise.all([
      listAvailableTestsForParticipant(identifier),
      listAvailablePollsForParticipant(identifier),
    ]);

    for (const test of availableTests.filter((entry) => entry.status === "scheduled" && isStartingSoon(entry.startsAt))) {
      const deliveryKey = `test:${test.id}:15min`;

      if (await hasNotificationDelivery(deliveryKey, pushToken.id)) {
        continue;
      }

      queuedMessages.push({
        deliveryKey,
        message: {
          body: `${test.title} starts at ${formatStartTime(test.startsAt)}.`,
          data: { kind: "test", testId: test.id },
          sound: "default",
          title: "TRAPit.in test reminder",
          to: pushToken.token,
        },
        tokenId: pushToken.id,
      });
    }

    for (const poll of availablePolls.filter((entry) => entry.status === "scheduled" && isStartingSoon(entry.startsAt))) {
      const deliveryKey = `poll:${poll.id}:15min`;

      if (await hasNotificationDelivery(deliveryKey, pushToken.id)) {
        continue;
      }

      queuedMessages.push({
        deliveryKey,
        message: {
          body: `${poll.title} starts at ${formatStartTime(poll.startsAt)}.`,
          data: { kind: "poll", pollId: poll.id, shareCode: poll.shareCode ?? "" },
          sound: "default",
          title: "TRAPit.in poll reminder",
          to: pushToken.token,
        },
        tokenId: pushToken.id,
      });
    }
  }

  await sendExpoPushNotifications(queuedMessages.map((entry) => entry.message));

  for (const queuedMessage of queuedMessages) {
    await recordNotificationDelivery(queuedMessage.deliveryKey, queuedMessage.tokenId);
  }

  return NextResponse.json({ sent: queuedMessages.length, tokensChecked: pushTokens.length });
}