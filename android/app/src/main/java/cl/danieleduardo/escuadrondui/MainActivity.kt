package cl.danieleduardo.escuadrondui

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * One full-screen WebView running the web build of the game, bundled in the APK
 * (`assets/www`) and served from https://appassets.androidplatform.net so the page
 * has a secure origin (Web Audio, localStorage) without touching the network.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var cargador: WebViewAssetLoader
    private var ultimoAtras = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configurarVentana()

        cargador = WebViewAssetLoader.Builder()
            .setDomain(DOMINIO)
            .addPathHandler("/", ServidorAssets(assets))
            .build()

        // The web build registers a service worker; its requests must also come from
        // the APK (and get a 404 for the worker itself, which isn't shipped).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)
        ) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                    cargador.shouldInterceptRequest(request.url)
            })
        }

        webView = crearWebView()
        setContentView(webView)
        webView.loadUrl(INICIO)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = atras()
        })
    }

    private fun configurarVentana() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
        )
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        ocultarBarras()
    }

    /** Immersive sticky: bars hidden, a swipe shows them briefly over the game. */
    private fun ocultarBarras() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun crearWebView(): WebView {
        val esDebug = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(esDebug)

        return WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#120c24"))
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            isHapticFeedbackEnabled = false
            isLongClickable = false
            setOnLongClickListener { true }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
            }

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                textZoom = 100
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                useWideViewPort = true
                loadWithOverviewMode = true
                allowFileAccess = false
                allowContentAccess = false
                setGeolocationEnabled(false)
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = false
            }

            addJavascriptInterface(PuenteJs(), PUENTE)
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(this, SCRIPT_INICIO, setOf(ORIGEN))
            }

            webViewClient = Cliente()
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                    if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR || m.messageLevel() == ConsoleMessage.MessageLevel.WARNING) {
                        Log.w(TAG, "consola ${m.messageLevel()}: ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                    }
                    return true
                }
            }
        }
    }

    private inner class Cliente : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            cargador.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.host == DOMINIO && esRutaDelJuego(url.path)) return false
            abrirExterno(externa(url))
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            // Old WebViews without document-start scripts: set the flag as early as we can.
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                view.evaluateJavascript(SCRIPT_INICIO, null)
            }
        }

        /*
         * The SPA moves between screens with history.pushState, which never reaches
         * shouldOverrideUrlLoading. Any screen outside the game (the yellow
         * «danieleduardo.cl» button goes to /clasico) opens in the browser instead,
         * and the page steps back to the game.
         */
        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            val uri = url?.let(Uri::parse) ?: return
            if (uri.host != DOMINIO || esRutaDelJuego(uri.path)) return
            abrirExterno(externa(uri))
            view.evaluateJavascript("history.length > 1 ? history.back() : location.replace('/aviones')", null)
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The renderer died (out of memory or a crash): rebuild instead of closing the app.
            Log.e(TAG, "renderer terminado (crash=${detail.didCrash()}), recreando")
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
            recreate()
            return true
        }
    }

    /** Called from the page as `window.AppAndroid.*`. Runs on a binder thread. */
    inner class PuenteJs {
        @JavascriptInterface
        fun abrirExterno(url: String) {
            runOnUiThread { this@MainActivity.abrirExterno(url) }
        }

        @JavascriptInterface
        fun salir() {
            runOnUiThread { finish() }
        }
    }

    private fun esRutaDelJuego(path: String?) = path.isNullOrEmpty() || path in RUTAS_JUEGO

    /** A same-origin URL of the app maps to the same page on the real site. */
    private fun externa(uri: Uri): String =
        if (uri.host == DOMINIO) "$SITIO${uri.encodedPath ?: "/"}${uri.encodedQuery?.let { "?$it" } ?: ""}"
        else uri.toString()

    private fun abrirExterno(url: String) {
        val uri = Uri.parse(url)
        val destino = if (uri.host == DOMINIO) externa(uri) else url
        val esquema = Uri.parse(destino).scheme?.lowercase()
        if (esquema !in setOf("https", "http", "mailto")) return
        try {
            // Its own task: the browser must not stack inside the game's singleTask task.
            startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(destino))
                    .addCategory(Intent.CATEGORY_BROWSABLE)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.sin_navegador, Toast.LENGTH_SHORT).show()
        }
    }

    /**
     * Back = Esc in the game (pause / leave a menu). A second back within 1.5 s exits.
     * The page can take over with `window.__appAndroidAtras = () => {...}`.
     */
    private fun atras() {
        val ahora = SystemClock.uptimeMillis()
        if (ahora - ultimoAtras < DOBLE_ATRAS_MS) {
            finish()
            return
        }
        ultimoAtras = ahora
        webView.evaluateJavascript(SCRIPT_ESCAPE, null)
        Toast.makeText(this, R.string.salir_otra_vez, Toast.LENGTH_SHORT).show()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) ocultarBarras()
    }

    override fun onPause() {
        super.onPause()
        // The game pauses itself on visibilitychange; this also stops its timers and audio thread.
        webView.onPause()
        webView.pauseTimers()
    }

    override fun onResume() {
        super.onResume()
        webView.resumeTimers()
        webView.onResume()
        ocultarBarras()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "EscuadronDui"
        private const val DOMINIO = "appassets.androidplatform.net"
        private const val ORIGEN = "https://$DOMINIO"
        private const val INICIO = "$ORIGEN/aviones"
        private const val SITIO = "https://danieleduardo.cl"
        private const val PUENTE = "AppAndroid"
        private const val DOBLE_ATRAS_MS = 1500L
        private val RUTAS_JUEGO = setOf("/", "/aviones", "/aviones/", "/index.html")

        private const val SCRIPT_INICIO = "window.__appAndroid = true;"

        private const val SCRIPT_ESCAPE = """(function () {
  if (typeof window.__appAndroidAtras === 'function') { window.__appAndroidAtras(); return; }
  var o = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true };
  var t = document.activeElement || document.body || document;
  t.dispatchEvent(new KeyboardEvent('keydown', o));
  t.dispatchEvent(new KeyboardEvent('keyup', o));
})();"""
    }
}
