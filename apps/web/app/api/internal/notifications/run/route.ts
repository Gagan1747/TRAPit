import { NextResponse } from "next/server";
import webPush, { type PushSubscription } from "web-push";
import { createHash } from "node:crypto";
import { participantIdentifiersMatch } from "@trapit/testing";
import { listApportionPendingNotifications, markApportionNotificationDelivered, reconcileApportionLifecycle } from "../../../../../lib/apportion-store";
import { listPendingApportionScheduleNotifications, markApportionScheduleNotificationDelivered, reconcileApportionAddressOptOuts, reconcileApportionProviderLeaves } from "../../../../../lib/apportion-directory";
import { publishWorkspaceEvent } from "../../../../../lib/realtime-events";

import {
  hasNotificationDelivery,
  listPushTokens,
  listWebPushSubscriptions,
  recordNotificationDelivery,
  reconcileBrowserNotificationIntents,
  browserScheduleInstanceKey,
  removeWebPushSubscription,
} from "../../../../../lib/notification-store";
import {
  listAvailablePollsForParticipant,
  listAvailableTestsForParticipant,
  listBrowserNotificationSchedules,
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

function safeNotificationUrl(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/user";
  const url = new URL(value, "https://trapit.invalid");
  return url.origin === "https://trapit.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/user";
}

function isDeadSubscription(error: unknown) {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
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

const workerGlobal = globalThis as typeof globalThis & { __trapitNotificationWorkerQueue?: Promise<void> };

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Notification worker access is required." }, { status: 401 });
  const previous = workerGlobal.__trapitNotificationWorkerQueue ?? Promise.resolve();
  const result = previous.then(() => runNotificationWorker(request));
  workerGlobal.__trapitNotificationWorkerQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function runNotificationWorker(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Notification worker access is required." }, { status: 401 });
  }

  await reconcileApportionAddressOptOuts();
  await reconcileApportionProviderLeaves();
  if (await reconcileApportionLifecycle()) publishWorkspaceEvent("apportion");
  const [pushTokens, webPushSubscriptions, appointmentNotifications, scheduleNotifications] = await Promise.all([
    listPushTokens(),
    listWebPushSubscriptions(),
    listApportionPendingNotifications(),
    listPendingApportionScheduleNotifications(),
  ]);
  const apportionNotifications = [
    ...appointmentNotifications.map((notification) => ({ ...notification, isScheduleNotification: false })),
    ...scheduleNotifications.map((notification) => ({
      id: notification.id,
      recipientIdentifier: notification.recipientIdentifier,
      title: "Schedule updated",
      body: notification.message,
      url: "/user?section=apportion",
      createdAt: notification.createdAt,
      deliveredAt: notification.deliveredAt ?? null,
      isScheduleNotification: true,
    })),
  ];
  const webPushConfigured = configureWebPush();
  const errors: string[] = [];
  const browserIntents = await reconcileBrowserNotificationIntents(await listBrowserNotificationSchedules());
  let apportionSent = 0;
  for (const notification of apportionNotifications) {
    const allMatchingTokens = pushTokens.filter((entry) => entry.userIdentifier && participantIdentifiersMatch(entry.userIdentifier, notification.recipientIdentifier));
    const mobileEligible = !("mobilePushEligible" in notification && notification.mobilePushEligible === false);
    const matchingTokens = mobileEligible ? allMatchingTokens : [];
    const allMatchingSubscriptions = webPushSubscriptions.filter((entry) => entry.userIdentifier && participantIdentifiersMatch(entry.userIdentifier, notification.recipientIdentifier));
    const browserEligible = !("webPushEligible" in notification && notification.webPushEligible === false);
    const matchingSubscriptions = browserEligible ? allMatchingSubscriptions : [];
    const deliveryKey = `apportion:${notification.id}`;
    let fullyDelivered = matchingTokens.length + matchingSubscriptions.length > 0
      || (!browserEligible && allMatchingSubscriptions.length > 0)
      || (!mobileEligible && allMatchingTokens.length > 0)
      || (!mobileEligible && !browserEligible);
    for (const token of matchingTokens) {
      if (await hasNotificationDelivery(deliveryKey, token.id)) continue;
      try {
        const response = await fetch(EXPO_PUSH_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([{ to: token.token, title: notification.title, body: notification.body, sound: "default", data: { kind: "apportion", url: notification.url } }]) });
        if (!response.ok) throw new Error(`Expo push request failed with HTTP ${response.status}.`);
        const payload = await response.json() as { data?: Array<{ status?: string }> | { status?: string } };
        const tickets = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
        if (tickets.length !== 1 || tickets[0].status !== "ok") throw new Error("Expo did not accept the notification.");
        await recordNotificationDelivery(deliveryKey, token.id);
        apportionSent += 1;
      } catch (error) { fullyDelivered = false; errors.push("Apportion mobile delivery failed."); console.warn("Unable to send Apportion mobile notification.", error); }
    }
    for (const subscription of matchingSubscriptions) {
      if (await hasNotificationDelivery(deliveryKey, subscription.id)) continue;
      if (!webPushConfigured) { fullyDelivered = false; errors.push("Browser push is not configured."); continue; }
      try {
        const current = (await listWebPushSubscriptions()).find((entry) => entry.id === subscription.id);
        if (!current || current.userSub !== subscription.userSub || current.userIdentifier !== subscription.userIdentifier) { fullyDelivered = false; continue; }
        await sendWebPushNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, { title: "TRAPit.in appointment update", body: "An appointment update is available. Sign in to view it.", data: { kind: "apportion", url: safeNotificationUrl(notification.url), deliveryKey } });
        await recordNotificationDelivery(deliveryKey, subscription.id);
        apportionSent += 1;
      } catch (error) {
        if (isDeadSubscription(error)) {
          await removeWebPushSubscription(subscription.id);
          await recordNotificationDelivery(deliveryKey, subscription.id);
        } else {
          fullyDelivered = false;
          errors.push("Apportion browser delivery failed.");
          console.warn("Unable to send Apportion browser notification.", error);
        }
      }
    }
    if (fullyDelivered) {
      if (notification.isScheduleNotification) await markApportionScheduleNotificationDelivered(notification.id);
      else await markApportionNotificationDelivered(notification.id);
    }
  }
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

  await sendExpoPushNotifications(queuedMessages.map((entry) => entry.message));

  let webSent = 0;

  for (const intent of browserIntents) {
    const matchingSubscriptions = webPushSubscriptions.filter((entry) => entry.userIdentifier && participantIdentifiersMatch(entry.userIdentifier, intent.recipientIdentifier));
    for (const subscription of matchingSubscriptions) {
      if (await hasNotificationDelivery(intent.key, subscription.id)) continue;
      if (!webPushConfigured) { errors.push("Browser push is not configured."); continue; }
      try {
        const current = (await listWebPushSubscriptions()).find((entry) => entry.id === subscription.id);
        if (!current || current.userSub !== subscription.userSub || current.userIdentifier !== subscription.userIdentifier) continue;
        const schedule = (await listBrowserNotificationSchedules()).find((entry) => browserScheduleInstanceKey(entry) === intent.instanceKey);
        const now = Date.now();
        if (!schedule || Date.parse(schedule.endsAt) <= now
          || !schedule.recipients.some((recipient) => participantIdentifiersMatch(recipient, intent.recipientIdentifier))
          || (intent.phase === "15min" && (now >= Date.parse(schedule.startsAt) || now < Date.parse(schedule.startsAt) - REMINDER_WINDOW_MS))
          || (intent.phase === "start" && now < Date.parse(schedule.startsAt))) continue;
        const eventLabel = intent.phase === "confirmed" ? "scheduling confirmed" : intent.phase === "start" ? "starting now" : "starting soon";
        await sendWebPushNotification({ endpoint: current.endpoint, keys: current.keys }, {
          title: `TRAPit.in ${intent.kind} ${eventLabel}`,
          body: "Sign in to view your scheduled activity.",
          data: { kind: intent.kind, url: intent.kind === "test" ? `/user/test/${encodeURIComponent(intent.entityId)}` : "/user?section=polls", deliveryKey: createHash("sha256").update(intent.key).digest("hex") },
        });
        await recordNotificationDelivery(intent.key, subscription.id);
        webSent += 1;
      } catch (error) {
        if (isDeadSubscription(error)) {
          await removeWebPushSubscription(subscription.id);
          await recordNotificationDelivery(intent.key, subscription.id);
        } else {
          errors.push("Browser push delivery failed.");
          console.warn("Unable to send browser push notification.", error);
        }
      }
    }
  }

  for (const queuedMessage of queuedMessages) {
    await recordNotificationDelivery(queuedMessage.deliveryKey, queuedMessage.tokenId);
  }

  return NextResponse.json({
    apportionSent,
    browserSent: webSent,
    browserSubscriptionsChecked: webPushSubscriptions.length,
    mobileSent: queuedMessages.length,
    sent: queuedMessages.length + webSent + apportionSent,
    tokensChecked: pushTokens.length,
    webPushConfigured: Boolean(process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY?.trim() && process.env.WEB_PUSH_PRIVATE_KEY?.trim()),
    errors: [...new Set(errors)],
  }, { status: errors.length ? 503 : 200 });
}