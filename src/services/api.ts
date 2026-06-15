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
const LISTENER_KEY = '@agent_supervisor_listener_machine';
const MACHINES_CACHE_KEY = '@agent_supervisor_machines_cache';

// The machine this device "listens" to — its agents/managers/chats/tasks are what
// the user sees and interacts with. null means "default" (the server leader),
// represented on the wire by the '__leader__' sentinel.
let listenerMachineId: string | null | undefined; // undefined = not yet loaded

export async function getListenerMachineId(): Promise<string | null> {
  if (listenerMachineId !== undefined) return listenerMachineId;
  listenerMachineId = (await AsyncStorage.getItem(LISTENER_KEY)) || null;
  return listenerMachineId;
}

export async function setListenerMachineId(id: string | null): Promise<void> {
  listenerMachineId = id;
  if (id) await AsyncStorage.setItem(LISTENER_KEY, id);
  else await AsyncStorage.removeItem(LISTENER_KEY);
}

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
async function sendAndPoll(body: Record<string, any>, timeoutMs = 60000, targetOverride?: string): Promise<any> {
  const correlationId = `${await getSenderId()}-${Date.now()}-${++seqCounter}`;
  const targetMachineId = targetOverride !== undefined ? targetOverride : ((await getListenerMachineId()) || '__leader__');
  const message = { ...body, correlationId, targetMachineId };

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
  return sendAndPoll({ type: 'list-assignments' }, 15000);
}

export async function listTasks() {
  return sendAndPoll({ type: 'list-tasks' }, 15000);
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
  onUpdate: (update: StreamUpdate) => void,
  threadId?: string
): Promise<any> {
  return sendAndStream(
    { type: 'chat', sessionId, payload: { targetId, targetType, message, threadId } },
    onUpdate,
    300000
  );
}

export type StreamUpdate = {
  type: string;
  status?: string;
  message?: string;
  text?: string;
  isFinal?: boolean;
  phase?: string;
  agentId?: string;
  speaker?: string;
  manager?: string;
  exitCode?: number;
  model?: string;
};

/**
 * Generic send + stream helper. Sends a mobile protocol message and polls the
 * relay, invoking onUpdate for every interim status-update / streaming-chunk,
 * and resolving with the final result payload. Used by chat and live run views.
 *
 * `timeoutMs` is treated as an INACTIVITY window, not an absolute deadline: the
 * timer resets every time an interim message (status-update / streaming-chunk)
 * for this correlation arrives. This lets long-but-active operations (e.g. a
 * manager orchestrating a multi-minute agent run) continue as long as the
 * server keeps sending progress/heartbeat updates, while still failing fast
 * when the server goes truly silent.
 */
