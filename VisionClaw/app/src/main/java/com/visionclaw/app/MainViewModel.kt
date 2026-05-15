package com.visionclaw.app

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.visionclaw.app.audio.AudioCaptureManager
import com.visionclaw.app.audio.AudioPlaybackManager
import com.visionclaw.app.audio.BluetoothAudioRouter
import com.visionclaw.app.camera.CameraFrameManager
import com.visionclaw.app.model.ConnectionState
import com.visionclaw.app.model.LogEntry
import com.visionclaw.app.model.LogType
import com.visionclaw.app.model.ServerMessage
import com.visionclaw.app.network.RelayWebSocket
import com.visionclaw.app.util.Constants
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class MainViewModel(application: Application) : AndroidViewModel(application) {
    companion object {
        private const val TAG = "MainViewModel"
    }

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    private val _logs = MutableStateFlow<List<LogEntry>>(emptyList())
    val logs: StateFlow<List<LogEntry>> = _logs

    private val _btConnected = MutableStateFlow(false)
    val btConnected: StateFlow<Boolean> = _btConnected

    private var serverUrl: String = Constants.DEFAULT_SERVER_URL

    // --- Managers ---

    private var relay: RelayWebSocket? = null

    val cameraFrameManager = CameraFrameManager { base64Jpeg ->
        relay?.sendFrame(base64Jpeg)
    }

    private val audioCapture = AudioCaptureManager { base64Pcm ->
        relay?.sendAudio(base64Pcm)
    }

    private val audioPlayback = AudioPlaybackManager()

    val bluetoothRouter = BluetoothAudioRouter(application).apply {
        onConnectionChanged = { connected ->
            _btConnected.value = connected
            addLog(
                if (connected) LogType.INFO else LogType.INFO,
                if (connected) "Bluetooth glasses connected" else "Bluetooth glasses disconnected"
            )
        }
    }

    // --- Public API ---

    fun connect(url: String) {
        if (_connectionState.value.isActive) return

        serverUrl = url
        _connectionState.value = ConnectionState.CONNECTING
        addLog(LogType.INFO, "Connecting to $url...")

        relay = RelayWebSocket(
            onMessage = { msg -> handleMessage(msg) },
            onConnected = {
                viewModelScope.launch(Dispatchers.Main) {
                    _connectionState.value = ConnectionState.CONNECTED
                    addLog(LogType.STATUS, "WebSocket connected")
                    startStreaming()
                }
            },
            onDisconnected = { code, reason ->
                viewModelScope.launch(Dispatchers.Main) {
                    stopStreaming()
                    _connectionState.value = ConnectionState.DISCONNECTED
                    addLog(LogType.STATUS, "Disconnected ($code: $reason)")
                }
            },
            onError = { err ->
                viewModelScope.launch(Dispatchers.Main) {
                    stopStreaming()
                    _connectionState.value = ConnectionState.ERROR
                    addLog(LogType.ERROR, "Connection error: ${err.message}")
                }
            }
        )

        relay?.connect(url)
    }

    fun disconnect() {
        stopStreaming()
        relay?.disconnect()
        relay = null
        _connectionState.value = ConnectionState.DISCONNECTED
        addLog(LogType.STATUS, "Disconnected")
    }

    fun setFrameRate(fps: Float) {
        cameraFrameManager.setFrameRate(fps)
    }

    fun startBluetooth() {
        bluetoothRouter.start()
    }

    fun stopBluetooth() {
        bluetoothRouter.stop()
    }

    override fun onCleared() {
        super.onCleared()
        disconnect()
        bluetoothRouter.stop()
        relay?.shutdown()
    }

    // --- Private ---

    private fun startStreaming() {
        cameraFrameManager.start()
        audioCapture.start()
        audioPlayback.start()
        _connectionState.value = ConnectionState.STREAMING
        addLog(LogType.STATUS, "Streaming started (camera + audio)")
    }

    private fun stopStreaming() {
        cameraFrameManager.stop()
        audioCapture.stop()
        audioPlayback.stop()
    }

    private fun handleMessage(msg: ServerMessage) {
        viewModelScope.launch(Dispatchers.Main) {
            when (msg) {
                is ServerMessage.Audio -> {
                    audioPlayback.enqueue(msg.data)
                }
                is ServerMessage.Text -> {
                    addLog(LogType.TEXT, msg.content)
                }
                is ServerMessage.ToolCall -> {
                    _connectionState.value = ConnectionState.TOOL_EXECUTING
                    val taskPreview = if (msg.task.length > 80) msg.task.take(80) + "..." else msg.task
                    addLog(LogType.TOOL_CALL, "[${msg.name}] $taskPreview")
                }
                is ServerMessage.ToolResult -> {
                    val resultPreview = if (msg.result.length > 120) msg.result.take(120) + "..." else msg.result
                    addLog(LogType.TOOL_RESULT, resultPreview)
                    _connectionState.value = ConnectionState.STREAMING
                }
                is ServerMessage.ToolCancelled -> {
                    addLog(LogType.INFO, "Tool call cancelled: ${msg.id}")
                    _connectionState.value = ConnectionState.STREAMING
                }
                is ServerMessage.Status -> {
                    val newState = when (msg.state) {
                        "connected" -> ConnectionState.CONNECTED
                        "streaming" -> ConnectionState.STREAMING
                        "tool_executing" -> ConnectionState.TOOL_EXECUTING
                        "gemini_disconnected" -> ConnectionState.DISCONNECTED
                        "reconnecting" -> ConnectionState.RECONNECTING
                        "thinking" -> ConnectionState.STREAMING
                        else -> _connectionState.value
                    }
                    _connectionState.value = newState
                    addLog(LogType.STATUS, "State: ${msg.state}" +
                        (msg.mode?.let { " (mode: $it)" } ?: "") +
                        (msg.warning?.let { " - $it" } ?: ""))

                    // Start streaming when we get connected status
                    if (newState == ConnectionState.CONNECTED || newState == ConnectionState.STREAMING) {
                        if (!cameraFrameManager.let { true }) { // already started in onConnected
                            // no-op, streaming already started
                        }
                    }
                }
                is ServerMessage.ErrorMsg -> {
                    addLog(LogType.ERROR, msg.message)
                }
                is ServerMessage.Response -> {
                    addLog(LogType.TEXT, msg.text)
                }
                is ServerMessage.Pong -> {
                    // keepalive ack, ignore
                }
                is ServerMessage.Unknown -> {
                    Log.w(TAG, "Unknown message: ${msg.raw.take(100)}")
                }
            }
        }
    }

    private fun addLog(type: LogType, message: String) {
        val entry = LogEntry(type = type, message = message)
        val current = _logs.value.toMutableList()
        current.add(entry)
        if (current.size > Constants.MAX_LOG_ENTRIES) {
            current.removeAt(0)
        }
        _logs.value = current
    }
}
