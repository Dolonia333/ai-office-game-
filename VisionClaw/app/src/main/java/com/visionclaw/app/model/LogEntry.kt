package com.visionclaw.app.model

data class LogEntry(
    val timestamp: Long = System.currentTimeMillis(),
    val type: LogType,
    val message: String
)

enum class LogType {
    INFO,
    TEXT,
    TOOL_CALL,
    TOOL_RESULT,
    ERROR,
    STATUS
}
