import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Share } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { sendChatStreaming, getChatHistory, listChatThreads, newChatThread } from '../services/api';
import MarkdownView from '../components/MarkdownView';

interface Message {
  role: 'user' | 'assistant' | 'agent' | 'status';
  content: string;
  timestamp?: string;
  streaming?: boolean; // true while streaming text is accumulating
  speaker?: string;    // attribution: manager name or sub-agent name
  agentId?: string;    // sub-agent id (role === 'agent')
}

export default function ChatScreen({ route, navigation }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { targetId, targetType, name } = route.params;
  const isManager = targetType === 'manager';
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(route.params?.threadId || null);
  const flatListRef = useRef<FlatList>(null);
  const streamBuffer = useRef('');
  const messagesRef = useRef<Message[]>([]);
  const sessionId = `mobile-${targetType}-${targetId}`;

  messagesRef.current = messages;

  const onShare = useCallback(async () => {
    const transcript = messagesRef.current
      .filter(m => m.role !== 'status')
      .map(m => {
        const who = m.role === 'user' ? 'You' : (m.speaker || name);
        return `${who}: ${m.content}`;
      })
      .join('\n\n');
    try {
      await Share.share({ title: `Chat with ${name}`, message: `Chat with ${name}\n\n${transcript}` });
    } catch {}
  }, [name]);

  const startNewConversation = useCallback(async () => {
    try {
      const resp = await newChatThread(targetId, targetType);
      if (resp?.threadId) {
        setThreadId(resp.threadId);
        setMessages([]);
      }
    } catch {}
  }, [targetId, targetType]);

  useEffect(() => {
    navigation.setOptions({
      title: name,
      headerRight: () => (
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.navigate('ChatThreads', { targetId, targetType, name, currentThreadId: threadId })}>
            <Text style={styles.headerBtn}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={startNewConversation}>
            <Text style={styles.headerBtn}>New</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onShare}>
            <Text style={styles.headerBtn}>Share</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, name, onShare, styles, targetId, targetType, threadId, startNewConversation]);

  // Resolve which thread to load whenever the route's threadId changes (e.g.
  // when navigating back from the History screen with a selected thread).
  useEffect(() => {
    if (route.params?.threadId) setThreadId(route.params.threadId);
  }, [route.params?.threadId]);

  useEffect(() => {
    resolveAndLoad();
  }, [threadId]);

  const mapMsg = (m: any): Message => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    speaker: m.speaker,
    agentId: m.agentId,
  });

  const resolveAndLoad = async () => {
    // Both agents and managers use threads. Agents resume from their copilot
    // session; managers resume from the persisted attributed transcript.
    let tid = threadId;
    if (!tid) {
      // No explicit thread — resume the most recent, or mint a fresh one.
      try {
        const list = await listChatThreads(targetId);
        const threads = list?.threads || [];
        if (threads.length > 0) {
          tid = threads[0].threadId;
        } else {
          const created = await newChatThread(targetId, targetType);
          tid = created?.threadId || null;
        }
      } catch {}
      if (tid && tid !== threadId) { setThreadId(tid); return; } // re-runs effect
    }
    if (tid) {
      try {
        const resp = await getChatHistory({ threadId: tid });
        if (resp.messages) setMessages(resp.messages.map(mapMsg));
      } catch {}
    }
  };

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setStatusText('Sending...');
    streamBuffer.current = '';

    try {
      const resp = await sendChatStreaming(targetId, targetType, userMsg.content, sessionId, (update) => {
        if (update.type === 'status') {
          setStatusText(update.message || update.status || 'Processing...');
        } else if (update.type === 'agent-step') {
          if (update.phase === 'start') {
            setStatusText(`🤖 ${update.speaker || 'Sub-agent'} is working…`);
          } else if (update.phase === 'result') {
            const speaker = update.speaker || update.agentId || 'Sub-agent';
            const text = update.text || '(no output)';
            setMessages(prev => [...prev, { role: 'agent', content: text, speaker, agentId: update.agentId }]);
            setStatusText(`${name} is reviewing ${speaker}'s results…`);
          }
          // phase 'manager-final': the manager's answer arrives as the result.
        } else if (update.type === 'chunk' && update.text && !update.isFinal) {
          streamBuffer.current += update.text;
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.streaming) {
              return [...prev.slice(0, -1), { role: 'assistant', content: streamBuffer.current, streaming: true }];
            } else {
              return [...prev, { role: 'assistant', content: streamBuffer.current, streaming: true }];
            }
          });
          setStatusText(null);
        }
      }, threadId || undefined);

      const finalContent = resp.output || resp.response || streamBuffer.current || 'No response';
      const finalSpeaker = isManager ? name : undefined;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.streaming) {
          return [...prev.slice(0, -1), { role: 'assistant', content: finalContent, speaker: finalSpeaker }];
        }
        return [...prev, { role: 'assistant', content: finalContent, speaker: finalSpeaker }];
      });
    } catch (err: any) {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.streaming) {
          return [...prev.slice(0, -1), { role: 'assistant', content: `Error: ${err.message}` }];
        }
        return [...prev, { role: 'assistant', content: `Error: ${err.message}` }];
      });
    } finally {
      setSending(false);
      setStatusText(null);
      streamBuffer.current = '';
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    if (item.role === 'status') {
      return (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={c.textMuted} />
          <Text style={styles.statusRowText}>{item.content}</Text>
        </View>
      );
    }
    if (item.role === 'user') {
      return (
        <View style={[styles.bubble, styles.userBubble]}>
          <Text style={[styles.bubbleText, styles.userText]}>{item.content}</Text>
        </View>
      );
    }
    // Sub-agent contribution within a manager conversation — clearly attributed
    // and visually distinct from the manager's own messages.
    if (item.role === 'agent') {
      return (
        <View style={styles.agentWrap}>
          <Text style={styles.agentHeader}>🤖 {item.speaker || item.agentId || 'Sub-agent'}</Text>
          <View style={[styles.bubble, styles.agentBubble]}>
            <MarkdownView>{item.content}</MarkdownView>
          </View>
        </View>
      );
    }
    // Assistant: for managers, label with the manager name so it's clear the
    // manager (not a sub-agent) is speaking.
    return (
      <View style={styles.assistantWrap}>
        {isManager && (
          <Text style={styles.managerHeader}>🎯 {item.speaker || name}</Text>
        )}
        <View style={[
          styles.bubble,
          styles.assistantBubble,
          item.streaming && styles.streamingBubble,
        ]}>
          {item.streaming && (
            <View style={styles.streamingIndicator}>
              <ActivityIndicator size="small" color={c.accent} />
            </View>
          )}
          <MarkdownView>{item.content}</MarkdownView>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        keyboardDismissMode="interactive"
        ListEmptyComponent={<Text style={styles.empty}>Start the conversation with {name}.</Text>}
      />

      {statusText && (
        <View style={styles.statusBar}>
          <ActivityIndicator size="small" color={c.accent} />
          <Text style={styles.statusBarText}>{statusText}</Text>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={`Message ${name}...`}
          placeholderTextColor={c.textMuted}
          multiline
          editable={!sending}
          onFocus={() => setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 300)}
        />
        {sending ? (
          <ActivityIndicator color={c.accent} style={styles.sendBtn} />
        ) : (
          <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={!input.trim()}>
            <Text style={[styles.sendText, !input.trim() && { opacity: 0.3 }]}>↑</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  messageList: { padding: 12, paddingBottom: 8, flexGrow: 1 },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 12, marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: c.accent },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  assistantWrap: { alignSelf: 'flex-start', maxWidth: '92%', marginBottom: 8 },
  managerHeader: { fontSize: 12, fontWeight: '700', color: c.accent, marginBottom: 3, marginLeft: 2 },
  agentWrap: { alignSelf: 'flex-start', maxWidth: '92%', marginBottom: 8, marginLeft: 16 },
  agentHeader: { fontSize: 12, fontWeight: '700', color: c.textSoft, marginBottom: 3, marginLeft: 2 },
  agentBubble: { alignSelf: 'flex-start', backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.border, borderStyle: 'dashed' },
  streamingBubble: { borderStyle: 'dashed', borderColor: c.accent, borderWidth: 1 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  userText: { color: c.accentFg },
  assistantText: { color: c.text },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bgElevated },
  input: { flex: 1, backgroundColor: c.surface, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: c.text, borderWidth: 1, borderColor: c.border, maxHeight: 100 },
  sendBtn: { marginLeft: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: c.accentFg, fontSize: 18, fontWeight: '700' },
  statusBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6, backgroundColor: c.bgElevated, borderTopWidth: 1, borderTopColor: c.border },
  statusBarText: { marginLeft: 8, fontSize: 13, color: c.textMuted, fontStyle: 'italic' },
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8 },
  statusRowText: { marginLeft: 6, fontSize: 12, color: c.textMuted },
  streamingIndicator: { marginBottom: 4 },
  shareBtn: { color: c.accent, fontSize: 15, fontWeight: '600', marginRight: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { color: c.accent, fontSize: 15, fontWeight: '600', marginLeft: 14 },
  empty: { textAlign: 'center', color: c.textMuted, fontSize: 14, marginTop: 60 },
});
