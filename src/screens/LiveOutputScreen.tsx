import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Share } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { runAssignmentStreaming, runAgentStreaming, runChainStreaming, StreamUpdate } from '../services/api';
import MarkdownView from '../components/MarkdownView';

/**
 * Live output screen — runs an assignment or task and streams the output
 * back in real time, showing status updates and accumulating text.
 * Route params:
 *   { kind: 'assignment', managerId, assignmentId, name }
 *   { kind: 'task', agentId, name }
 *   { kind: 'chain', chainId, name }
 */
export default function LiveOutputScreen({ route, navigation }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { kind, managerId, assignmentId, agentId, chainId, name } = route.params || {};

  const [status, setStatus] = useState<string>('Starting...');
  const [output, setOutput] = useState<string>('');
  const [running, setRunning] = useState(true);
  const [finalStatus, setFinalStatus] = useState<'completed' | 'failed' | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const startedRef = useRef(false);

  const onUpdate = useCallback((u: StreamUpdate) => {
    if (u.type === 'status') {
      if (u.message) setStatus(u.message);
    } else if (u.type === 'chunk') {
      if (u.text) setOutput(prev => prev + u.text);
    }
  }, []);

  useEffect(() => {
    navigation.setOptions({
      title: name || 'Run',
      headerRight: () => (
        <TouchableOpacity onPress={onShare} disabled={!output}>
          <Text style={[styles.shareBtn, !output && { opacity: 0.4 }]}>Share</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, name, output, styles]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        let result: any;
        if (kind === 'assignment') {
          result = await runAssignmentStreaming(managerId, assignmentId, onUpdate);
        } else if (kind === 'chain') {
          result = await runChainStreaming(chainId, onUpdate);
        } else {
          result = await runAgentStreaming(agentId, undefined, onUpdate);
        }
        const finalOut = result?.output || result?.result || '';
        if (finalOut) setOutput(prev => (prev.trim().length ? prev : finalOut));
        setStatus('Completed');
        setFinalStatus('completed');
      } catch (e: any) {
        setStatus(`Failed: ${e.message}`);
        setOutput(prev => prev + `\n\n[Error] ${e.message}`);
        setFinalStatus('failed');
      } finally {
        setRunning(false);
      }
    })();
  }, []);

  const onShare = async () => {
    try {
      await Share.share({
        title: name,
        message: `${name}\n\n${output}`,
      });
    } catch {}
  };

  const statusColor = finalStatus === 'failed' ? c.danger : finalStatus === 'completed' ? c.success : c.warning;

  return (
    <View style={styles.container}>
      <View style={[styles.statusBar, { borderColor: statusColor }]}>
        {running && <ActivityIndicator size="small" color={c.accent} style={{ marginRight: 8 }} />}
        <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={2}>{status}</Text>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.outputScroll}
        contentContainerStyle={styles.outputContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {output ? (
          <MarkdownView>{output}</MarkdownView>
        ) : (
          <Text style={styles.placeholder}>Waiting for output…</Text>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.surface, paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 2, borderColor: c.warning,
  },
  statusText: { flex: 1, fontSize: 14, fontWeight: '600' },
  outputScroll: { flex: 1 },
  outputContent: { padding: 16 },
  output: {
    fontFamily: 'Courier', fontSize: 13, color: c.text, lineHeight: 19,
  },
  placeholder: { color: c.textMuted, fontSize: 14, fontStyle: 'italic' },
  shareBtn: { color: c.accent, fontSize: 15, fontWeight: '600', marginRight: 4 },
});
