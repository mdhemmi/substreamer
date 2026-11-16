jest.mock('../../store/persistence/kvStorage', () =>
  require('../../store/persistence/__mocks__/kvStorage'),
);

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ replace: mockReplace }),
}));

const mockLogin = jest.fn();
const mockFetchServerInfo = jest.fn();
jest.mock('../../services/subsonicService', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  fetchServerInfo: () => mockFetchServerInfo(),
  normalizeServerUrl: (url: string) => {
    let base = url.trim();
    if (!base.startsWith('http://') && !base.startsWith('https://')) base = `https://${base}`;
    return base.replace(/\/+$/, '').replace(/\/rest$/i, '');
  },
}));

const mockTrust = jest.fn();
jest.mock('../../services/sslTrustService', () => ({
  trustCertificateForHost: (...args: unknown[]) => mockTrust(...args),
}));

const mockGetCertificateInfo = jest.fn();
jest.mock('../../../modules/expo-ssl-trust/src', () => ({
  getCertificateInfo: (...args: unknown[]) => mockGetCertificateInfo(...args),
  isSSLError: () => false,
}));

let mockDbHealthy = true;
jest.mock('../../store/persistence', () => ({
  ...jest.requireActual('../../store/persistence'),
  isDbHealthy: () => mockDbHealthy,
}));

const mockBeginReidSession = jest.fn();
jest.mock('../../services/navidromeReid/reidSession', () => ({
  beginReidSession: (...args: unknown[]) => mockBeginReidSession(...args),
}));

const mockSignIn = jest.fn();
jest.mock('../../../modules/expo-pangolin-auth/src', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

jest.mock('../../components/LanguageSelector', () => ({ LanguageSelector: () => null }));
jest.mock('../../components/WaveformLogo', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/CertificatePromptModal', () => ({
  CertificatePromptModal: ({ visible, onTrust }: { visible: boolean; onTrust: () => void }) => {
    const { Pressable, Text } = require('react-native');
    const React = require('react');
    return visible
      ? React.createElement(Pressable, { testID: 'cert-trust', onPress: onTrust },
          React.createElement(Text, null, 'trust'))
      : null;
  },
}));

import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import i18n from '../../i18n/i18n';
import { authStore } from '../../store/authStore';
import { LoginScreen } from '../login';

const CERT = {
  sha256Fingerprint: 'AA:BB',
  validTo: '2030-01-01',
  isSystemTrusted: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDbHealthy = true;
  authStore.setState({ isLoggedIn: false, pangolin: null, pangolinReauthRequired: false });
  mockSignIn.mockReset();
  mockGetCertificateInfo.mockResolvedValue(CERT);
  mockTrust.mockResolvedValue(undefined);
  mockLogin.mockResolvedValue({
    success: true,
    version: '0.64.0 (1072e9f7)',
    serverType: 'navidrome',
    serverVersion: '0.64.0 (1072e9f7)',
  });
  mockBeginReidSession.mockResolvedValue(undefined);
  mockFetchServerInfo.mockResolvedValue(null);
});

async function openManualTrust(screen: ReturnType<typeof render>): Promise<void> {
  fireEvent.changeText(screen.getByPlaceholderText(i18n.t('loginServerPlaceholder')), 'https://music.example');
  fireEvent.changeText(screen.getByPlaceholderText(i18n.t('username')), 'user');
  fireEvent.changeText(screen.getByPlaceholderText(i18n.t('password')), 'pass');
  fireEvent.press(screen.getByText(i18n.t('advancedOptions')));
  fireEvent.press(screen.getByText(i18n.t('trustServerCertificate')));
  await waitFor(() => expect(screen.getByTestId('cert-trust')).toBeTruthy());
}

