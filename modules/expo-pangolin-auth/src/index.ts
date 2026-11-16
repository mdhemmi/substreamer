import ExpoPangolinAuthModule, { type PangolinNativeCookie } from './ExpoPangolinAuthModule';

export type { PangolinNativeCookie };

/**
 * Open the Pangolin sign-in web view on `serverUrl` and return the cookies
 * Badger set for that host. Rejects if the user cancels.
 */
export function signIn(serverUrl: string, cancelLabel: string): Promise<PangolinNativeCookie[]> {
  return ExpoPangolinAuthModule.signIn(serverUrl, cancelLabel);
}

/** Drop cookies for one resource host. Identity-provider cookies stay. */
export function clearHostCookies(host: string): Promise<void> {
  return ExpoPangolinAuthModule.clearHostCookies(host);
}
