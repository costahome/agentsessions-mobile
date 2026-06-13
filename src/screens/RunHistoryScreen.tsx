import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { getRunHistory, getChainRuns, getChainRun } from '../services/api';
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

/**
 * Recent-runs list for a single task, assignment, or chain. Route params:
 *   { kind: 'task'|'assignment'|'chain', name, agentId?, managerId?, assignmentId?, chainId? }
 * Tapping a run opens ActivityDetail (markdown output + share).
 */
export default function RunHistoryScreen({ navigation, route }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { kind, name, agentId, managerId, assignmentId, chainId } = route.params || {};

  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = async () => {
    try {
      if (kind === 'chain') {
        const resp = await getChainRuns(chainId, 20);
        setRuns(resp?.runs || []);
      } else {
        const resp = await getRunHistory({ kind, agentId, managerId, assignmentId, limit: 20 });
        setRuns(resp?.runs || []);
      }
    } catch {}
    finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  useFocusEffect(useCallback(() => {
    if (!loaded) setLoading(true);
    load();
  }, [loaded]));

  React.useEffect(() => {
    navigation.setOptions({ title: name || 'Recent Runs' });
  }, [navigation, name]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const statusGlyph = (status: string) => {
    if (status === 'completed' || status === 'success' || status === 'succeeded') return { icon: '✓', color: c.success };
    if (status === 'failed' || status === 'error') return { icon: '✗', color: c.danger };
    if (status === 'running') return { icon: '●', color: c.warning };
    return { icon: '•', color: c.textMuted };
  };

  const metaLine = (item: any) => {
    if (item.status === 'running') return 'Running';
    const dur = item.durationMs != null ? `${(item.durationMs / 1000).toFixed(1)}s` : null;
    const failed = item.status === 'failed' || item.status === 'error';
    if (failed) return dur ? `Failed • ${dur}` : 'Failed';
    return dur ? `Completed • ${dur}` : 'Completed';
  };

  const openRun = async (item: any) => {
    if (kind === 'chain') {
      try {
        setOpeningId(String(item.id));
        const detail = await getChainRun(item.id);
        navigation.navigate('RunDetail', { item: { ...item, name, output: detail?.output || '' } });
      } catch (e: any) {
        navigation.navigate('RunDetail', { item: { ...item, name, output: `Failed to load flow output: ${e.message}` } });
      } finally {
        setOpeningId(null);
      }
    } else {
      navigation.navigate('RunDetail', { item: { ...item, name } });
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const g = statusGlyph(item.status);
    const opening = openingId === String(item.id);
    return (
      <TouchableOpacity
        style={styles.card}
        disabled={opening}
        onPress={() => openRun(item)}
      >
        <Text style={[styles.glyph, { color: g.color }]}>{g.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{metaLine(item)}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
          </Text>
        </View>
        {opening
          ? <ActivityIndicator size="small" color={c.accent} style={{ marginLeft: 8 }} />
          : <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>}
      </TouchableOpacity>
    );
  };

  if (loading && !loaded) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={c.accent} />
        <Text style={styles.loadingText}>Loading recent runs…</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={runs.length === 0 ? { flex: 1, justifyContent: 'center' } : { padding: 12 }}
      data={runs}
      renderItem={renderItem}
      keyExtractor={(item, i) => String(item.id ?? i)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
      ListEmptyComponent={<Text style={styles.empty}>No runs recorded yet</Text>}
    />
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  loadingWrap: { flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: c.textMuted, fontSize: 14 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border },
  glyph: { width: 24, textAlign: 'center', fontSize: 15, fontWeight: '700', marginRight: 8 },
  name: { fontSize: 15, fontWeight: '600', color: c.text },
  meta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  time: { fontSize: 11, color: c.textMuted, marginLeft: 8 },
  empty: { textAlign: 'center', color: c.textMuted, fontSize: 15 },
});
