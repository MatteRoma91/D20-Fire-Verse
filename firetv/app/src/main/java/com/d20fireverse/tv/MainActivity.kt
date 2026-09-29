package com.d20fireverse.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The living-room table: a full-screen WebView on the table server, with a native front door
 * that finds the server on the Wi‑Fi (or takes a typed address) and remembers it.
 * Remote buttons the WebView does not forward (Back, Menu, media keys) are handed to the page.
 */
class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private lateinit var connect: View
    private lateinit var status: TextView
    private lateinit var spinner: ProgressBar
    private lateinit var tables: LinearLayout
    private lateinit var foundHeading: TextView
    private lateinit var address: EditText
    private lateinit var connectButton: Button
    private lateinit var prefs: SharedPreferences
    private lateinit var finder: TableFinder
    private var web: WebView? = null

    private val io: ExecutorService = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val found = LinkedHashMap<String, String>()

    /** The table the WebView is showing, or null while the front door is up. */
    private var tableUrl: String? = null
    private var attempt = 0
    private var autoPick = false
    private var lastBack = 0L
    private var lastRendererLoss = 0L
    private var warmed = false

    private val nobodyAnswered = Runnable {
        if (tableUrl == null && found.isEmpty() && connect.visibility == View.VISIBLE && !reaching) {
            spinner.visibility = View.GONE
            status.text = notice ?: getString(R.string.finding_none)
        }
    }
    private var reaching = false
    /** Why the front door came back up, kept on screen until the player acts. */
    private var notice: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.root)
        connect = findViewById(R.id.connect)
        status = findViewById(R.id.status)
        spinner = findViewById(R.id.spinner)
        tables = findViewById(R.id.tables)
        foundHeading = findViewById(R.id.foundHeading)
        address = findViewById(R.id.address)
        connectButton = findViewById(R.id.connectButton)
        findViewById<TextView>(R.id.title).typeface = Typeface.createFromAsset(assets, "fonts/Cinzel-Bold.ttf")

        prefs = getSharedPreferences("table", MODE_PRIVATE)
        finder = TableFinder(this, ::onTableFound)

        address.showSoftInputOnFocus = false
        address.setOnClickListener {
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(address, 0)
        }
        connectButton.setOnClickListener { connectTyped() }
        findViewById<Button>(R.id.retryButton).setOnClickListener { showConnect(null) }
        address.setOnEditorActionListener { _, actionId, event ->
            val go = actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            if (go) connectTyped()
            go
        }

        val remembered = prefs.getString(KEY_URL, null)
            ?: BuildConfig.DEFAULT_TABLE_URL.takeIf { it.isNotBlank() }?.let(TableAddress::normalize)
        if (remembered != null) reach(remembered) else showConnect(null, pickFirst = true)
    }

    // ------------------------------------------------------------------ front door

    private fun showConnect(message: String?, pickFirst: Boolean = false) {
        attempt += 1
        reaching = false
        autoPick = pickFirst
        notice = message
        closeTable()
        connect.visibility = View.VISIBLE
        status.text = message ?: getString(R.string.finding)
        spinner.visibility = View.VISIBLE
        found.clear()
        tables.removeAllViews()
        foundHeading.visibility = View.GONE
        prefs.getString(KEY_URL, null)?.let { if (address.text.isEmpty()) address.setText(TableAddress.display(it)) }
        finder.stop()
        finder.start()
        main.removeCallbacks(nobodyAnswered)
        main.postDelayed(nobodyAnswered, if (message == null) 6000L else 2500L)
        (if (address.text.isEmpty()) address else connectButton).requestFocus()
    }

    private fun onTableFound(table: TableFinder.FoundTable) {
        if (tableUrl != null || connect.visibility != View.VISIBLE || found.containsKey(table.url)) return
        found[table.url] = table.name
        if (autoPick && found.size == 1) {
            reach(table.url)
            return
        }
        foundHeading.visibility = View.VISIBLE
        if (!reaching) {
            spinner.visibility = View.GONE
            status.setText(R.string.found_status)
        }
        val button = Button(this, null, 0, R.style.FireVerse_Button).apply {
            text = getString(R.string.table_entry, table.name, TableAddress.display(table.url))
            isFocusable = true
            setOnClickListener { reach(table.url) }
        }
        val height = (60 * resources.displayMetrics.density).toInt()
        tables.addView(button, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height).apply {
            topMargin = (10 * resources.displayMetrics.density).toInt()
        })
        if (found.size == 1 && !reaching) button.requestFocus()
    }

    private fun connectTyped() {
        val url = TableAddress.normalize(address.text.toString())
        if (url == null) {
            spinner.visibility = View.GONE
            notice = getString(R.string.bad_address)
            status.text = notice
            address.requestFocus()
            return
        }
        reach(url)
    }

    /** Check that a table answers, then sit down at it and remember it. */
    private fun reach(url: String) {
        val mine = ++attempt
        reaching = true
        autoPick = false
        connect.visibility = View.VISIBLE
        spinner.visibility = View.VISIBLE
        status.text = getString(R.string.reaching, TableAddress.display(url))
        io.execute {
            val ok = TableAddress.probe(url)
            main.post {
                if (mine != attempt || isFinishing) return@post
                reaching = false
                if (ok) {
                    prefs.edit().putString(KEY_URL, url).apply()
                    openTable(url)
                } else {
                    showConnect(getString(R.string.unreachable, TableAddress.display(url)))
                }
            }
        }
    }

    fun changeTable() {
        showConnect(null)
    }

    // ------------------------------------------------------------------ the table

    private fun openTable(url: String) {
        finder.stop()
        main.removeCallbacks(nobodyAnswered)
        tableUrl = url
        val view = web ?: createWebView().also { web = it }
        connect.visibility = View.GONE
        view.visibility = View.VISIBLE
        view.loadUrl(url)
        view.requestFocus()
    }

    private fun closeTable() {
        tableUrl = null
        web?.let {
            it.stopLoading()
            it.loadUrl("about:blank")
            it.visibility = View.GONE
        }
    }

    private fun tableLost() {
        val url = tableUrl ?: return
        showConnect(getString(R.string.lost, TableAddress.display(url)))
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun createWebView(): WebView {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val view = WebView(this)
        view.setBackgroundColor(Color.rgb(12, 9, 6))
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.isVerticalScrollBarEnabled = false
        view.isHorizontalScrollBarEnabled = false
        with(view.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString = "$userAgentString FireVerseTV/${BuildConfig.VERSION_NAME}"
        }
        view.addJavascriptInterface(TableBridge(this), "FireVerseApp")
        view.webChromeClient = WebChromeClient()
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !onTable(request.url)

            @Deprecated("Fire OS 5 and 6")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = !onTable(Uri.parse(url))

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) main.post { tableLost() }
            }

            @Deprecated("Fire OS 5")
            override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M && failingUrl == tableUrl) main.post { tableLost() }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                val url = tableUrl
                root.removeView(view)
                view.destroy()
                if (web === view) web = null
                val now = SystemClock.uptimeMillis()
                val crashLoop = now - lastRendererLoss < RENDERER_LOOP_MS
                lastRendererLoss = now
                when {
                    url == null -> showConnect(null)
                    crashLoop -> showConnect(getString(R.string.renderer_lost, TableAddress.display(url)))
                    else -> openTable(url)
                }
                return true
            }
        }
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return view
    }

    private fun onTable(uri: Uri): Boolean {
        if (uri.scheme == "about") return true
        val base = Uri.parse(tableUrl ?: return false)
        return uri.host == base.host && effectivePort(uri) == effectivePort(base)
    }

    private fun effectivePort(uri: Uri) = if (uri.port > 0) uri.port else if (uri.scheme == "https") 443 else 80

    // ------------------------------------------------------------------ the remote

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val view = web
        if (view != null && tableUrl != null && view.visibility == View.VISIBLE) {
            val key = when (event.keyCode) {
                KeyEvent.KEYCODE_MENU -> "ContextMenu"
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> "MediaPlayPause"
                KeyEvent.KEYCODE_MEDIA_REWIND -> "MediaRewind"
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "MediaFastForward"
                else -> null
            }
            if (key != null) {
                if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) press(view, key)
                return true
            }
            if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) back(view)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun press(view: WebView, key: String) {
        val js = "(function(k){var t=document.activeElement||document.body;" +
            "t.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));" +
            "t.dispatchEvent(new KeyboardEvent('keyup',{key:k,bubbles:true,cancelable:true}));})(${JSONObject.quote(key)})"
        view.evaluateJavascript(js, null)
    }

    /** The page decides what Back means; only its home screen lets Back close the app. */
    private fun back(view: WebView) {
        val js = "(function(){try{return window.fireverseNative?window.fireverseNative.back():'unknown'}catch(e){return 'unknown'}})()"
        view.evaluateJavascript(js) { answer ->
            when {
                answer?.contains("exit") == true -> confirmExit()
                answer?.contains("unknown") == true -> {
                    press(view, "Escape")
                    confirmExit()
                }
            }
        }
    }

    private fun confirmExit() {
        val now = SystemClock.uptimeMillis()
        if (now - lastBack < EXIT_WINDOW_MS) {
            finish()
            return
        }
        lastBack = now
        Toast.makeText(this, R.string.exit_again, Toast.LENGTH_SHORT).show()
    }

    // ------------------------------------------------------------------ lifecycle

    /**
     * Chromium takes a while to wake on a Fire TV Stick, so it wakes while discovery and the
     * address check run rather than when the player sits down. Only after the window has taken
     * focus: blocking the main thread before that focus event lands reads as an ANR.
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || warmed) return
        warmed = true
        Looper.myQueue().addIdleHandler {
            if (web == null && !isFinishing && !isDestroyed) web = createWebView().apply { visibility = View.GONE }
            false
        }
    }

    override fun onResume() {
        super.onResume()
        web?.onResume()
        if (tableUrl == null && connect.visibility == View.VISIBLE) finder.start()
    }

    override fun onPause() {
        web?.onPause()
        finder.stop()
        super.onPause()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        io.shutdownNow()
        web?.destroy()
        web = null
        super.onDestroy()
    }

    private companion object {
        const val KEY_URL = "url"
        const val EXIT_WINDOW_MS = 2000L
        const val RENDERER_LOOP_MS = 60_000L
    }
}
