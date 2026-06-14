import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { listChatThreads, newChatThread } from '../services/api';
import { useFocusEffect } from '@react-navigation/native';

interface Thread {
  threadId: string;
  targetId: string;
  targetType: string;
  title?: string;
  lastPreview?: string;
  createdAt?: string;
  updatedAt?: string;
}

function relTime(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso.replace(' ', 'T') + (iso.includes('T') ? '' : 'Z')).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

export default function ChatThreadsScreen({ navigation, route }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { targetId, targetType, name, currentThreadId } = route.params;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const resp = await listChatThreads(targetId);
      setThreads(resp?.threads || []);
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

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openThread = (threadId: string) => {
    navigation.navigate('ChatConversation', { targetId, targetType, name, threadId });
  };

  const startNew = async () => {
    try {
      const resp = await newChatThread(targetId, targetType);
      if (resp?.threadId) openThread(resp.threadId);
    } catch {}
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.newBtn} onPress={startNew}>
        <Text style={styles.newBtnText}>＋  New conversation</Text>
      </TouchableOpacity>

      <FlatList
        data={threads}
        keyExtractor={(item) => item.threadId}
        contentContainerStyle={{ padding: 12, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
        renderItem={({ item }) => {
          const active = item.threadId === currentThreadId;
          return (
            <TouchableOpacity style={[styles.card, active && styles.cardActive]} onPress={() => openThread(item.threadId)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{item.title || 'New conversation'}</Text>
                {item.lastPreview ? (
                  <Text style={styles.preview} numberOfLines={2}>{item.lastPreview}</Text>
                ) : null}
                <Text style={styles.meta}>{relTime(item.updatedAt)}{active ? ' • current' : ''}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          loading && !loaded ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={c.accent} />
              <Text style={styles.loadingText}>Loading conversations…</Text>
            </View>
          ) : (
            <Text style={styles.empty}>No saved conversations yet. Start a new one above.</Text>
          )
        }
      />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  newBtn: { margin: 12, marginBottom: 4, backgroundColor: c.accentSoft, borderRadius: 10, borderWidth: 1, borderColor: c.accent, paddingVertical: 12, alignItems: 'center' },
  newBtnText: { color: c.accent, fontSize: 15, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, marginBottom: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  cardActive: { borderColor: c.accent },
  title: { fontSize: 15, fontWeight: '600', color: c.text },
  preview: { fontSize: 13, color: c.textSoft, marginTop: 3, lineHeight: 18 },
  meta: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  chevron: { fontSize: 24, color: c.textMuted, marginLeft: 8 },
  empty: { textAlign: 'center', color: c.textMuted, fontSize: 14, marginTop: 60, paddingHorizontal: 24 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 80 },
  loadingText: { color: c.textMuted, fontSize: 14 },
});
