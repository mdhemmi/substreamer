import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { signIn } from '../../modules/expo-pangolin-auth/src';
import { useTheme } from '../hooks/useTheme';
import {
  requestHostname,
  type PangolinCredential,
} from '../services/pangolinAuth';
import { replacePangolinCredential } from '../services/pangolinSession';
import { logout } from '../services/logoutService';
import { normalizeServerUrl } from '../services/subsonicService';
import { authStore } from '../store/authStore';

type GateMode = 'sso' | 'token';

function isCancel(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err
    && (err as { code: unknown }).code === 'ERR_CANCELLED';
}

/**
 * Shown when a live session's Pangolin gate answers 401. Signing in again
 * keeps the library. Log out is the way off the prompt.
 */
export function PangolinReauthModal() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const required = authStore((s) => s.pangolinReauthRequired);
  const loggedIn = authStore((s) => s.isLoggedIn);
  const current = authStore((s) => s.pangolin);
  const [mode, setMode] = useState<GateMode>('sso');
  const [tokenId, setTokenId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!required) return;
    setMode(current?.kind === 'token' ? 'token' : 'sso');
    setError(null);
  }, [required, current]);

  if (Platform.OS !== 'ios' || !required || !loggedIn) return null;

  const submit = async () => {
    const serverUrl = authStore.getState().serverUrl;
    if (!serverUrl) return;
    setBusy(true);
    setError(null);
    try {
      let credential: PangolinCredential;
      if (mode === 'token') {
        const id = tokenId.trim();
        const secret = accessToken.trim();
        if (!id || !secret) {
          setError(t('fillAllFields'));
          return;
        }
        credential = { kind: 'token', tokenId: id, token: secret };
      } else {
        const normalized = normalizeServerUrl(serverUrl);
        const cookies = await signIn(normalized, t('cancel'));
        const host = requestHostname(normalized);
        const usable = cookies.filter((cookie) => cookie.name && cookie.value);
        if (!host || usable.length === 0) {
          setError(t('pangolinSignInFailed'));
          return;
        }
        credential = {
          kind: 'sso',
          host,
          cookies: usable.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            expiresAt: typeof cookie.expiresAt === 'number' ? cookie.expiresAt : null,
          })),
        };
      }
      const result = await replacePangolinCredential(credential);
      if (!result.ok) setError(result.error);
    } catch (err) {
      setError(t(isCancel(err) ? 'pangolinSignInCancelled' : 'pangolinSignInFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t('pangolinReauthTitle')}</Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>{t('pangolinReauthMessage')}</Text>
          <View style={styles.row}>
            <Pressable
              onPress={() => setMode('sso')}
              style={[styles.choice, { borderColor: colors.border }, mode === 'sso' && { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: mode === 'sso' ? '#fff' : colors.textPrimary }}>{t('pangolinSignIn')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode('token')}
              style={[styles.choice, { borderColor: colors.border }, mode === 'token' && { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: mode === 'token' ? '#fff' : colors.textPrimary }}>{t('pangolinAccessToken')}</Text>
            </Pressable>
          </View>
          {mode === 'token' && (
            <>
              <TextInput
                value={tokenId}
                onChangeText={setTokenId}
                placeholder={t('pangolinTokenId')}
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]}
              />
              <TextInput
                value={accessToken}
                onChangeText={setAccessToken}
                placeholder={t('pangolinToken')}
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]}
              />
            </>
          )}
          {error ? <Text style={[styles.error, { color: colors.red }]}>{error}</Text> : null}
          <Pressable
            onPress={() => { void submit(); }}
            disabled={busy}
            style={[styles.primary, { backgroundColor: colors.primary }, busy && styles.disabled]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.primaryText}>{t('pangolinContinue')}</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => { void logout(); }}
            disabled={busy}
            style={styles.secondary}
          >
            <Text style={{ color: colors.red }}>{t('logOut')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  card: { borderRadius: 16, padding: 20 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  message: { fontSize: 14, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    fontSize: 16,
  },
  error: { fontSize: 14, marginBottom: 8 },
  primary: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.7 },
  secondary: { alignItems: 'center', paddingVertical: 12 },
});
