import ExpoModulesCore
import UIKit
import WebKit

public class ExpoPangolinAuthModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoPangolinAuth")

        AsyncFunction("signIn") { (urlString: String, cancelLabel: String, promise: Promise) in
            DispatchQueue.main.async {
                guard let url = URL(string: urlString), let host = url.host, !host.isEmpty else {
                    promise.reject("ERR_URL", "Invalid server URL")
                    return
                }
                PangolinSignInPresenter.shared.present(
                    url: url,
                    host: host,
                    cancelLabel: cancelLabel,
                    promise: promise
                )
            }
        }

        AsyncFunction("clearHostCookies") { (host: String, promise: Promise) in
            DispatchQueue.main.async {
                PangolinCookieJar.remove(host: host) {
                    promise.resolve(nil)
                }
            }
        }
    }
}

enum PangolinCookieJar {
    static func domainMatches(_ cookieDomain: String, host: String) -> Bool {
        let domain = cookieDomain.lowercased()
        let name = host.lowercased()
        return domain == name || domain == ".\(name)"
    }

    static func remove(host: String, done: @escaping () -> Void) {
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.getAllCookies { cookies in
            let matching = cookies.filter { domainMatches($0.domain, host: host) }
            let group = DispatchGroup()
            for cookie in matching {
                group.enter()
                store.delete(cookie) { group.leave() }
            }
            group.notify(queue: .main) { done() }
        }
    }
}

/// Loads the resource URL and resolves once the visible page is back on that
/// host with at least one cookie for it. Badger's login redirect runs inside
/// the web view. Cookies for other hosts (the identity provider) are left alone.
final class PangolinSignInPresenter: NSObject, WKNavigationDelegate {
    static let shared = PangolinSignInPresenter()

    private var promise: Promise?
    private var host = ""
    private var controller: UIViewController?
    private var webView: WKWebView?
    private var settled = false

    func present(url: URL, host: String, cancelLabel: String, promise: Promise) {
        self.promise = promise
        self.host = host.lowercased()
        self.settled = false
        PangolinCookieJar.remove(host: host) { [weak self] in
            self?.show(url: url, cancelLabel: cancelLabel)
        }
    }

    private func show(url: URL, cancelLabel: String) {
        guard let presenter = topViewController() else {
            finish(reject: ("ERR_NO_WINDOW", "No window to present Pangolin sign-in"))
            return
        }
        let web = WKWebView(frame: .zero)
        web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        webView = web

        let vc = UIViewController()
        vc.view.backgroundColor = .systemBackground
        let bar = UIToolbar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.items = [
            UIBarButtonItem(title: cancelLabel, style: .plain, target: self, action: #selector(cancelTapped)),
        ]
        vc.view.addSubview(bar)
        vc.view.addSubview(web)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: vc.view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: vc.view.trailingAnchor),
            web.topAnchor.constraint(equalTo: bar.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: vc.view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: vc.view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: vc.view.bottomAnchor),
        ])
        vc.modalPresentationStyle = .pageSheet
        controller = vc
        presenter.present(vc, animated: true) {
            web.load(URLRequest(url: url))
        }
    }

    @objc private func cancelTapped() {
        finish(reject: ("ERR_CANCELLED", "Pangolin sign-in cancelled"))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let pageHost = webView.url?.host?.lowercased(), pageHost == host, !settled else { return }
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self, !self.settled else { return }
            let matched = cookies.filter { PangolinCookieJar.domainMatches($0.domain, host: self.host) }
            guard !matched.isEmpty else { return }
            let payload: [[String: Any]] = matched.map { cookie in
                [
                    "name": cookie.name,
                    "value": cookie.value,
                    "expiresAt": cookie.expiresDate.map { $0.timeIntervalSince1970 * 1000 } ?? NSNull(),
                ]
            }
            self.finish(resolve: payload)
        }
    }

    private func finish(resolve value: [[String: Any]]) {
        guard !settled else { return }
        settled = true
        let pending = promise
        dismiss {
            pending?.resolve(value)
        }
    }

    private func finish(reject: (String, String)) {
        guard !settled else { return }
        settled = true
        let pending = promise
        dismiss {
            pending?.reject(reject.0, reject.1)
        }
    }

    private func dismiss(then: @escaping () -> Void) {
        DispatchQueue.main.async {
            guard let controller = self.controller else {
                self.promise = nil
                self.webView = nil
                then()
                return
            }
            controller.dismiss(animated: true) {
                self.controller = nil
                self.webView = nil
                self.promise = nil
                then()
            }
        }
    }
}

private func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    let root = scene?.windows.first { $0.isKeyWindow }?.rootViewController ?? scene?.windows.first?.rootViewController
    var top = root
    while let presented = top?.presentedViewController {
        top = presented
    }
    return top
}
