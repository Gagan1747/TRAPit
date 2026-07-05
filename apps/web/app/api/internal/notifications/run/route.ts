import { NextResponse } from "next/server";
import webPush, { type PushSubscription } from "web-push";

import {
  hasNotificationDelivery,
  listPushTokens,
  listWebPushSubscriptions,
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

type ReminderMessage = {
  body: string;
  data: Record<string, string>;
  title: string;
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

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim() || "mailto:admin@trapit.in";

  if (!publicKey || !privateKey) {
    return false;
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

async function sendWebPushNotification(subscription: PushSubscription, message: ReminderMessage) {
  await webPush.sendNotification(subscription, JSON.stringify(message));
}

function buildTestReminder(test: { id: string; startsAt: string; title: string }): ReminderMessage {
  return {
    body: `${test.title} starts at ${formatStartTime(test.startsAt)}.`,
    data: { kind: "test", testId: test.id, url: `/user/test/${encodeURIComponent(test.id)}` },
    title: "TRAPit.in test reminder",
  };
}

function buildPollReminder(poll: { id: string; shareCode: string | null; startsAt: string; title: string }): ReminderMessage {
  return {
    body: `${poll.title} starts at ${formatStartTime(poll.startsAt)}.`,
    data: {
      kind: "poll",
      pollId: poll.id,
      shareCode: poll.shareCode ?? "",
      url: poll.shareCode ? `/poll/${encodeURIComponent(poll.shareCode)}` : "/user",
    },
    title: "TRAPit.in poll reminder",
  };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Notification worker access is required." }, { status: 401 });
  }

  const [pushTokens, webPushSubscriptions] = await Promise.all([
    listPushTokens(),
    listWebPushSubscriptions(),
  ]);
  const queuedMessages: Array<{ deliveryKey: string; message: ExpoPushMessage; tokenId: string }> = [];
  const queuedWebMessages: Array<{ deliveryKey: string; message: ReminderMessage; subscription: PushSubscription; subscriptionId: string }> = [];

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

      const reminder = buildTestReminder(test);

      queuedMessages.push({
        deliveryKey,
        message: {
          body: reminder.body,
          data: reminder.data,
          sound: "default",
          title: reminder.title,
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

      const reminder = buildPollReminder(poll);

      queuedMessages.push({
        deliveryKey,
        message: {
          body: reminder.body,
          data: reminder.data,
          sound: "default",
          title: reminder.title,
          to: pushToken.token,
        },
        tokenId: pushToken.id,
      });
    }
  }

  for (const subscription of webPushSubscriptions) {
    const identifier = subscription.userIdentifier?.trim();

    if (!identifier) {
      continue;
    }

    const [availableTests, availablePolls] = await Promise.all([
      listAvailableTestsForParticipant(identifier),
      listAvailablePollsForParticipant(identifier),
    ]);

    for (const test of availableTests.filter((entry) => entry.status === "scheduled" && isStartingSoon(entry.startsAt))) {
      const deliveryKey = `test:${test.id}:15min`;

      if (await hasNotificationDelivery(deliveryKey, subscription.id)) {
        continue;
      }

      queuedWebMessages.push({
        deliveryKey,
        message: buildTestReminder(test),
        subscription: {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        subscriptionId: subscription.id,
      });
    }

    for (const poll of availablePolls.filter((entry) => entry.status === "scheduled" && isStartingSoon(entry.startsAt))) {
      const deliveryKey = `poll:${poll.id}:15min`;

      if (await hasNotificationDelivery(deliveryKey, subscription.id)) {
        continue;
      }

      queuedWebMessages.push({
        deliveryKey,
        message: buildPollReminder(poll),
        subscription: {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        subscriptionId: subscription.id,
      });
    }
  }

  await sendExpoPushNotifications(queuedMessages.map((entry) => entry.message));

  let webSent = 0;

  if (configureWebPush()) {
    for (const queuedWebMessage of queuedWebMessages) {
      try {
        await sendWebPushNotification(queuedWebMessage.subscription, queuedWebMessage.message);
        await recordNotificationDelivery(queuedWebMessage.deliveryKey, queuedWebMessage.subscriptionId);
        webSent += 1;
      } catch (error) {
        console.warn("Unable to send browser push notification.", error);
      }
    }
  }

  for (const queuedMessage of queuedMessages) {
    await recordNotificationDelivery(queuedMessage.deliveryKey, queuedMessage.tokenId);
  }

  return NextResponse.json({
    browserSent: webSent,
    browserSubscriptionsChecked: webPushSubscriptions.length,
    mobileSent: queuedMessages.length,
    sent: queuedMessages.length + webSent,
    tokensChecked: pushTokens.length,
    webPushConfigured: Boolean(process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY?.trim() && process.env.WEB_PUSH_PRIVATE_KEY?.trim()),
  });
}