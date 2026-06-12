import React, { useMemo } from 'react';
import Markdown from 'react-native-markdown-display';
import { useColors, Palette } from '../services/theme';

/**
 * Theme-aware markdown renderer used for agent/manager output and chat bubbles.
 * Wraps react-native-markdown-display with Clawpilot palette styling so output
 * renders headings, lists, code blocks, tables, and links nicely in dark mode.
 */
export default function MarkdownView({
  children,
  color,
}: {
  children: string;
  /** Optional override for the base text color (e.g. accentFg inside user bubbles). */
  color?: string;
}) {
  const c = useColors();
  const styles = useMemo(() => makeMarkdownStyles(c, color), [c, color]);
  return <Markdown style={styles}>{children || ''}</Markdown>;
}

const makeMarkdownStyles = (c: Palette, override?: string) => {
  const text = override || c.text;
  return {
    body: { color: text, fontSize: 15, lineHeight: 21 },
    paragraph: { color: text, fontSize: 15, lineHeight: 21, marginTop: 0, marginBottom: 8 },
    heading1: { color: text, fontSize: 22, fontWeight: '700' as const, marginTop: 6, marginBottom: 6 },
    heading2: { color: text, fontSize: 19, fontWeight: '700' as const, marginTop: 6, marginBottom: 6 },
    heading3: { color: text, fontSize: 16, fontWeight: '700' as const, marginTop: 6, marginBottom: 4 },
    heading4: { color: text, fontSize: 15, fontWeight: '700' as const, marginTop: 4, marginBottom: 4 },
    strong: { fontWeight: '700' as const, color: text },
    em: { fontStyle: 'italic' as const, color: text },
    link: { color: c.link, textDecorationLine: 'underline' as const },
    blockquote: {
      backgroundColor: c.surfaceSoft,
      borderLeftColor: c.accent,
      borderLeftWidth: 3,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginBottom: 8,
    },
    bullet_list: { marginBottom: 8 },
    ordered_list: { marginBottom: 8 },
    list_item: { color: text, marginBottom: 2 },
    bullet_list_icon: { color: c.accent },
    ordered_list_icon: { color: c.accent },
    code_inline: {
      color: c.text,
      backgroundColor: c.surfaceSoft,
      borderRadius: 4,
      paddingHorizontal: 4,
      fontFamily: 'Courier',
      fontSize: 13,
    },
    code_block: {
      color: c.text,
      backgroundColor: c.surfaceSoft,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      fontFamily: 'Courier',
      fontSize: 13,
      marginBottom: 8,
    },
    fence: {
      color: c.text,
      backgroundColor: c.surfaceSoft,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      fontFamily: 'Courier',
      fontSize: 13,
      marginBottom: 8,
    },
    table: { borderColor: c.border, borderWidth: 1, borderRadius: 6, marginBottom: 8 },
    thead: { backgroundColor: c.surfaceSoft },
    th: { color: text, padding: 6, fontWeight: '700' as const },
    tr: { borderColor: c.border, borderBottomWidth: 1 },
    td: { color: text, padding: 6 },
    hr: { backgroundColor: c.border, height: 1, marginVertical: 8 },
  };
};
