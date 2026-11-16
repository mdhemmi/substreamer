import { requireNativeModule } from 'expo-modules-core';

export interface PangolinNativeCookie {
  name: string;
  value: string;
  expiresAt: number | null;
}

interface ExpoPangolinAuthNative {
  signIn(serverUrl: string, cancelLabel: string): Promise<PangolinNativeCookie[]>;
  clearHostCookies(host: string): Promise<void>;
}

let module: ExpoPangolinAuthNative;

try {
  module = requireNativeModule<ExpoPangolinAuthNative>('ExpoPangolinAuth');
} catch {
  console.warn(
    '[expo-pangolin-auth] Native module not found. ' +
      'Run `npx expo run:ios` to rebuild with the native module.',
  );
  module = {
    signIn: () => Promise.reject(new Error('Pangolin sign-in is only available on iOS')),
    clearHostCookies: () => Promise.resolve(),
  };
}

export default module;
