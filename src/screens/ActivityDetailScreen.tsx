import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Share } from 'react-native';
import { useColors, Palette } from '../services/theme';
import MarkdownView from '../components/MarkdownView';

/**
 * Activity detail screen — shows a single run's metadata and full output,
 * with a Share button. Route param: { item } (an activity row).
 */
export default function ActivityDetailScreen({ route, navigation }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const item = route.params?.item || {};

  const statusInfo = (() => {
    if (item.status === 'completed' || item.status === 'success') return { label: '✓ Completed', color: c.success };
    if (item.status === 'failed') return { label: '✗ Failed', color: c.danger };
    if (item.status === 'running') return { label: '● Running', color: c.warning };
    return { label: item.status || 'Unknown', color: c.textMuted };
  })();

  const durationLabel = item.durationMs != null ? `${(item.durationMs / 1000).toFixed(1)}s` : '—';
  const timeLabel = item.createdAt ? new Date(item.createdAt).toLocaleString() : (item.timestamp ? new Date(item.timestamp).toLocaleString() : '—');
  const output = item.output || '(no output captured)';

  React.useEffect(() => {
    navigation.setOptions({
      title: item.name || item.entityName || 'Activity',
      headerRight: () => (
        <TouchableOpacity onPress={onShare}>
          <Text style={styles.shareBtn}>Share</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, styles]);

  const onShare = async () => {
    try {
      await Share.share({
        title: item.name,
        message: `${item.name || 'Activity'} — ${statusInfo.label}\n${timeLabel} • ${durationLabel}\n\n${output}`,
      });
    } catch {}
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
      <View style={styles.metaCard}>
        <MetaRow label="Status" value={statusInfo.label} valueColor={statusInfo.color} c={c} styles={styles} />
        <MetaRow label="Trigger" value={item.trigger || 'direct'} c={c} styles={styles} />
        <MetaRow label="Duration" value={durationLabel} c={c} styles={styles} />
        <MetaRow label="Time" value={timeLabel} c={c} styles={styles} last />
      </View>

      <Text style={styles.sectionTitle}>Output</Text>
      <View style={styles.outputBox}>
        <MarkdownView>{output}</MarkdownView>
      </View>
    </ScrollView>
  );
}

function MetaRow({ label, value, valueColor, last, styles }: any) {
  return (
    <View style={[styles.metaRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, valueColor && { color: valueColor }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  metaCard: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: c.border },
  metaLabel: { fontSize: 13, color: c.textMuted },
  metaValue: { fontSize: 13, fontWeight: '600', color: c.text, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8, marginLeft: 2 },
  outputBox: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14 },
  output: { fontFamily: 'Courier', fontSize: 13, color: c.text, lineHeight: 19 },
  shareBtn: { color: c.accent, fontSize: 15, fontWeight: '600', marginRight: 4 },
});
