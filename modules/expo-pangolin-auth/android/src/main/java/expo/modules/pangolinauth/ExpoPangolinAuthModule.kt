package expo.modules.pangolinauth

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class ExpoPangolinAuthModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoPangolinAuth")

    AsyncFunction("signIn") { url: String, cancelLabel: String, promise: Promise ->
      promise.reject("ERR_IOS_ONLY", "Pangolin sign-in is only available on iOS", null)
    }

    AsyncFunction("clearHostCookies") { host: String, promise: Promise ->
      promise.resolve(null)
    }
  }
}
