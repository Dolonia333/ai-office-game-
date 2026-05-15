package com.visionclaw.app.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import com.visionclaw.app.util.Constants
import java.util.concurrent.atomic.AtomicBoolean

class AudioCaptureManager(
    private val onAudioChunk: (base64Pcm: String) -> Unit
) {
    companion object {
        private const val TAG = "AudioCaptureManager"
        private const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
    }

    private val isCapturing = AtomicBoolean(false)
    private var captureThread: Thread? = null
    private var audioRecord: AudioRecord? = null

    @SuppressLint("MissingPermission")
    fun start() {
        if (isCapturing.get()) return

        val bufferSize = AudioRecord.getMinBufferSize(
            Constants.AUDIO_SAMPLE_RATE_CAPTURE, CHANNEL, ENCODING
        ).coerceAtLeast(
            // Ensure buffer is at least one chunk's worth
            Constants.AUDIO_SAMPLE_RATE_CAPTURE * 2 * Constants.AUDIO_CHUNK_MS / 1000
        )

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            Constants.AUDIO_SAMPLE_RATE_CAPTURE,
            CHANNEL,
            ENCODING,
            bufferSize
        )

        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord failed to initialize")
            audioRecord?.release()
            audioRecord = null
            return
        }

        isCapturing.set(true)
        audioRecord?.startRecording()

        captureThread = Thread({
            val chunkBytes = Constants.AUDIO_SAMPLE_RATE_CAPTURE * 2 * Constants.AUDIO_CHUNK_MS / 1000
            val buffer = ByteArray(chunkBytes)

            while (isCapturing.get()) {
                val read = audioRecord?.read(buffer, 0, chunkBytes) ?: -1
                if (read > 0) {
                    val data = if (read == chunkBytes) buffer else buffer.copyOf(read)
                    val base64 = Base64.encodeToString(data, Base64.NO_WRAP)
                    onAudioChunk(base64)
                }
            }
        }, "AudioCapture").also { it.start() }

        Log.d(TAG, "Audio capture started (${Constants.AUDIO_SAMPLE_RATE_CAPTURE}Hz, mono, PCM16)")
    }

    fun stop() {
        isCapturing.set(false)
        captureThread?.join(1000)
        captureThread = null
        try {
            audioRecord?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping AudioRecord: ${e.message}")
        }
        audioRecord?.release()
        audioRecord = null
        Log.d(TAG, "Audio capture stopped")
    }
}
