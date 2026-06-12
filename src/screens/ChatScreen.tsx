import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Share } from 'react-native';
import { useColors, Palette } from '../services/theme';
import { sendChatStreaming, getChatHistory } from '../services/api';
import MarkdownView from '../components/MarkdownView';

interface Message {
  role: 'user' | 'assistant' | 'status';
  content: string;
  timestamp?: string;
  streaming?: boolean; // true while streaming text is accumulating
}

export default function ChatScreen({ route, navigation }: any) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { targetId, targetType, name } = route.params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const streamBuffer = useRef('');
  const messagesRef = useRef<Message[]>([]);
  const sessionId = `mobile-${targetType}-${targetId}`;

  messagesRef.current = messages;

  const onShare = useCallback(async () => {
    const transcript = messagesRef.current
      .filter(m => m.role !== 'status')
      .map(m => `${m.role === 'user' ? 'You' : name}: ${m.content}`)
      .join('\n\n');
    try {
      await Share.share({ title: `Chat with ${name}`, message: `Chat with ${name}\n\n${transcript}` });
    } catch {}
  }, [name]);

  useEffect(() => {
    navigation.setOptions({
      title: name,
      headerRight: () => (
        <TouchableOpacity onPress={onShare}>
          <Text style={styles.shareBtn}>Share</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, name, onShare, styles]);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const chatId = `${sessionId}:${targetId}`;
      const resp = await getChatHistory(chatId);
      if (resp.messages) {
        setMessages(resp.messages.map((m: any) => ({ role: m.role, content: m.content, timestamp: m.timestamp })));
      }
    } catch {}
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
      });

      const finalContent = resp.output || resp.response || streamBuffer.current || 'No response';
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.streaming) {
          return [...prev.slice(0, -1), { role: 'assistant', content: finalContent }];
        }
        return [...prev, { role: 'assistant', content: finalContent }];
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
    return (
      <View style={[
        styles.bubble,
        item.role === 'user' ? styles.userBubble : styles.assistantBubble,
        item.streaming && styles.streamingBubble,
      ]}>
        {item.streaming && (
          <View style={styles.streamingIndicator}>
            <ActivityIndicator size="small" color={c.accent} />
          </View>
        )}
        {item.role === 'user' ? (
          <Text style={[styles.bubbleText, styles.userText]}>{item.content}</Text>
        ) : (
          <MarkdownView>{item.content}</MarkdownView>
        )}
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
  empty: { textAlign: 'center', color: c.textMuted, fontSize: 14, marginTop: 60 },
});
