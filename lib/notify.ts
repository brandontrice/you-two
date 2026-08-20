// Local notifications — fires a banner on this device.
// (True remote push arrives when we graduate from Expo Go to an EAS
// development build; for home-network testing this covers the
// "they submitted!" moment whenever the app is alive.)
import * as Notifications from 'expo-notifications';

export async function ensureNotificationPermission() {
  const settings = await Notifications.getPermissionsAsync();
  if (!settings.granted) {
    await Notifications.requestPermissionsAsync();
  }
}

export async function notify(title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null, // null = fire immediately
    });
  } catch {
    // Never let a notification failure break the app.
  }
}
