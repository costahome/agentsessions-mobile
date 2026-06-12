/**
 * API service for communicating with the Agent Supervisor server
 * via the Azure Container App relay service.
 * 
 * Authentication uses a pairing token issued during QR code scan.
 * No Azure AD required — works from any device, any network.
 * 
 * Architecture:
 *   Phone → sends to relay (HTTPS + pairing token)
 *   Server → polls relay for inbound, sends replies back
 *   Phone → polls relay for replies
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const CONFIG_KEY = '@agent_supervisor_relay_config';
const TOKEN_KEY = '@agent_supervisor_device_token';

export interface RelayConfig {
  relayUrl: string;       // e.g. "https://relay-agentsessions.lemondune-11ff5970.westus2.azurecontainerapps.io"
  deviceToken: string;    // pairing token from QR scan
  userId?: string;
}

let config: RelayConfig | null = null;
let persistedSenderId: string | null = null;

export async function getSenderId(): Promise<string> {
  if (persistedSenderId) return persistedSenderId;
  const stored = await AsyncStorage.getItem('@agent_supervisor_sender_id');
  if (stored) {
    persistedSenderId = stored;
    return stored;
  }
  persistedSenderId = `mobile-${Platform.OS}-${Date.now().toString(36)}`;
  await AsyncStorage.setItem('@agent_supervisor_sender_id', persistedSenderId);
  return persistedSenderId;
}

export async function getConfig(): Promise<RelayConfig | null> {
  if (config) return config;
  const raw = await AsyncStorage.getItem(CONFIG_KEY);
  if (raw) config = JSON.parse(raw);
  return config;
}

export async function setConfig(c: RelayConfig): Promise<void> {
  config = c;
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

export async function isConfigured(): Promise<boolean> {
  const c = await getConfig();
  return !!(c && c.relayUrl && c.deviceToken);
}

export async function isPaired(): Promise<boolean> {
  return isConfigured();
}

/**
 * Make an authenticated request to the relay
 */
