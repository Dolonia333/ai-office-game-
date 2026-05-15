package com.visionclaw.app.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Base64
import android.util.Log
import com.visionclaw.app.util.Constants
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

class AudioPlaybackManager {
    companion object {
        private const val TAG = "AudioPlaybackManager"
    }

    private var audioTrack: AudioTrack? = null
    private val isPlaying = AtomicBoolean(false)
    private val audioQueue = ConcurrentLinkedQueue<ByteArray>()
    private var playbackThread: Thread? = null

    fun start() {
        if (isPlaying.get()) return

        val bufferSize = AudioTrack.getMinBufferSize(
            Constants.AUDIO_SAMPLE_RATE_PLAYBACK,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )

        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(Constants.AUDIO_SAMPLE_RATE_PLAYBACK)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        audioTrack?.play()
        isPlaying.set(true)

        playbackThread = Thread({
            while (isPlaying.get()) {
                val chunk = audioQueue.poll()
                if (chunk != null) {
                    audioTrack?.write(chunk, 0, chunk.size)
                } else {
                    Thread.sleep(5)
                }
            }
        }, "AudioPlayback").also { it.start() }

        Log.d(TAG, "Audio playback started (${Constants.AUDIO_SAMPLE_RATE_PLAYBACK}Hz, mono, PCM16)")
    }

    fun enqueue(base64Pcm: String) {
        try {
            val pcmData = Base64.decode(base64Pcm, Base64.DEFAULT)
            audioQueue.add(pcmData)
        } catch (e: Exception) {
            Log.e(TAG, "Error decoding audio: ${e.message}")
        }
    }

    fun stop() {
        isPlaying.set(false)
        playbackThread?.join(1000)
        playbackThread = null
        audioQueue.clear()
        try {
            audioTrack?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping AudioTrack: ${e.message}")
        }
        audioTrack?.release()
        audioTrack = null
        Log.d(TAG, "Audio playback stopped")
    }
}
