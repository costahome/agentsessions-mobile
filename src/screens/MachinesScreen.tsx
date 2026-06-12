import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { listMachines, installFromMachine, getListenerMachineId, setListenerMachineId, Machine } from '../services/api';
import { useFocusEffect } from '@react-navigation/native';

function timeAgo(ts: string | null): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (isNaN(diff)) return '';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function MachinesScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [listenerId, setListenerId] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const [res, lid] = await Promise.all([listMachines(), getListenerMachineId()]);
      setMachines(res?.machines || []);
      setSelfId(res?.selfId ?? null);
      setListenerId(lid);
    } catch (e: any) {
      setError(e?.message || 'Failed to load machines');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const doListen = async (machine: Machine) => {
    await setListenerMachineId(machine.machineId);
    setListenerId(machine.machineId);
    Alert.alert('Listener changed', `This device now listens to ${machine.hostname || machine.machineId}. Its agents, managers, chats and tasks are what you'll see across the app.`);
  };

  const doInstall = async (machine: Machine, type: 'agent' | 'manager', id: string, label: string) => {
    const key = `${machine.machineId}:${type}:${id}`;
    setInstalling(key);
    try {
      const res = await installFromMachine(machine.machineId, [{ type, id }]);
      const parts: string[] = [];
      if (res.installed?.length) parts.push(`Installed: ${res.installed.join(', ')}`);
      if (res.skipped?.length) parts.push(`Skipped: ${res.skipped.join(', ')}`);
      if (res.warnings?.length) parts.push(`Warnings:\n• ${res.warnings.join('\n• ')}`);
      Alert.alert(`Install ${label}`, parts.join('\n\n') || 'Done.');
      await load();
    } catch (e: any) {
      Alert.alert('Install failed', e?.message || 'Unknown error');
    } finally {
      setInstalling(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.accent} />
        <Text style={styles.muted}>Loading machines…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
    >
      <Text style={styles.intro}>
        Pick which machine this device listens to — its agents, managers, chats and tasks become
        what you see across the app. Expand a machine to install its agents/managers into another
        machine's namespace.
      </Text>

      {error && (
        <View style={[styles.banner, { borderColor: c.danger }]}>
          <Text style={{ color: c.danger }}>{error}</Text>
        </View>
      )}

      {!error && machines.length === 0 && (
        <View style={styles.banner}>
          <Text style={styles.muted}>No machines found. Cloud sync may be disabled.</Text>
        </View>
      )}

      {machines.map((m) => {
        const isOpen = !!expanded[m.machineId];
        const self = m.isSelf || m.machineId === selfId;
        const isActiveListener = listenerId ? m.machineId === listenerId : m.isLeader;
        return (
          <View key={m.machineId} style={[styles.card, isActiveListener && { borderColor: c.accent }]}>
            <TouchableOpacity
              style={styles.cardHeader}
              onPress={() => setExpanded((p) => ({ ...p, [m.machineId]: !p[m.machineId] }))}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.machineName}>{m.hostname || m.machineId}</Text>
                  {m.isLeader && <Pill text="Leader" color={c.success} c={c} />}
                  {self && <Pill text="this machine" color={c.textMuted} c={c} />}
                  <Pill text={m.alive ? '● online' : '○ offline'} color={m.alive ? c.success : c.textMuted} c={c} />
                </View>
                <Text style={styles.meta}>
                  {m.agentCount} agents · {m.managerCount} managers
                  {m.updatedAt ? ` · updated ${timeAgo(m.updatedAt)}` : ''}
                </Text>
              </View>
              <Text style={styles.chevron}>{isOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            <View style={styles.listenBar}>
              {isActiveListener ? (
                <View style={styles.listeningTag}>
                  <Text style={styles.listeningText}>● Listening here</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.listenBtn} onPress={() => doListen(m)} activeOpacity={0.7}>
                  <Text style={styles.listenText}>Set as listener</Text>
                </TouchableOpacity>
              )}
            </View>

            {isOpen && (
              <View style={styles.body}>
                {m.managers.length > 0 && <Text style={styles.sectionTitle}>Managers</Text>}
                {m.managers.map((mgr) => {
                  const key = `${m.machineId}:manager:${mgr.id}`;
                  return (
                    <Row
                      key={key}
                      icon="🧭"
                      name={mgr.name}
                      sub={mgr.org && mgr.org.length ? `${mgr.org.length} org agents` : 'no org agents'}
                      showInstall={!self}
                      busy={installing === key}
                      onInstall={() => doInstall(m, 'manager', mgr.id, mgr.name)}
                      styles={styles}
                      c={c}
                    />
                  );
                })}

                {m.agents.length > 0 && <Text style={styles.sectionTitle}>Agents</Text>}
                {m.agents.map((a) => {
                  const key = `${m.machineId}:agent:${a.id}`;
                  return (
                    <Row
                      key={key}
                      icon="🤖"
                      name={a.name}
                      sub={a.description || ''}
                      showInstall={!self}
                      busy={installing === key}
                      onInstall={() => doInstall(m, 'agent', a.id, a.name)}
                      styles={styles}
                      c={c}
                    />
                  );
                })}

                {m.agents.length === 0 && m.managers.length === 0 && (
                  <Text style={styles.muted}>This machine hasn't published any agents or managers.</Text>
                )}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function Pill({ text, color, c }: { text: string; color: string; c: Palette }) {
  return (
    <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 6 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color }}>{text}</Text>
    </View>
  );
}

function Row({ icon, name, sub, showInstall, busy, onInstall, styles, c }: any) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{name}</Text>
        {sub ? <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {showInstall && (
        <TouchableOpacity style={styles.installBtn} onPress={onInstall} disabled={busy} activeOpacity={0.7}>
          {busy ? <ActivityIndicator color={c.accentFg} size="small" /> : <Text style={styles.installText}>Install</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, backgroundColor: c.bg, justifyContent: 'center', alignItems: 'center', gap: 10 },
  muted: { color: c.textMuted, fontSize: 13 },
  intro: { color: c.textMuted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
  banner: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 12 },
  card: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, marginBottom: 12, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  machineName: { fontSize: 16, fontWeight: '700', color: c.text },
  meta: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  chevron: { fontSize: 12, color: c.textMuted, marginLeft: 8 },
  listenBar: { paddingHorizontal: 14, paddingBottom: 12, alignItems: 'flex-start' },
  listenBtn: { borderWidth: 1, borderColor: c.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  listenText: { color: c.accent, fontWeight: '700', fontSize: 13 },
  listeningTag: { backgroundColor: c.accentSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  listeningText: { color: c.success, fontWeight: '700', fontSize: 13 },
  body: { borderTopWidth: 1, borderTopColor: c.border, paddingHorizontal: 14, paddingBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  rowIcon: { fontSize: 18, marginRight: 10 },
  rowName: { fontSize: 14, fontWeight: '600', color: c.text },
  rowSub: { fontSize: 12, color: c.textMuted, marginTop: 1 },
  installBtn: { backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, minWidth: 72, alignItems: 'center' },
  installText: { color: c.accentFg, fontWeight: '700', fontSize: 13 },
});
