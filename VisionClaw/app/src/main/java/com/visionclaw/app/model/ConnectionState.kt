package com.visionclaw.app.model

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    STREAMING,
    TOOL_EXECUTING,
    RECONNECTING,
    ERROR;

    val isActive: Boolean
        get() = this == CONNECTED || this == STREAMING || this == TOOL_EXECUTING

    val statusDrawableRes: Int
        get() = when (this) {
            DISCONNECTED -> com.visionclaw.app.R.drawable.ic_status_disconnected
            CONNECTING, RECONNECTING -> com.visionclaw.app.R.drawable.ic_status_disconnected
            CONNECTED -> com.visionclaw.app.R.drawable.ic_status_connected
            STREAMING -> com.visionclaw.app.R.drawable.ic_status_streaming
            TOOL_EXECUTING -> com.visionclaw.app.R.drawable.ic_status_streaming
            ERROR -> com.visionclaw.app.R.drawable.ic_status_error
        }

    val displayName: String
        get() = when (this) {
            DISCONNECTED -> "Disconnected"
            CONNECTING -> "Connecting..."
            CONNECTED -> "Connected"
            STREAMING -> "Streaming"
            TOOL_EXECUTING -> "Tool Executing"
            RECONNECTING -> "Reconnecting..."
            ERROR -> "Error"
        }
}
