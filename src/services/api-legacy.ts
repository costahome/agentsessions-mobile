/**
 * Legacy direct HTTP API — kept for fallback/testing on LAN.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_KEY = '@agent_supervisor_server_url';
let baseUrl: string | null = null;

export async function getServerUrl(): Promise<string | null> {
  if (baseUrl) return baseUrl;
  baseUrl = await AsyncStorage.getItem(SERVER_KEY);
  return baseUrl;
}

export async function setServerUrl(url: string): Promise<void> {
  baseUrl = url.replace(/\/$/, '');
  await AsyncStorage.setItem(SERVER_KEY, baseUrl);
}
