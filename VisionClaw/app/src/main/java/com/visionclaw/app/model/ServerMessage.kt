package com.visionclaw.app.model

import org.json.JSONObject

sealed class ServerMessage {
    data class Audio(val data: String) : ServerMessage()
    data class Text(val content: String) : ServerMessage()
    data class ToolCall(val id: String, val name: String, val task: String) : ServerMessage()
    data class ToolResult(val id: String, val result: String) : ServerMessage()
    data class ToolCancelled(val id: String) : ServerMessage()
    data class Status(val state: String, val mode: String? = null, val warning: String? = null) : ServerMessage()
    data class ErrorMsg(val message: String) : ServerMessage()
    data class Response(val text: String) : ServerMessage()
    object Pong : ServerMessage()
    data class Unknown(val raw: String) : ServerMessage()

    companion object {
        fun parse(json: String): ServerMessage {
            return try {
                val obj = JSONObject(json)
                when (obj.optString("type")) {
                    "audio" -> Audio(obj.getString("data"))
                    "text" -> Text(obj.getString("content"))
                    "tool_call" -> ToolCall(
                        id = obj.getString("id"),
                        name = obj.getString("name"),
                        task = obj.getString("task")
                    )
                    "tool_result" -> ToolResult(
                        id = obj.getString("id"),
                        result = obj.getString("result")
                    )
                    "tool_cancelled" -> ToolCancelled(obj.getString("id"))
                    "status" -> Status(
                        state = obj.getString("state"),
                        mode = obj.optString("mode", null),
                        warning = obj.optString("warning", null)
                    )
                    "error" -> ErrorMsg(obj.getString("message"))
                    "response" -> Response(obj.getString("text"))
                    "pong" -> Pong
                    else -> Unknown(json)
                }
            } catch (e: Exception) {
                Unknown(json)
            }
        }
    }
}
