import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { listManagers, listAgents } from '../services/api';
import { useFocusEffect } from '@react-navigation/native';

type Tab = 'managers' | 'agents';

export default function ChatListScreen({ navigation, route }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [tab, setTab] = useState<Tab>(route?.params?.initialTab === 'agents' ? 'agents' : 'managers');
  const [managers, setManagers] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');

  React.useEffect(() => {
    const t = route?.params?.initialTab;
    if (t === 'agents' || t === 'managers') setTab(t);
  }, [route?.params?.initialTab]);

  const loadData = async () => {
    try {
      const [m, a] = await Promise.all([listManagers(), listAgents()]);
      setManagers(m?.managers || []);
      setAgents(a?.agents || []);
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

  const openChat = (targetId: string, targetType: 'agent' | 'manager', name: string) => {
    navigation.navigate('ChatConversation', { targetId, targetType, name });
  };

  const managerMeta = (m: any) => {
    const a = m.agentCount ?? 0;
    const asg = m.assignmentCount ?? 0;
    return `${a} agent${a === 1 ? '' : 's'} • ${asg} assignment${asg === 1 ? '' : 's'}`;
  };

  const agentMeta = (a: any) => {
    if (a.status === 'running') return 'Running now';
    if (a.schedule) return `Scheduled • ${a.schedule}`;
    return 'Manual';
  };

  const all = tab === 'managers' ? managers : agents;
  const q = query.trim().toLowerCase();
  const data = q
    ? all.filter((x: any) =>
        String(x.name || '').toLowerCase().includes(q) ||
        String(x.description || '').toLowerCase().includes(q)
      )
    : all;

  return (
    <View style={styles.container}>
      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentBtn, tab === 'managers' && styles.segmentActive]} onPress={() => setTab('managers')}>
          <Text style={[styles.segmentText, tab === 'managers' && styles.segmentTextActive]}>Managers</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentBtn, tab === 'agents' && styles.segmentActive]} onPress={() => setTab('agents')}>
          <Text style={[styles.segmentText, tab === 'agents' && styles.segmentTextActive]}>Agents</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔎</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={`Search ${tab}…`}
          placeholderTextColor={c.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item, i) => `${item.id || i}`}
        contentContainerStyle={{ padding: 12, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => openChat(item.id, tab === 'managers' ? 'manager' : 'agent', item.name)}
          >
            <Text style={styles.icon}>{item.icon || (tab === 'managers' ? '🎯' : '🤖')}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              {tab === 'agents' && item.description ? (
                <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
              ) : null}
              <Text style={styles.meta}>{tab === 'managers' ? managerMeta(item) : agentMeta(item)}</Text>
              {tab === 'agents' && Array.isArray(item.skills) && item.skills.length ? (
                <View style={styles.skillRow}>
                  {item.skills.slice(0, 5).map((s: string) => (
                    <View key={s} style={styles.skillChip}>
                      <Text style={styles.skillText}>{s}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            <Text style={styles.chatIcon}>💬</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          loading && !loaded ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={c.accent} />
              <Text style={styles.loadingText}>Loading {tab}…</Text>
            </View>
          ) : (
            <Text style={styles.empty}>No connected {tab}. Connect assets from the server dashboard.</Text>
          )
        }
      />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  segment: { flexDirection: 'row', backgroundColor: c.surfaceSoft, borderRadius: 10, margin: 12, marginBottom: 8, padding: 3 },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  segmentText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  segmentTextActive: { color: c.accent },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.border, marginHorizontal: 12, marginBottom: 4, paddingHorizontal: 12 },
  searchIcon: { fontSize: 14, marginRight: 8, color: c.textMuted },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: c.text },
  searchClear: { fontSize: 14, color: c.textMuted, paddingLeft: 8 },
  card: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: c.surface, marginBottom: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  icon: { fontSize: 24, marginRight: 12 },
  name: { fontSize: 16, fontWeight: '600', color: c.text },
  desc: { fontSize: 13, color: c.textSoft, marginTop: 3, lineHeight: 18 },
  meta: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  skillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  skillChip: { backgroundColor: c.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  skillText: { fontSize: 11, color: c.accent, fontWeight: '600' },
  chatIcon: { fontSize: 18, marginLeft: 8, marginTop: 2 },
  empty: { textAlign: 'center', color: c.textMuted, fontSize: 14, marginTop: 60, paddingHorizontal: 24 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 80 },
  loadingText: { color: c.textMuted, fontSize: 14 },
});