async function relayFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const c = await getConfig();
  if (!c) throw new Error('Not configured. Scan the pairing QR code first.');

  const url = `${c.relayUrl}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${c.deviceToken}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  return fetch(url, { ...options, headers });
}

// Shared message buffer — polled messages land here so concurrent requests can each find their reply
const messageBuffer: any[] = [];
let pollingInProgress = false;
let seqCounter = 0;

/**
 * Send a mobile protocol message via relay and poll for response
 */
async function sendAndPoll(body: Record<string, any>, timeoutMs = 60000): Promise<any> {
  const correlationId = `${await getSenderId()}-${Date.now()}-${++seqCounter}`;
  const message = { ...body, correlationId };

  // Send to relay
  const sendResp = await relayFetch('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify(message),
  });

  if (!sendResp.ok) {
    const err = await sendResp.text();
    throw new Error(`Send failed (${sendResp.status}): ${err}`);
  }

  // Poll for reply — uses shared buffer
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Check buffer for our correlationId
    const idx = messageBuffer.findIndex((m: any) => m.correlationId === correlationId || m.body?.correlationId === correlationId);
    if (idx >= 0) {
      const match = messageBuffer.splice(idx, 1)[0];
      const raw = match.body || match;
      // Only resolve on final messages (result/error). Skip status-update/streaming-chunk.
      if (raw && raw.type === 'result' && raw.payload) return raw.payload;
      if (raw && raw.type === 'error') throw new Error(raw.error || raw.payload?.error || 'Server error');
      if (raw && (raw.type === 'status-update' || raw.type === 'streaming-chunk')) {
        // Interim message — ignore and keep polling for the final result
        continue;
      }
      return raw;
    }

    // Only one poller at a time to avoid draining the relay queue multiple times
    if (!pollingInProgress) {
      pollingInProgress = true;
      try {
        const pollResp = await relayFetch('/api/messages/poll');
        if (pollResp.ok) {
          const data = await pollResp.json();
          if (data.messages && data.messages.length > 0) {
            messageBuffer.push(...data.messages);
          }
        }
      } finally {
        pollingInProgress = false;
      }
    }

    await sleep(1500);
  }
  throw new Error('Request timed out waiting for response');
}

// --- Public API ---

export async function listManagers() {
  return sendAndPoll({ type: 'list-managers' });
}

export async function listAgents() {
  return sendAndPoll({ type: 'list-agents' });
}

export async function listAssignments() {
  return sendAndPoll({ type: 'list-assignments' });
}

export async function listTasks() {
  return sendAndPoll({ type: 'list-tasks' });
}

export async function runAssignment(managerId: string, assignmentId: string) {
  return sendAndPoll({ type: 'run-assignment', payload: { managerId, assignmentId } }, 120000);
}

export async function runAgent(agentId: string, prompt?: string) {
  return sendAndPoll({ type: 'run-agent', payload: { agentId, prompt } }, 120000);
}

export async function sendChat(targetId: string, targetType: 'agent' | 'manager', message: string, sessionId?: string) {
  return sendAndPoll({ type: 'chat', sessionId, payload: { targetId, targetType, message } }, 120000);
}

/**
 * Send a chat message with streaming callback for real-time status updates.
 * The onUpdate callback fires for status-update and streaming-chunk messages.
 * Returns the final result.
 */
export async function sendChatStreaming(
  targetId: string,
  targetType: 'agent' | 'manager',
  message: string,
  sessionId: string | undefined,
  onUpdate: (update: { type: string; status?: string; message?: string; text?: string; isFinal?: boolean }) => void
): Promise<any> {
  return sendAndStream(
    { type: 'chat', sessionId, payload: { targetId, targetType, message } },
    onUpdate,
    180000
  );
}

export type StreamUpdate = {
  type: string;
  status?: string;
  message?: string;
  text?: string;
  isFinal?: boolean;
};

/**
 * Generic send + stream helper. Sends a mobile protocol message and polls the
 * relay, invoking onUpdate for every interim status-update / streaming-chunk,
 * and resolving with the final result payload. Used by chat and live run views.
 */
export async function sendAndStream(
  body: Record<string, any>,
  onUpdate: (update: StreamUpdate) => void,
  timeoutMs = 180000
): Promise<any> {
  const correlationId = `${await getSenderId()}-${Date.now()}-${++seqCounter}`;
  const message = { ...body, correlationId };

  const sendResp = await relayFetch('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify(message),
  });
  if (!sendResp.ok) {
    const err = await sendResp.text();
    throw new Error(`Send failed (${sendResp.status}): ${err}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idx = messageBuffer.findIndex((m: any) => m.correlationId === correlationId || m.body?.correlationId === correlationId);
    if (idx >= 0) {
      const match = messageBuffer.splice(idx, 1)[0];
      const raw = match.body || match;

      if (raw && raw.type === 'result' && raw.payload) return raw.payload;
      if (raw && raw.type === 'error') throw new Error(raw.error || raw.payload?.error || 'Server error');

      if (raw && raw.type === 'status-update') {
        onUpdate({ type: 'status', status: raw.payload?.status, message: raw.payload?.message });
        continue;
      }
      if (raw && raw.type === 'streaming-chunk') {
        onUpdate({ type: 'chunk', text: raw.payload?.text, isFinal: raw.payload?.isFinal });
        continue;
      }
      return raw;
    }

    if (!pollingInProgress) {
      pollingInProgress = true;
      try {
        const pollResp = await relayFetch('/api/messages/poll');
        if (pollResp.ok) {
          const data = await pollResp.json();
          if (data.messages && data.messages.length > 0) {
            messageBuffer.push(...data.messages);
          }
        }
      } finally {
        pollingInProgress = false;
      }
    }

    await sleep(1500);
  }
  throw new Error('Request timed out waiting for response');
}

/**
 * Run an agent with live streaming output.
 */
