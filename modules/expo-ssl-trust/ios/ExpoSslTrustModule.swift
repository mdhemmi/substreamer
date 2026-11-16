import ExpoModulesCore
import Foundation
import Security

public class ExpoSslTrustModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoSslTrust")

        // At app launch (before RN makes its first request and caches its
        // NSURLSession): load the trust store and install the URLSession swizzle
        // so RN fetch / images / downloads consult SslTrustURLProtocol for
        // trusted self-signed hosts — the Android-equivalent "just works" path.
        // The local proxy is used only for AVPlayer streaming.
        OnCreate {
            SslTrustStore.shared.initialize()
            URLSessionConfiguration.sslTrustInstallSwizzle()
        }

        AsyncFunction("initTrustStore") { (promise: Promise) in
            SslTrustStore.shared.initialize()
            // Resolve the install status to match the Android contract
            // (`{ installed, error }`). iOS has no JSSE-style install failure,
            // so `error` is always null once initialize() has run.
            promise.resolve([
                "installed": SslTrustStore.shared.installSucceeded,
                "error": NSNull(),
            ])
        }

        AsyncFunction("getInstallStatus") { (promise: Promise) in
            promise.resolve([
                "installed": SslTrustStore.shared.installSucceeded,
                "error": NSNull(),
            ])
        }

        AsyncFunction("getCertificateInfo") { (url: String, promise: Promise) in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let info = try CertificateInspector.getCertificateInfo(urlString: url)
                    
                    // Store the DER data temporarily keyed by hostname
                    // so it's available when the user trusts the certificate
                    if let derData = info.derData,
                       let urlObj = URL(string: url),
                       let host = urlObj.host {
                        SslTrustStore.shared.storeCertificateData(hostname: host, derData: derData)
                    }
                    
                    let result: [String: Any] = [
                        "subject": info.subject,
                        "issuer": info.issuer,
                        "sha256Fingerprint": info.sha256Fingerprint,
                        "validFrom": info.validFrom,
                        "validTo": info.validTo,
                        "serialNumber": info.serialNumber,
                        "isSelfSigned": info.isSelfSigned,
                        "isSystemTrusted": info.isSystemTrusted
                    ]
                    promise.resolve(result)
                } catch {
                    promise.reject("ERR_CERT_FETCH", "Failed to fetch certificate: \(error.localizedDescription)")
                }
            }
        }
        
        AsyncFunction("trustCertificate") { (hostname: String, sha256Fingerprint: String, validTo: String?, promise: Promise) in
            SslTrustStore.shared.initialize()
            SslTrustStore.shared.trustCertificate(hostname: hostname, sha256Fingerprint: sha256Fingerprint, validTo: validTo)
            promise.resolve(nil)
        }

        AsyncFunction("removeTrustedCertificate") { (hostname: String, promise: Promise) in
            SslTrustStore.shared.initialize()
            SslTrustStore.shared.removeTrustedCertificate(hostname: hostname)
            promise.resolve(nil)
        }

        AsyncFunction("clearAllTrustedCertificates") { (promise: Promise) in
            SslTrustStore.shared.initialize()
            SslTrustStore.shared.clearAllTrustedCertificates()
            promise.resolve(nil)
        }
        
        AsyncFunction("getTrustedCertificates") { (promise: Promise) in
            SslTrustStore.shared.initialize()
            let certs = SslTrustStore.shared.getTrustedCertificates()
            promise.resolve(certs)
        }
        
        AsyncFunction("isCertificateTrusted") { (hostname: String, promise: Promise) in
            SslTrustStore.shared.initialize()
            let trusted = SslTrustStore.shared.isCertificateTrusted(hostname: hostname)
            promise.resolve(trusted)
        }

        // Headers the proxy adds when it forwards to one of `hosts`.
        AsyncFunction("setProxyGate") { (headers: [String: String], hosts: [String], promise: Promise) in
            SslTrustProxy.shared.setGate(headers: headers, hosts: hosts)
            promise.resolve(nil)
        }

        // Reconcile the local reverse proxy's upstreams. A URL is kept when its
        // host has a trusted self-signed cert OR was named by setProxyGate
        // (a Pangolin server with a public certificate). Returns
        // `{ port, upstreams: [{ baseUrl, token }] }` or null when nothing is
        // proxied. iOS only.
        AsyncFunction("syncProxyUpstreams") { (baseUrls: [String], promise: Promise) in
            SslTrustStore.shared.initialize()
            let gateHosts = SslTrustProxy.shared.gateHostSet()
            let trusted = baseUrls.filter { url in
                guard let host = URL(string: url)?.host else { return false }
                let name = host.lowercased().split(separator: ":").first.map(String.init) ?? host.lowercased()
                if gateHosts.contains(name) { return true }
                return SslTrustStore.shared.isCertificateTrusted(hostname: host)
            }
            for url in trusted { _ = SslTrustProxy.shared.register(baseUrl: url) }
            SslTrustProxy.shared.retainOnly(trusted)
            if trusted.isEmpty {
                SslTrustProxy.shared.stop()
                promise.resolve(NSNull())
            } else {
                promise.resolve(SslTrustProxy.shared.ensureRunningAndWait() ?? NSNull())
            }
        }

        // Current proxy info (live port + token map). Restarts the listener if
        // it dropped (e.g. after a background suspend), so the JS cache can be
        // refreshed on foreground. Null when nothing is registered.
        AsyncFunction("getProxyInfo") { (promise: Promise) in
            promise.resolve(SslTrustProxy.shared.ensureRunningAndWait() ?? NSNull())
        }
    }
}
