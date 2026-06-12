import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { getStatus, probeStatus, ConnState } from '../services/api';
import { useFocusEffect } from '@react-navigation/native';

function timeAgo(ts: string | number | null): string {
  if (!ts) return '';
  const then = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const diff = Date.now() - then;
  if (isNaN(diff)) return '';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function HomeScreen({ navigation }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [status, setStatus] = useState<any>(null);
  const [connState, setConnState] = useState<ConnState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const { state, status: s } = await probeStatus();
    setConnState(state);
    if (state === 'authorized' && s) setStatus(s);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (connState === 'unauthorized') {
    return (
      <View style={styles.center}>
        <View style={styles.disconnectCard}>
          <Text style={styles.bigIcon}>🔒</Text>
          <Text style={styles.title}>Access Not Approved</Text>
          <Text style={styles.subtitle}>
            This device is paired, but your user isn't approved on the server. Ask an admin to add
            you under RBAC, then re-scan the pairing QR code to reconnect.
          </Text>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.buttonText}>Re-scan QR Code</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (connState === 'offline') {
    return (
      <View style={styles.center}>
        <View style={styles.disconnectCard}>
          <Text style={styles.bigIcon}>📡</Text>
          <Text style={styles.title}>Not Connected</Text>
          <Text style={styles.subtitle}>Go to Settings to pair with your server</Text>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.buttonText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const running = status?.runningAgents || [];
  const counts = status?.activityCounts || {};

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingTop: 56 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.header}>Agent Supervisor</Text>
        <View style={[styles.badge, { backgroundColor: c.accentSoft }]}>
          <Text style={[styles.badgeText, { color: connState === 'authorized' ? c.success : c.textMuted }]}>
            {connState === 'authorized' ? '● Connected' : '○ Offline'}
          </Text>
        </View>
      </View>

      <LeaderBanner leader={status?.leader} styles={styles} c={c} />

      <View style={styles.quickActions}>
        <QuickAction icon="💬" label="Chat" onPress={() => navigation.navigate('Chat')} styles={styles} />
        <QuickAction icon="▶️" label="Execute" onPress={() => navigation.navigate('Execute')} styles={styles} />
        <QuickAction icon="📊" label="Activity" onPress={() => navigation.navigate('Activity')} styles={styles} />
      </View>

      <View style={styles.statsGrid}>
        <StatBox value={status?.managerCount ?? '—'} label="Managers" icon="🧭"
          onPress={() => navigation.navigate('Chat', { screen: 'ChatList', params: { initialTab: 'managers' } })} styles={styles} />
        <StatBox value={status?.agentCount ?? '—'} label="Agents" icon="🤖"
          onPress={() => navigation.navigate('Chat', { screen: 'ChatList', params: { initialTab: 'agents' } })} styles={styles} />
        <StatBox value={status?.assignmentCount ?? '—'} label="Assignments" icon="📋"
          onPress={() => navigation.navigate('Execute', { screen: 'ExecuteMain', params: { initialTab: 'assignments' } })} styles={styles} />
        <StatBox value={status?.taskCount ?? status?.agentCount ?? '—'} label="Tasks" icon="⚡"
          onPress={() => navigation.navigate('Execute', { screen: 'ExecuteMain', params: { initialTab: 'tasks' } })} styles={styles} />
      </View>

      {running.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Running Now</Text>
          {running.map((r: any, i: number) => (
            <View key={i} style={styles.card}>
              <Text style={styles.cardIcon}>🔍</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{r.name || r.id}</Text>
                <Text style={styles.cardMeta}>{r.startedAt ? `Started ${timeAgo(r.startedAt)}` : 'Running'}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                <Text style={[styles.badgeText, { color: c.warning }]}>● Running</Text>
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={styles.sectionTitle}>Today</Text>
      <View style={styles.statsRow}>
        <StatBox value={counts.success ?? 0} label="Success" color={c.success} borderColor="rgba(22,163,74,0.3)" styles={styles} />
        <StatBox value={counts.failed ?? 0} label="Failed" color={c.danger} borderColor="rgba(220,38,38,0.3)" styles={styles} />
        <StatBox value={counts.running ?? 0} label="Running" color={c.warning} borderColor="rgba(245,158,11,0.3)" styles={styles} />
      </View>
    </ScrollView>
  );
}

function LeaderBanner({ leader, styles, c }: any) {
  // Older servers may not send leader info — show a neutral "unknown" notice
  // so the user is never misled into thinking events are handled.
  if (!leader) {
    return (
      <View style={[styles.leaderBanner, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.leaderDot, { color: c.textMuted }]}>○</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.leaderTitle}>Leader status unknown</Text>
          <Text style={styles.leaderSub}>This server build doesn't report leader health.</Text>
        </View>
      </View>
    );
  }

  const active = !!leader.eventsActive;
  const standalone = leader.syncEnabled === false;
  const tint = active ? c.success : c.danger;
  const bg = active ? 'rgba(22,163,74,0.10)' : 'rgba(220,38,38,0.12)';
  const border = active ? 'rgba(22,163,74,0.35)' : 'rgba(220,38,38,0.45)';

  let title: string;
  if (!active) title = '⚠️ No active leader';
  else if (standalone) title = '● Events active · Standalone';
  else if (leader.isLeader) title = '● Events active · This machine is leader';
  else title = '● Events active';

  // Which machine is in charge of events, and which one we're talking to.
  const connectedTo = leader.thisHostname || '—';
  let sub: string;
  if (!active) {
    sub = `No machine is handling scheduled events. Connected to ${connectedTo}.`;
  } else if (standalone || leader.isLeader) {
    sub = `Connected to ${connectedTo}`;
  } else {
    const lh = leader.leaderHostname || 'unknown';
    const age = leader.staleSeconds != null ? ` · heartbeat ${leader.staleSeconds}s ago` : '';
    sub = `Leader: ${lh}${age} · Connected to ${connectedTo}`;
  }

  return (
    <View style={[styles.leaderBanner, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.leaderDot, { color: tint }]}>{active ? '●' : '▲'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.leaderTitle, { color: tint }]}>{title}</Text>
        <Text style={styles.leaderSub}>{sub}</Text>
      </View>
    </View>
  );
}

function QuickAction({ icon, label, onPress, styles }: any) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress}>
      <Text style={styles.qaIcon}>{icon}</Text>
      <Text style={styles.qaLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function StatBox({ value, label, color, borderColor, icon, onPress, styles }: any) {
  const content = (
    <>
      {icon ? <Text style={styles.statIcon}>{icon}</Text> : null}
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity style={[styles.navStatBox, borderColor && { borderColor }]} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.statBox, borderColor && { borderColor }]}>{content}</View>;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, backgroundColor: c.bg, justifyContent: 'center', padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  header: { fontSize: 22, fontWeight: '700', color: c.text },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  leaderBanner: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 16 },
  leaderDot: { fontSize: 16, marginRight: 10, fontWeight: '700' },
  leaderTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  leaderSub: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  quickActions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  quickAction: { flex: 1, backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingVertical: 16, alignItems: 'center' },
  qaIcon: { fontSize: 26, marginBottom: 6 },
  qaLabel: { fontSize: 13, fontWeight: '600', color: c.text },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  statBox: { flex: 1, backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingVertical: 16, alignItems: 'center' },
  navStatBox: { width: '47.8%', flexGrow: 1, backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingVertical: 18, alignItems: 'center' },
  statIcon: { fontSize: 22, marginBottom: 4 },
  statValue: { fontSize: 26, fontWeight: '700', color: c.accent },
  statLabel: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 8 },
  cardIcon: { fontSize: 22, marginRight: 12 },
  cardName: { fontSize: 15, fontWeight: '600', color: c.text },
  cardMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  disconnectCard: { backgroundColor: c.surface, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.border },
  bigIcon: { fontSize: 44, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '600', color: c.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: c.textMuted, textAlign: 'center', marginBottom: 16 },
  button: { backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  buttonText: { color: c.accentFg, fontWeight: '600' },
});
