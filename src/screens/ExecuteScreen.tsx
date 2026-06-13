import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, SectionList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { listAssignments, listTasks, listChains } from '../services/api';
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

export default function ExecuteScreen({ navigation, route }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [chains, setChains] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const loadData = async () => {
    try {
      const [a, t, ch] = await Promise.all([listAssignments(), listTasks(), listChains()]);
      setAssignments(a?.assignments || []);
      setTasks(t?.tasks || []);
      setChains(ch?.chains || []);
    } catch {}
    finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  useFocusEffect(useCallback(() => {
    if (!loaded) setLoading(true);
    loadData();
  }, [loaded]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const runAssignment = (item: any) => {
    // item.id is "${managerId}/${assignmentId}"
    const slash = String(item.id).indexOf('/');
    const assignmentId = slash >= 0 ? String(item.id).slice(slash + 1) : item.id;
    navigation.navigate('LiveOutput', {
      kind: 'assignment',
      managerId: item.managerId,
      assignmentId,
      name: item.name,
    });
  };

  const runTask = (item: any) => {
    navigation.navigate('LiveOutput', {
      kind: 'task',
      agentId: item.agentId || item.id,
      name: item.name,
    });
  };

  const openAssignmentHistory = (item: any) => {
    const slash = String(item.id).indexOf('/');
    const assignmentId = slash >= 0 ? String(item.id).slice(slash + 1) : item.id;
    navigation.navigate('RunHistory', {
      kind: 'assignment',
      managerId: item.managerId,
      assignmentId,
      name: item.name,
    });
  };

  const openTaskHistory = (item: any) => {
    navigation.navigate('RunHistory', {
      kind: 'task',
      agentId: item.agentId || item.id,
      name: item.name,
    });
  };

  const runChain = (item: any) => {
    navigation.navigate('LiveOutput', {
      kind: 'chain',
      chainId: item.id,
      name: item.name,
    });
  };

  const openChainHistory = (item: any) => {
    navigation.navigate('RunHistory', {
      kind: 'chain',
      chainId: item.id,
      name: item.name,
    });
  };

  const assignmentMeta = (item: any) => {
    const sched = item.schedule || 'Manual';
    return `${item.managerName || 'Manager'} • ${sched}`;
  };

  const taskMeta = (item: any) => {
    if (item.status === 'running') return 'Running now';
    return item.schedule ? `Scheduled • ${item.schedule}` : 'Manual';
  };

  const chainMeta = (item: any) => {
    const count = `${item.taskCount || 0} task${item.taskCount === 1 ? '' : 's'}`;
    const sched = item.enabled === false ? 'Disabled' : (item.schedule || 'Manual');
    return `${count} • ${sched}`;
  };

  const LastRunBadge = ({ lastRun }: { lastRun: any }) => {
    if (!lastRun || !lastRun.time) {
      return <Text style={styles.badgeNeutral}>Never run</Text>;
    }
    const ok = lastRun.status === 'completed' || lastRun.status === 'success';
    const dotColor = ok ? c.success : (lastRun.status === 'running' ? c.warning : c.danger);
    const label = lastRun.status === 'running' ? 'Running' : (ok ? 'Last run' : 'Last run failed');
    return (
      <View style={styles.badgeRow}>
        <View style={[styles.badgeDot, { backgroundColor: dotColor }]} />
        <Text style={styles.badgeText}>{label} • {timeAgo(lastRun.time)}</Text>
      </View>
    );
  };

  const assignmentsSection = { title: 'Assignments', count: assignments.length, data: assignments };
  const tasksSection = { title: 'Tasks', count: tasks.length, data: tasks };
  const chainsSection = { title: 'Chains', count: chains.length, data: chains };
  const sections = route?.params?.initialTab === 'tasks'
    ? [tasksSection, chainsSection, assignmentsSection]
    : route?.params?.initialTab === 'chains'
    ? [chainsSection, assignmentsSection, tasksSection]
    : [assignmentsSection, chainsSection, tasksSection];

  if (loading && !loaded) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={c.accent} />
        <Text style={styles.loadingText}>Loading assignments & tasks…</Text>
      </View>
    );
  }

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={{ padding: 12 }}
      sections={sections}
      keyExtractor={(item, i) => `${item.id || i}`}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.countBadge}><Text style={styles.countText}>{section.count}</Text></View>
        </View>
      )}
      renderItem={({ item, section }) => {
        const isAssignment = section.title === 'Assignments';
        const isChain = section.title === 'Chains';
        const running = item.status === 'running';
        const onCardPress = isChain ? () => openChainHistory(item)
          : isAssignment ? () => openAssignmentHistory(item)
          : () => openTaskHistory(item);
        const onRunPress = isChain ? () => runChain(item)
          : isAssignment ? () => runAssignment(item)
          : () => runTask(item);
        const metaText = isChain ? chainMeta(item)
          : isAssignment ? assignmentMeta(item)
          : taskMeta(item);
        return (
          <View style={styles.card}>
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={0.6}
              onPress={onCardPress}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{metaText}</Text>
              <LastRunBadge lastRun={item.lastRun} />
              <Text style={styles.historyHint}>View recent runs ›</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.runBtn, running && styles.runBtnDisabled]}
              disabled={running}
              onPress={onRunPress}
            >
              <Text style={[styles.runBtnText, running && { color: c.warning }]}>{running ? '● Running' : '▶ Run'}</Text>
            </TouchableOpacity>
          </View>
        );
      }}
      ListEmptyComponent={<Text style={styles.empty}>No connected assignments, chains, or tasks</Text>}
      stickySectionHeadersEnabled={false}
    />
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  loadingWrap: { flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: c.textMuted, fontSize: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  countBadge: { marginLeft: 8, backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 11, fontWeight: '700', color: c.accent },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, marginBottom: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  name: { fontSize: 15, fontWeight: '600', color: c.text },
  meta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  badgeDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  badgeText: { fontSize: 11, color: c.textMuted, fontWeight: '500' },
  badgeNeutral: { fontSize: 11, color: c.textMuted, fontWeight: '500', marginTop: 6, fontStyle: 'italic' },
  historyHint: { fontSize: 11, color: c.accent, marginTop: 6, fontWeight: '600' },
  runBtn: { backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 10 },
  runBtnDisabled: { backgroundColor: c.surfaceSoft, borderWidth: 1, borderColor: c.border },
  runBtnText: { color: c.accentFg, fontWeight: '700', fontSize: 13 },
  empty: { textAlign: 'center', color: c.textMuted, fontSize: 15, marginTop: 60 },
});