export async function sendAndStream(
  body: Record<string, any>,
  onUpdate: (update: StreamUpdate) => void,
  timeoutMs = 180000
): Promise<any> {
  const correlationId = `${await getSenderId()}-${Date.now()}-${++seqCounter}`;
  const targetMachineId = (await getListenerMachineId()) || '__leader__';
  const message = { ...body, correlationId, targetMachineId };

  const sendResp = await relayFetch('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify(message),
  });
  if (!sendResp.ok) {
    const err = await sendResp.text();
    throw new Error(`Send failed (${sendResp.status}): ${err}`);
  }

  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idx = messageBuffer.findIndex((m: any) => m.correlationId === correlationId || m.body?.correlationId === correlationId);
    if (idx >= 0) {
      const match = messageBuffer.splice(idx, 1)[0];
      const raw = match.body || match;

      if (raw && raw.type === 'result' && raw.payload) return raw.payload;
      if (raw && raw.type === 'error') throw new Error(raw.error || raw.payload?.error || 'Server error');

      if (raw && raw.type === 'status-update') {
        deadline = Date.now() + timeoutMs;
        onUpdate({ type: 'status', status: raw.payload?.status, message: raw.payload?.message });
        continue;
      }
      if (raw && raw.type === 'streaming-chunk') {
        deadline = Date.now() + timeoutMs;
        onUpdate({ type: 'chunk', text: raw.payload?.text, isFinal: raw.payload?.isFinal });
        continue;
      }
      if (raw && raw.type === 'agent-step') {
        deadline = Date.now() + timeoutMs;
        onUpdate({
          type: 'agent-step',
          phase: raw.payload?.phase,
          agentId: raw.payload?.agentId,
          speaker: raw.payload?.speaker,
          manager: raw.payload?.manager,
          text: raw.payload?.text,
          exitCode: raw.payload?.exitCode,
          model: raw.payload?.model,
        });
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

export async function getChatHistory(params: { threadId?: string; targetId?: string }) {
  return sendAndPoll({ type: 'get-chat-history', payload: params });
}

/** List saved conversation threads for an agent target. */
export async function listChatThreads(targetId: string) {
  return sendAndPoll({ type: 'list-chat-threads', payload: { targetId } });
}

/** Mint a new conversation thread (copilot session) for an agent target. */
export async function newChatThread(targetId: string, targetType: 'agent' | 'manager' = 'agent') {
  return sendAndPoll({ type: 'new-chat-thread', payload: { targetId, targetType } });
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

// --- Chains (DAG of conditionally-triggered tasks) ---

export interface ChainSummary {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule?: string | null;
  taskCount: number;
  lastRun?: { id: string; status: string; time: string | null } | null;
}

export async function listChains(): Promise<{ chains: ChainSummary[] }> {
  return sendAndPoll({ type: 'list-chains' }, 15000);
}

/**
 * Run a chain with live streaming output. Streams per-task status and output
 * chunks via onUpdate, resolving with the final aggregated result payload.
 */
export async function runChainStreaming(
  chainId: string,
  onUpdate: (update: StreamUpdate) => void
): Promise<any> {
  return sendAndStream({ type: 'run-chain', payload: { chainId } }, onUpdate, 900000);
}

export async function getChainRuns(chainId: string, limit = 20) {
  return sendAndPoll({ type: 'get-chain-runs', payload: { chainId, limit } });
}

export async function getChainRun(runId: string) {
  return sendAndPoll({ type: 'get-chain-run', payload: { runId } });
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
  lastSeen: string | null;
  updatedAt: string | null;
  agentCount: number;
  managerCount: number;
  agents: MachineCatalogAgent[];
  managers: MachineCatalogManager[];
}

export async function listMachines(): Promise<{ machines: Machine[]; selfId: string | null }> {
  // Route to the shared queue ('__leader__') so ANY alive machine can answer —
  // never pin machine discovery to the chosen listener, which may be the one
  // that's offline. This keeps the Machines picker usable for recovery.
  const res = await sendAndPoll({ type: 'list-machines' }, 15000, '__leader__');
  // Cache the last-known machine list so the picker still works when the relay
  // or every machine is unreachable — the user keeps visibility into machines,
  // their last heartbeat, and can re-point this device's listener for when
  // connectivity returns (the choice is stored locally and applied on reconnect).
  if (res && Array.isArray(res.machines)) {
    try {
      await AsyncStorage.setItem(
        MACHINES_CACHE_KEY,
        JSON.stringify({ machines: res.machines, selfId: res.selfId ?? null, cachedAt: Date.now() })
      );
    } catch {
      // best-effort cache; ignore write failures
    }
  }
  return res;
}

/**
 * Last successfully-fetched machine list, persisted across launches. Returned
 * when a live `listMachines()` fails (relay/listener unreachable) so the
 * Machines screen can still render a stale-but-useful snapshot.
 */
export async function getCachedMachines(): Promise<{ machines: Machine[]; selfId: string | null; cachedAt: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(MACHINES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.machines)) return parsed;
    return null;
  } catch {
    return null;
  }
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

export type ConnState = 'authorized' | 'unauthorized' | 'offline' | 'listener-unreachable';

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

    // Distinguish a genuine token rejection (relay reachable, returns 401/403)
    // from a true network/relay outage. A rejected token must route to the
    // re-pair flow, not a misleading "offline".
    let relayStatus = 0;
    try {
      relayStatus = (await relayFetch('/api/auth-test')).status;
    } catch {
      relayStatus = 0; // network error / relay unreachable
    }
    if (relayStatus === 401 || relayStatus === 403) return { state: 'unauthorized' };
    if (relayStatus !== 200) return { state: 'offline' };

    try {
      const status = await getStatus();
      return { state: 'authorized', status };
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/unauthori[sz]ed|approved user/i.test(msg)) return { state: 'unauthorized' };
      // Relay is reachable (auth-test passed) but the target listener machine
      // didn't answer — it's likely offline. Distinguish this from a true relay
      // outage so the UI can still offer access to the Machines picker.
      return { state: 'listener-unreachable' };
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
