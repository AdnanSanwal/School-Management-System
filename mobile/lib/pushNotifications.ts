import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { API } from './api';
import { useAuthStore } from '../store/authStore';

/**
 * Asks for permission, gets this phone's Expo push token and registers it for the
 * signed-in user. Safe to call on every login; does nothing on web/simulators.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'School updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;

  const projectId = process.env.EXPO_PUBLIC_PROJECT_ID ?? Constants.expoConfig?.extra?.eas?.projectId;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await API.registerDevice(token, Platform.OS);
    useAuthStore.getState().setPushToken(token);
    return token;
  } catch {
    return null; // the app works without push
  }
}

/** On logout: stop sending this user's notifications to this phone. */
export async function unregisterPush() {
  const token = useAuthStore.getState().pushToken;
  if (token) await API.unregisterDevice(token).catch(() => {});
  useAuthStore.getState().setPushToken(null);
}
