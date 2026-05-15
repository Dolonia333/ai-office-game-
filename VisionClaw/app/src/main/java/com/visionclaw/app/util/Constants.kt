package com.visionclaw.app.util

object Constants {
    const val DEFAULT_SERVER_URL = "ws://192.168.1.232:18791"
    const val DEFAULT_FRAME_RATE_FPS = 1.0f
    const val MIN_FRAME_RATE_FPS = 0.5f
    const val MAX_FRAME_RATE_FPS = 5.0f

    const val JPEG_QUALITY = 70
    const val CAMERA_WIDTH = 640
    const val CAMERA_HEIGHT = 480

    const val AUDIO_SAMPLE_RATE_CAPTURE = 16000
    const val AUDIO_SAMPLE_RATE_PLAYBACK = 24000
    const val AUDIO_CHUNK_MS = 100

    const val WS_PING_INTERVAL_MS = 15_000L
    const val WS_CONNECT_TIMEOUT_MS = 20_000L
    const val WS_READ_TIMEOUT_MS = 0L // no read timeout for streaming

    const val MAX_LOG_ENTRIES = 200

    const val PREFS_NAME = "visionclaw_prefs"
    const val PREF_SERVER_URL = "server_url"
    const val PREF_FRAME_RATE = "frame_rate"
}
