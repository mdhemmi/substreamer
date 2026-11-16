/**
 * Replace the Pangolin gate on a session that is already logged in.
 * The Subsonic username and password stay as they are. A failed ping leaves
 * the saved gate untouched.
 */

import i18n from '../i18n/i18n';
import { authStore } from '../store/authStore';
import { type PangolinCredential } from './pangolinAuth';
import { syncProxyUpstreams } from './sslTrustService';
import { login } from './subsonicService';

export async function replacePangolinCredential(
  credential: PangolinCredential,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { serverUrl, username, password, legacyAuth } = authStore.getState();
  if (!serverUrl || !username || !password) {
    return { ok: false, error: i18n.t('connectionFailed') };
  }
  const result = await login(serverUrl, username, password, legacyAuth, credential);
  if (!result.success) return { ok: false, error: result.error };
  authStore.getState().setPangolin(credential);
  await syncProxyUpstreams();
  return { ok: true };
}
