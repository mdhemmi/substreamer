export {
  getCertificateInfo,
  trustCertificate,
  removeTrustedCertificate,
  clearAllTrustedCertificates,
  getTrustedCertificates,
  isCertificateTrusted,
  initTrustStore,
  getInstallStatus,
  isSSLError,
  resolveServerBase,
  rewriteThroughProxy,
  setProxyGate,
  refreshProxyUpstreams,
  refreshProxyInfo,
  __setProxyInfoForTests,
} from './ExpoSslTrust';

export type {
  CertificateInfo,
  TrustedCert,
  TrustStoreInstallStatus,
  ProxyInfo,
  ProxyUpstream,
} from './ExpoSslTrust';
