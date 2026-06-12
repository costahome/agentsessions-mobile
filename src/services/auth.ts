import AsyncStorage from '@react-native-async-storage/async-storage';

const TENANT_ID = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const CLIENT_ID = 'e1b26c82-d012-44a9-a754-9a3c0b1d9589';
const SERVICE_BUS_SCOPE = 'https://servicebus.azure.net/.default';
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const DEVICE_CODE_ENDPOINT = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`;

const STORAGE_KEY = 'msal_tokens';

interface TokenCache {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  userId?: string;
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  message: string;
  deviceCode: string;
  expiresIn: number;
  interval: number;
}

let cachedTokens: TokenCache | null = null;
let pollAbort: AbortController | null = null;

/**
 * Step 1: Request a device code. Show userCode and verificationUri to the user.
 */
export async function requestDeviceCode(): Promise<DeviceCodeInfo> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: `${SERVICE_BUS_SCOPE} openid profile offline_access`,
  });

  const resp = await fetch(DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Device code request failed: ${err}`);
  }

  const data = await resp.json();
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    message: data.message,
    deviceCode: data.device_code,
    expiresIn: data.expires_in,
    interval: data.interval || 5,
  };
}

/**
 * Step 2: Poll for token after user completes sign-in on another device.
 * Resolves when auth succeeds, rejects on expiry/cancel.
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<{ accessToken: string; userId?: string }> {
  pollAbort = new AbortController();
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    if (pollAbort.signal.aborted) {
      throw new Error('Login cancelled');
    }

    await sleep(interval * 1000);

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    });

    const resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = await resp.json();

    if (resp.ok) {
      // Success!
      const tokens: TokenCache = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || undefined,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        userId: data.id_token ? parseUPN(data.id_token) : undefined,
      };
      cachedTokens = tokens;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
      pollAbort = null;
      return { accessToken: tokens.accessToken, userId: tokens.userId };
    }

    if (data.error === 'authorization_pending') {
      continue; // keep polling
    } else if (data.error === 'slow_down') {
      interval += 5; // back off
      continue;
    } else {
      // expired, declined, or other error
      pollAbort = null;
      throw new Error(data.error_description || data.error || 'Authentication failed');
    }
  }

  pollAbort = null;
  throw new Error('Device code expired');
}

export function cancelLogin() {
  pollAbort?.abort();
}

export async function getAccessToken(): Promise<string | null> {
  if (cachedTokens && cachedTokens.expiresAt > Date.now() + 60000) {
    return cachedTokens.accessToken;
  }

  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    cachedTokens = JSON.parse(stored);
    if (cachedTokens && cachedTokens.expiresAt > Date.now() + 60000) {
      return cachedTokens.accessToken;
    }
    if (cachedTokens?.refreshToken) {
      return await refreshAccessToken(cachedTokens.refreshToken);
    }
  }

  return null;
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: `${SERVICE_BUS_SCOPE} openid profile offline_access`,
    });

    const resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) throw new Error('Refresh failed');

    const data = await resp.json();
    const tokens: TokenCache = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      userId: cachedTokens?.userId,
    };

    cachedTokens = tokens;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    return tokens.accessToken;
  } catch (e) {
    cachedTokens = null;
    await AsyncStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export async function logout() {
  cachedTokens = null;
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function isLoggedIn(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

export async function getUserId(): Promise<string | null> {
  if (cachedTokens?.userId) return cachedTokens.userId;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    const tokens = JSON.parse(stored) as TokenCache;
    return tokens.userId || null;
  }
  return null;
}

function parseUPN(idToken: string): string | undefined {
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1]));
    return payload.preferred_username || payload.upn || payload.email;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
