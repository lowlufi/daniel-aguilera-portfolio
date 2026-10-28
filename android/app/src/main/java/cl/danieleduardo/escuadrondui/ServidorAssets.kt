package cl.danieleduardo.escuadrondui

import android.content.res.AssetManager
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Serves the built site from `assets/www/` at the root of the asset loader's origin,
 * like the real host does: files by path, and `index.html` for any route that isn't
 * a file (`/`, `/aviones`), since the SPA picks its screen from `location.pathname`.
 */
class ServidorAssets(private val assets: AssetManager) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse? {
        val limpio = path.trimStart('/')
        if (limpio.split('/').any { it == ".." }) return noEncontrado()
        val ultimo = limpio.substringAfterLast('/')
        val esRuta = limpio.isEmpty() || limpio.endsWith('/') || !ultimo.contains('.')
        val archivo = if (esRuta) "index.html" else limpio
        return try {
            val stream = assets.open("$RAIZ/$archivo")
            val mime = mimeDe(archivo)
            val texto = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("xml") || mime == "image/svg+xml"
            WebResourceResponse(mime, if (texto) "utf-8" else null, 200, "OK", cabeceras(archivo), stream)
        } catch (_: IOException) {
            noEncontrado()
        }
    }

    private fun cabeceras(archivo: String): Map<String, String> = mapOf(
        "Cache-Control" to if (archivo.startsWith("assets/")) "public, max-age=31536000, immutable" else "no-cache",
        "Access-Control-Allow-Origin" to "*",
    )

    // A real 404 (not null) so a missing file never falls through to the network,
    // e.g. the service worker the web build registers, which the app doesn't ship.
    private fun noEncontrado() = WebResourceResponse(
        "text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)),
    )

    private fun mimeDe(archivo: String): String = when (archivo.substringAfterLast('.').lowercase()) {
        "html", "htm" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json", "map" -> "application/json"
        "webmanifest" -> "application/manifest+json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        "mp3" -> "audio/mpeg"
        "ogg" -> "audio/ogg"
        "wav" -> "audio/wav"
        "mp4" -> "video/mp4"
        "webm" -> "video/webm"
        "wasm" -> "application/wasm"
        "txt" -> "text/plain"
        "xml" -> "application/xml"
        else -> "application/octet-stream"
    }

    companion object {
        const val RAIZ = "www"
    }
}
