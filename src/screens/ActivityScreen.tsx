import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { getActivity } from '../services/api';
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

export default function ActivityScreen({ navigation }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [items, setItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const resp = await getActivity(50);
      setItems(resp?.activity || []);
    } catch {}
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const statusGlyph = (status: string) => {
    if (status === 'completed' || status === 'success') return { icon: '✓', color: c.success };
    if (status === 'failed') return { icon: '✗', color: c.danger };
    if (status === 'running') return { icon: '●', color: c.warning };
    return { icon: '•', color: c.textMuted };
  };

  const metaLine = (item: any) => {
    const kind = item.trigger && item.trigger !== 'direct' ? item.trigger : 'task';
    if (item.status === 'running') return `${kind} • Running`;
    if (item.status === 'failed') {
      return `${kind} • Failed${item.durationMs != null ? ` ${(item.durationMs / 1000).toFixed(1)}s` : ''}`;
    }
    return `${kind} • ${item.durationMs != null ? `${(item.durationMs / 1000).toFixed(1)}s` : 'done'}`;
  };

  const renderItem = ({ item }: { item: any }) => {
    const g = statusGlyph(item.status);
    return (
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('ActivityDetail', { item })}>
        <Text style={[styles.glyph, { color: g.color }]}>{g.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{item.name || item.agentId}</Text>
          <Text style={styles.meta}>{metaLine(item)}</Text>
        </View>
        <Text style={styles.time}>{timeAgo(item.createdAt || item.timestamp)}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={items.length === 0 ? { flex: 1, justifyContent: 'center' } : { padding: 12 }}
      data={items}
      renderItem={renderItem}
      keyExtractor={(item, i) => String(item.id ?? i)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
      ListEmptyComponent={<Text style={styles.empty}>No recent activity</Text>}
    />
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border },
  glyph: { width: 24, textAlign: 'center', fontSize: 15, fontWeight: '700', marginRight: 8 },
  name: { fontSize: 15, fontWeight: '600', color: c.text },
  meta: { fontSize: 12, color: c.textMuted, marginTop: 2, textTransform: 'capitalize' },
  time: { fontSize: 11, color: c.textMuted, marginLeft: 8 },
  empty: { textAlign: 'center', color: c.textMuted, fontSize: 15 },
});