export async function runAgentStreaming(
  agentId: string,
  prompt: string | undefined,
  onUpdate: (update: StreamUpdate) => void
): Promise<any> {
  return sendAndStream({ type: 'run-agent', payload: { agentId, prompt } }, onUpdate, 300000);
}

/**
 * Run a manager assignment with live streaming output.
 */
export async function runAssignmentStreaming(
  managerId: string,
  assignmentId: string,
  onUpdate: (update: StreamUpdate) => void
): Promise<any> {
  return sendAndStream({ type: 'run-assignment', payload: { managerId, assignmentId } }, onUpdate, 300000);
}

export async function listChats() {
  return sendAndPoll({ type: 'list-chats' });
}

export async function getChatHistory(chatId: string) {
  return sendAndPoll({ type: 'get-chat-history', payload: { chatId } });
}

export async function getActivity(limit = 50) {
  return sendAndPoll({ type: 'get-activity', payload: { limit } });
}

/**
 * Get recent runs for a single task (agent) or assignment (manager+assignment).
 * Returns { runs: [...] } where each run matches the ActivityDetail item shape.
 */
export async function getRunHistory(params: {
  kind: 'task' | 'assignment';
  agentId?: string;
  managerId?: string;
  assignmentId?: string;
  limit?: number;
}) {
  return sendAndPoll({ type: 'get-run-history', payload: { limit: 20, ...params } });
}

export async function getStatus() {
  return sendAndPoll({ type: 'get-status' }, 15000);
}

// --- Machines (cross-machine browse + install) ---

export interface MachineCatalogAgent { id: string; name: string; description?: string }
export interface MachineCatalogManager { id: string; name: string; org?: string[] }
export interface Machine {
  machineId: string;
  hostname: string | null;
  isSelf: boolean;
  isLeader: boolean;
  alive: boolean;
  updatedAt: string | null;
  agentCount: number;
  managerCount: number;
  agents: MachineCatalogAgent[];
  managers: MachineCatalogManager[];
}

export async function listMachines(): Promise<{ machines: Machine[]; selfId: string | null }> {
  return sendAndPoll({ type: 'list-machines' });
}

export async function installFromMachine(
  machineId: string,
  items: { type: 'agent' | 'manager'; id: string }[]
): Promise<{ ok: boolean; installed: string[]; skipped: string[]; warnings: string[] }> {
  return sendAndPoll({ type: 'install-from-machine', payload: { machineId, items } }, 120000);
}

export async function checkConnection(): Promise<boolean> {
  try {
    const configured = await isConfigured();
    if (!configured) return false;
    // Just test auth against the relay
    const resp = await relayFetch('/api/auth-test');
    return resp.ok;
  } catch {
    return false;
  }
}

export type ConnState = 'authorized' | 'unauthorized' | 'offline';

/**
 * Probe true connection + authorization state.
 *  - 'offline'      : not configured, relay unreachable, or server not responding
 *  - 'unauthorized' : relay pairing is valid but the server's RBAC denies this user
 *                     (device must be re-approved + re-paired via QR)
 *  - 'authorized'   : fully connected; `status` holds the dashboard payload
 *
 * The relay pairing token alone is NOT proof of access — the server enforces
 * RBAC and rejects unapproved users, so we verify with a real get-status call.
 */
export async function probeStatus(): Promise<{ state: ConnState; status?: any }> {
  try {
    const configured = await isConfigured();
    if (!configured) return { state: 'offline' };

    let relayOk = false;
    try {
      relayOk = (await relayFetch('/api/auth-test')).ok;
    } catch {
      relayOk = false;
    }
    if (!relayOk) return { state: 'offline' };

    try {
      const status = await getStatus();
      return { state: 'authorized', status };
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/unauthori[sz]ed|approved user/i.test(msg)) return { state: 'unauthorized' };
      return { state: 'offline' };
    }
  } catch {
    return { state: 'offline' };
  }
}

export async function getConnectionState(): Promise<ConnState> {
  return (await probeStatus()).state;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
