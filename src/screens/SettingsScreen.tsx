import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useColors, useTheme, Palette, ThemeMode } from '../services/theme';
import { getConfig, setConfig, probeStatus, isConfigured, getSenderId } from '../services/api';
import type { RelayConfig, ConnState } from '../services/api';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function SettingsScreen() {
  const c = useColors();
  const { mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [relayUrl, setRelayUrl] = useState('');
  const [connState, setConnState] = useState<ConnState | null>(null);
  const [testing, setTesting] = useState(false);
  const [senderId, setSenderId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [paired, setPaired] = useState(false);
  const [userId, setUserId] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    loadConfig();
    getSenderId().then(setSenderId);
  }, []);

  const loadConfig = async () => {
    const cfg = await getConfig();
    if (cfg) {
      setRelayUrl(cfg.relayUrl || '');
      setUserId(cfg.userId || '');
      const isPaired = !!(cfg.relayUrl && cfg.deviceToken);
      setPaired(isPaired);
      if (isPaired) {
        const { state } = await probeStatus();
        setConnState(state);
      }
    }
  };

  const testConnection = async () => {
    setTesting(true);
    const { state } = await probeStatus();
    setConnState(state);
    setTesting(false);
    if (state === 'authorized') Alert.alert('Connected', 'Connected and authorized.');
    else if (state === 'unauthorized')
      Alert.alert('Not Authorized', 'Your device is paired but your user is not approved on the server. Ask an admin to add you under RBAC, then re-scan the pairing QR code.');
    else Alert.alert('Offline', 'Could not reach the server through the relay.');
  };

  const startScan = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera Permission', 'Camera access is needed to scan the pairing QR code.');
        return;
      }
    }
    setScanning(true);
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    setScanning(false);
    try {
      const payload = JSON.parse(data);
      if (!payload.relay || !payload.token) {
        Alert.alert('Invalid Code', 'This QR code is not a valid pairing code.');
        return;
      }

      const newConfig: RelayConfig = {
        relayUrl: payload.relay,
        deviceToken: payload.token,
        userId: payload.userId || '',
      };
      await setConfig(newConfig);
      setRelayUrl(newConfig.relayUrl);
      setUserId(newConfig.userId || '');
      setPaired(true);

      const { state } = await probeStatus();
      setConnState(state);

      if (state === 'authorized') {
        Alert.alert('✅ Paired!', `Connected as ${payload.userId || 'device'}.`);
      } else if (state === 'unauthorized') {
        Alert.alert('Paired, but not authorized', `Your user (${payload.userId || 'device'}) is not approved on the server. Ask an admin to add you under RBAC, then re-scan.`);
      } else {
        Alert.alert('Paired (offline)', 'Config saved but the server could not be reached. It may be starting up.');
      }
    } catch (e) {
      Alert.alert('Invalid Code', 'Could not parse the QR code.');
    }
  };

  const handleManualPair = async () => {
    if (!relayUrl || !manualToken) {
      Alert.alert('Missing fields', 'Enter both the relay URL and device token.');
      return;
    }
    const newConfig: RelayConfig = {
      relayUrl: relayUrl.replace(/\/$/, ''),
      deviceToken: manualToken,
      userId: userId || 'manual',
    };
    await setConfig(newConfig);
    setPaired(true);
    const { state } = await probeStatus();
    setConnState(state);
    if (state === 'authorized') Alert.alert('Connected!', 'Manual pairing successful.');
    else if (state === 'unauthorized') Alert.alert('Not Authorized', 'Paired, but your user is not approved on the server. Ask an admin to add you under RBAC.');
    else Alert.alert('Saved', 'Config saved but the server could not be reached.');
  };

  const handleUnpair = async () => {
    await setConfig({ relayUrl: '', deviceToken: '', userId: '' });
    setPaired(false);
    setConnState(null);
    setRelayUrl('');
    setUserId('');
  };

  if (scanning) {
    return (
      <View style={styles.scanContainer}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarCodeScanned}
        />
        <View style={styles.scanOverlay}>
          <View style={styles.scanFrame} />
          <Text style={styles.scanText}>Point at the pairing QR code in the SPA</Text>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setScanning(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingTop: 56 }}>
      <Text style={styles.header}>Settings</Text>

      <View style={styles.appearanceCard}>
        <Text style={styles.appearanceTitle}>🎨 Appearance</Text>
        <Text style={styles.appearanceDesc}>Choose how the app looks.</Text>
        <View style={styles.segment}>
          {(['system', 'light', 'dark'] as ThemeMode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.segmentItem, mode === m && styles.segmentItemActive]}
              onPress={() => setMode(m)}
            >
              <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                {m === 'system' ? 'System' : m === 'light' ? 'Light' : 'Dark'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.pairingCard}>
        <Text style={styles.pairingTitle}>📱 Device Pairing</Text>
        {!paired ? (
          <>
            <Text style={styles.pairingDesc}>
              Scan the pairing QR code from the Agent Supervisor web app to connect this device.
            </Text>
            <TouchableOpacity style={styles.scanButton} onPress={startScan}>
              <Text style={styles.scanButtonText}>📷 Scan Pairing QR Code</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {connState === 'unauthorized' ? (
              <View style={[styles.authWarn, { backgroundColor: c.danger + '18', borderColor: c.danger }]}>
                <Text style={{ color: c.danger, fontWeight: '700', fontSize: 15 }}>⚠ Not authorized</Text>
                <Text style={[styles.pairingDesc, { color: c.text, marginTop: 4 }]}>
                  This device is paired as {userId || 'device'}, but that user is not approved on the server. Ask an admin to add you under RBAC, then re-scan the pairing QR code.
                </Text>
              </View>
            ) : connState === 'authorized' ? (
              <Text style={[styles.pairingDesc, { color: c.success }]}>
                ✓ Connected as {userId || 'device'}
              </Text>
            ) : (
              <Text style={[styles.pairingDesc, { color: c.warning }]}>
                ⏳ Paired as {userId || 'device'} • server unreachable
              </Text>
            )}
            <Text style={[styles.pairingDesc, { fontSize: 12, color: c.textMuted }]}>
              Relay: {relayUrl}
            </Text>
            <TouchableOpacity style={styles.scanButton} onPress={startScan}>
              <Text style={styles.scanButtonText}>📷 {connState === 'unauthorized' ? 'Re-scan QR Code' : 'Re-pair QR Code'}</Text>
            </TouchableOpacity>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.testButton]} onPress={testConnection} disabled={testing}>
                <Text style={styles.testButtonText}>{testing ? 'Testing...' : 'Test Connection'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, { backgroundColor: c.danger + '20' }]} onPress={handleUnpair}>
                <Text style={{ color: c.danger, fontWeight: '600' }}>Unpair</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {connState !== null && (
        <View style={[styles.status, { backgroundColor: connState === 'authorized' ? c.success + '20' : connState === 'unauthorized' ? c.danger + '20' : c.warning + '20' }]}>
          <Text style={{ color: connState === 'authorized' ? c.success : connState === 'unauthorized' ? c.danger : c.warning, fontWeight: '600' }}>
            {connState === 'authorized' ? '✓ Connected & authorized' : connState === 'unauthorized' ? '✗ Not authorized — re-scan QR code' : '⏳ Server unreachable'}
          </Text>
        </View>
      )}

      <TouchableOpacity style={styles.manualToggle} onPress={() => setShowManual(!showManual)}>
        <Text style={styles.manualToggleText}>{showManual ? '▼' : '▶'} Manual Configuration</Text>
      </TouchableOpacity>

      {showManual && (
        <View style={styles.manualSection}>
          <Text style={styles.label}>Relay URL</Text>
          <TextInput style={styles.input} value={relayUrl} onChangeText={setRelayUrl} placeholder="https://relay-agentsessions.....azurecontainerapps.io" placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} />

          <Text style={styles.label}>Device Token</Text>
          <TextInput style={styles.input} value={manualToken} onChangeText={setManualToken} placeholder="Paste your device token" placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} secureTextEntry />

          <Text style={styles.label}>User ID (optional)</Text>
          <TextInput style={styles.input} value={userId} onChangeText={setUserId} placeholder="chcosta" placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} />

          <View style={styles.row}>
            <TouchableOpacity style={styles.button} onPress={handleManualPair}>
              <Text style={styles.buttonText}>Connect</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.hint}>
        Your device communicates with the Agent Supervisor server through a secure relay service. Pair via QR code from the web app, or enter credentials manually.
      </Text>

      <Text style={styles.deviceId}>Device ID: {senderId}</Text>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: { fontSize: 28, fontWeight: '700', color: c.text, marginBottom: 8 },
  pairingCard: { backgroundColor: c.surface, borderRadius: 16, padding: 20, marginTop: 16, borderWidth: 1, borderColor: c.accent + '40' },
  appearanceCard: { backgroundColor: c.surface, borderRadius: 16, padding: 20, marginTop: 16, borderWidth: 1, borderColor: c.border },
  appearanceTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 6 },
  appearanceDesc: { fontSize: 14, color: c.textMuted, lineHeight: 20, marginBottom: 14 },
  segment: { flexDirection: 'row', backgroundColor: c.bg, borderRadius: 10, padding: 4, borderWidth: 1, borderColor: c.border },
  segmentItem: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  segmentItemActive: { backgroundColor: c.accent },
  segmentText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  segmentTextActive: { color: c.accentFg },
  pairingTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 6 },
  pairingDesc: { fontSize: 14, color: c.textMuted, lineHeight: 20, marginBottom: 16 },
  scanButton: { backgroundColor: c.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  authWarn: { borderRadius: 10, padding: 12, borderWidth: 1, marginBottom: 8 },
  scanButtonText: { color: c.accentFg, fontWeight: '700', fontSize: 16 },
  codeBox: { backgroundColor: c.bg, borderRadius: 12, padding: 20, alignItems: 'center', marginVertical: 12, borderWidth: 2, borderColor: c.accent },
  codeText: { fontSize: 32, fontWeight: '800', color: c.accent, letterSpacing: 4, fontFamily: 'monospace' },
  status: { marginTop: 16, padding: 12, borderRadius: 8 },
  manualToggle: { marginTop: 24, paddingVertical: 8 },
  manualToggleText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  manualSection: { marginTop: 8 },
  label: { fontSize: 13, fontWeight: '600', color: c.textMuted, marginBottom: 4, marginTop: 10 },
  input: { backgroundColor: c.surface, borderRadius: 10, padding: 12, fontSize: 15, color: c.text, borderWidth: 1, borderColor: c.border },
  row: { flexDirection: 'row', gap: 12, marginTop: 20 },
  button: { backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 12 },
  buttonText: { color: c.accentFg, fontWeight: '600', fontSize: 15 },
  testButton: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  testButtonText: { color: c.text, fontWeight: '600', fontSize: 15 },
  hint: { marginTop: 20, fontSize: 13, color: c.textMuted, lineHeight: 18 },
  deviceId: { marginTop: 16, fontSize: 12, color: c.textSoft, fontFamily: 'monospace', marginBottom: 40 },
  scanContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  scanOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 250, height: 250, borderWidth: 3, borderColor: c.accent, borderRadius: 16 },
  scanText: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 24, textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  cancelButton: { marginTop: 32, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 32, paddingVertical: 12 },
  cancelButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
