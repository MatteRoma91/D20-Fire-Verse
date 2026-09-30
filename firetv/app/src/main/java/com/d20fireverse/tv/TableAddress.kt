package com.d20fireverse.tv

import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Table server addresses: what people type, what the finder hears, and whether a table answers. */
object TableAddress {
    const val DEFAULT_PORT = 3100

    private val HOST = Regex("^[A-Za-z0-9.\\-]+$|^\\[[0-9A-Fa-f:.]+]$")

    fun url(host: String, port: Int): String {
        val h = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        return "http://$h:$port/"
    }

    /** "192.168.1.20", "192.168.1.20:3100" or "http://table.local:3100/x" → "http://host:port/". */
    fun normalize(input: String): String? {
        val raw = input.trim()
        if (raw.isEmpty()) return null
        val uri = Uri.parse(if (raw.contains("://")) raw else "http://$raw")
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.takeIf { it.isNotEmpty() } ?: return null
        val bracketed = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        if (!HOST.matches(bracketed)) return null
        val port = when {
            uri.port > 0 -> uri.port
            scheme == "https" -> 443
            else -> DEFAULT_PORT
        }
        return "$scheme://$bracketed:$port/"
    }

    /** How the address reads on screen. */
    fun display(url: String): String = url.substringAfter("://").removeSuffix("/")

    /** True when a FireVerse table answers at this address. Blocks: call it off the main thread. */
    fun probe(url: String, timeoutMs: Int = 3500): Boolean {
        return try {
            val connection = URL(url + "api/health").openConnection() as HttpURLConnection
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.useCaches = false
            try {
                if (connection.responseCode != HttpURLConnection.HTTP_OK) return false
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                JSONObject(body).optBoolean("ok", false)
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            false
        }
    }
}
