import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { type MobileAuthSession } from "../auth/session";

function getApiBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
}

function getProjectId() {
  return Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId ?? null;
}

function isPermissionGranted(permission: unknown) {
  const permissionRecord = permission as { granted?: boolean; status?: string };

  return permissionRecord.granted === true || permissionRecord.status === "granted";
}

async function ensureAndroidNotificationChannel() {
  if (Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync("default", {
    importance: Notifications.AndroidImportance.DEFAULT,
    name: "Default",
  });
}

export async function registerMobilePushToken(session: MobileAuthSession) {
  if (!Device.isDevice) {
    return { registered: false, reason: "Push notifications require a physical device." };
  }

  await ensureAndroidNotificationChannel();

  const existingPermissions = await Notifications.getPermissionsAsync();
  const finalPermissions = isPermissionGranted(existingPermissions)
    ? existingPermissions
    : await Notifications.requestPermissionsAsync();

  if (!isPermissionGranted(finalPermissions)) {
    return { registered: false, reason: "Notification permission was not granted." };
  }

  const projectId = getProjectId();
  const pushToken = projectId
    ? await Notifications.getExpoPushTokenAsync({ projectId })
    : await Notifications.getExpoPushTokenAsync();
  const response = await fetch(`${getApiBaseUrl()}/api/user/push-tokens`, {
    body: JSON.stringify({
      deviceName: Device.deviceName ?? null,
      platform: Platform.OS,
      token: pushToken.data,
    }),
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      "Content-Type": "application/json",
      "X-TRAPit-Access-Token": session.accessToken,
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Unable to register push notifications.");
  }

  return { registered: true, token: pushToken.data };
}