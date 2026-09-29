package com.d20fireverse.tv

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import java.net.Inet4Address

/**
 * Listens for table servers announcing themselves on the local network (mDNS `_fireverse._tcp`).
 * Found tables are reported on the main thread. Resolution runs one service at a time because
 * older Fire OS builds reject concurrent resolves.
 */
class TableFinder(context: Context, private val onFound: (FoundTable) -> Unit) {

    data class FoundTable(val name: String, val url: String)

    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val main = Handler(Looper.getMainLooper())
    private val pending = ArrayDeque<NsdServiceInfo>()
    private var listener: NsdManager.DiscoveryListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var resolving = false

    val running: Boolean get() = listener != null

    fun start() {
        if (listener != null) return
        multicastLock = wifi.createMulticastLock("fireverse-finder").apply {
            setReferenceCounted(false)
            acquire()
        }
        val discovery = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onServiceLost(service: NsdServiceInfo) = Unit
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit

            override fun onServiceFound(service: NsdServiceInfo) {
                main.post { if (listener === this) enqueue(service) }
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                main.post { if (listener === this) release() }
            }
        }
        listener = discovery
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
        } catch (_: RuntimeException) {
            release()
        }
    }

    fun stop() {
        val discovery = listener ?: return
        try {
            nsd.stopServiceDiscovery(discovery)
        } catch (_: RuntimeException) {
            // Already stopped by the system.
        }
        release()
    }

    private fun release() {
        listener = null
        pending.clear()
        multicastLock?.let { if (it.isHeld) it.release() }
        multicastLock = null
    }

    private fun enqueue(service: NsdServiceInfo) {
        pending.addLast(service)
        resolveNext()
    }

    @Suppress("DEPRECATION")
    private fun resolveNext() {
        if (resolving) return
        val service = pending.removeFirstOrNull() ?: return
        resolving = true
        try {
            nsd.resolveService(service, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    main.post {
                        resolving = false
                        resolveNext()
                    }
                }

                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    main.post {
                        resolving = false
                        val host = serviceInfo.host
                        if (listener != null && host != null) {
                            val address = if (host is Inet4Address) host.hostAddress else host.hostAddress?.substringBefore('%')
                            if (address != null) onFound(FoundTable(serviceInfo.serviceName, TableAddress.url(address, serviceInfo.port)))
                        }
                        resolveNext()
                    }
                }
            })
        } catch (_: RuntimeException) {
            resolving = false
            resolveNext()
        }
    }

    companion object {
        const val SERVICE_TYPE = "_fireverse._tcp."
    }
}