describe('LoginScreen certificate trust', () => {
  it('refuses the trusted-certificate login when the database is unavailable', async () => {
    const screen = render(<LoginScreen />);
    await openManualTrust(screen);
    mockDbHealthy = false;

    fireEvent.press(screen.getByTestId('cert-trust'));

    await waitFor(() =>
      expect(screen.getByText(i18n.t('persistenceDegradedLoginError'))).toBeTruthy(),
    );
    expect(mockTrust).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(authStore.getState().isLoggedIn).toBe(false);
  });

  it('logs in after trusting the certificate when the database is healthy', async () => {
    const screen = render(<LoginScreen />);
    await openManualTrust(screen);

    fireEvent.press(screen.getByTestId('cert-trust'));

    await waitFor(() => expect(authStore.getState().isLoggedIn).toBe(true));
    expect(mockTrust).toHaveBeenCalledWith('music.example', 'AA:BB', '2030-01-01');
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

describe('LoginScreen re-key decision', () => {
  /** Hold `beginReidSession` open so the test can look at the screen mid-login. */
  const holdReidSession = () => {
    let finish: () => void = () => undefined;
    mockBeginReidSession.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    return () => finish();
  };

  it('decides before the session starts, with the button still disabled', async () => {
    const finish = holdReidSession();
    const screen = render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('loginServerPlaceholder')), 'https://music.example');
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('username')), 'user');
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('password')), 'pass');

    fireEvent.press(screen.getByText(i18n.t('logIn')));

    await waitFor(() => expect(mockBeginReidSession).toHaveBeenCalledWith(
      expect.objectContaining({ serverType: 'navidrome', serverVersion: '0.64.0 (1072e9f7)' }),
    ));
    // Still logging in: no session, and the button shows the spinner, not its label.
    expect(authStore.getState().isLoggedIn).toBe(false);
    expect(screen.queryByText(i18n.t('logIn'))).toBeNull();

    finish();
    await waitFor(() => expect(authStore.getState().isLoggedIn).toBe(true));
  });

  it('decides before the session starts on the trusted-certificate path too', async () => {
    const finish = holdReidSession();
    const screen = render(<LoginScreen />);
    await openManualTrust(screen);

    fireEvent.press(screen.getByTestId('cert-trust'));

    await waitFor(() => expect(mockBeginReidSession).toHaveBeenCalled());
    expect(authStore.getState().isLoggedIn).toBe(false);

    finish();
    await waitFor(() => expect(authStore.getState().isLoggedIn).toBe(true));
  });
});

describe('LoginScreen Pangolin gate', () => {
  const fill = (screen: ReturnType<typeof render>) => {
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('loginServerPlaceholder')), 'https://music.example');
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('username')), 'user');
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('password')), 'pass');
  };

  it('logs in with no gate by default', async () => {
    const screen = render(<LoginScreen />);
    fill(screen);
    fireEvent.press(screen.getByText(i18n.t('logIn')));
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith(
      'https://music.example', 'user', 'pass', false, null,
    ));
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('shows the three choices on iOS and sends an access token', async () => {
    if (Platform.OS !== 'ios') return;
    const screen = render(<LoginScreen />);
    expect(screen.getByText(i18n.t('pangolinOff'))).toBeTruthy();
    expect(screen.getByText(i18n.t('pangolinSignIn'))).toBeTruthy();
    expect(screen.getByText(i18n.t('pangolinAccessToken'))).toBeTruthy();

    fireEvent.press(screen.getByText(i18n.t('pangolinAccessToken')));
    fill(screen);
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('pangolinTokenId')), 'tid');
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('pangolinToken')), 'secret');
    fireEvent.press(screen.getByText(i18n.t('logIn')));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith(
      'https://music.example',
      'user',
      'pass',
      false,
      { kind: 'token', tokenId: 'tid', token: 'secret' },
    ));
  });

  it('signs in with SSO and stores the cookies on the session', async () => {
    if (Platform.OS !== 'ios') return;
    mockSignIn.mockResolvedValue([
      { name: 'p_session_token_s.1', value: 'abc', expiresAt: null },
    ]);
    const screen = render(<LoginScreen />);
    fireEvent.press(screen.getByText(i18n.t('pangolinSignIn')));
    fill(screen);
    fireEvent.press(screen.getByText(i18n.t('logIn')));

    await waitFor(() => expect(authStore.getState().isLoggedIn).toBe(true));
    expect(mockSignIn).toHaveBeenCalledWith('https://music.example', i18n.t('cancel'));
    expect(authStore.getState().pangolin).toEqual({
      kind: 'sso',
      host: 'music.example',
      cookies: [{ name: 'p_session_token_s.1', value: 'abc', expiresAt: null }],
    });
  });

  it('shows the Pangolin message on a gate 401 and does not open the web view', async () => {
    mockLogin.mockResolvedValueOnce({
      success: false,
      error: i18n.t('pangolinGateDetected'),
      pangolinGate: true,
    });
    const screen = render(<LoginScreen />);
    fill(screen);
    fireEvent.press(screen.getByText(i18n.t('logIn')));
    await waitFor(() => expect(screen.getByText(i18n.t('pangolinGateDetected'))).toBeTruthy());
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(authStore.getState().isLoggedIn).toBe(false);
  });
});
