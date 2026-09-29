package com.d20fireverse.tv

import android.webkit.JavascriptInterface

/** What the table page may ask of the app, exposed as `window.FireVerseApp`. */
class TableBridge(private val activity: MainActivity) {

    /** Leave the current table and pick another server. */
    @JavascriptInterface
    fun changeTable() {
        activity.runOnUiThread { activity.changeTable() }
    }

    @JavascriptInterface
    fun exit() {
        activity.runOnUiThread { activity.finish() }
    }

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME
}
