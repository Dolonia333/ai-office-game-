package com.visionclaw.app.network

import android.util.Log
import com.visionclaw.app.model.ServerMessage
import com.visionclaw.app.util.Constants
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class RelayWebSocket(
    private val onMessage: (ServerMessage) -> Unit,
    private val onConnected: () -> Unit,
    private val onDisconnected: (code: Int, reason: String) -> Unit,
    private val onError: (Throwable) -> Unit
) {
    companion object {
        private const val TAG = "RelayWebSocket"
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(Constants.WS_CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .readTimeout(Constants.WS_READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .pingInterval(Constants.WS_PING_INTERVAL_MS, TimeUnit.MILLISECONDS)
        .build()

    private var webSocket: WebSocket? = null

    @Volatile
    var isConnected = false
        private set

    fun connect(url: String) {
        disconnect()
        val request = Request.Builder().url(url).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket connected")
                isConnected = true
                onConnected()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = ServerMessage.parse(text)
                onMessage(msg)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code $reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code $reason")
                isConnected = false
                onDisconnected(code, reason)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
                isConnected = false
                onError(t)
            }
        })
    }

    fun disconnect() {
        webSocket?.close(1000, "Client disconnect")
        webSocket = null
        isConnected = false
    }

    fun sendFrame(base64Jpeg: String) {
        send(JSONObject().apply {
            put("type", "frame")
            put("data", base64Jpeg)
        })
    }

    fun sendAudio(base64Pcm: String) {
        send(JSONObject().apply {
            put("type", "audio")
            put("data", base64Pcm)
        })
    }

    fun sendMessage(text: String, frame: String? = null) {
        send(JSONObject().apply {
            put("type", "message")
            put("text", text)
            if (frame != null) put("frame", frame)
        })
    }

    fun sendConfig(model: String? = null, systemInstruction: String? = null) {
        send(JSONObject().apply {
            put("type", "config")
            if (model != null) put("model", model)
            if (systemInstruction != null) put("systemInstruction", systemInstruction)
        })
    }

    fun sendPing() {
        send(JSONObject().apply {
            put("type", "ping")
        })
    }

    private fun send(json: JSONObject) {
        if (isConnected) {
            webSocket?.send(json.toString())
        }
    }

    fun shutdown() {
        disconnect()
        client.dispatcher.executorService.shutdown()
    }
}
