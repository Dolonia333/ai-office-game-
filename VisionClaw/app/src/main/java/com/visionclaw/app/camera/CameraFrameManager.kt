package com.visionclaw.app.camera

import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Base64
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.visionclaw.app.util.Constants
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class CameraFrameManager(
    private val onFrame: (base64Jpeg: String) -> Unit
) : ImageAnalysis.Analyzer {
    companion object {
        private const val TAG = "CameraFrameManager"
    }

    private val isActive = AtomicBoolean(false)
    private val lastFrameTime = AtomicLong(0)

    @Volatile
    var frameIntervalMs: Long = (1000.0 / Constants.DEFAULT_FRAME_RATE_FPS).toLong()
        private set

    fun setFrameRate(fps: Float) {
        frameIntervalMs = (1000.0 / fps.coerceIn(Constants.MIN_FRAME_RATE_FPS, Constants.MAX_FRAME_RATE_FPS)).toLong()
    }

    fun start() {
        isActive.set(true)
    }

    fun stop() {
        isActive.set(false)
    }

    override fun analyze(image: ImageProxy) {
        try {
            if (!isActive.get()) {
                image.close()
                return
            }

            val now = System.currentTimeMillis()
            if (now - lastFrameTime.get() < frameIntervalMs) {
                image.close()
                return
            }
            lastFrameTime.set(now)

            val jpeg = imageProxyToJpeg(image)
            if (jpeg != null) {
                val base64 = Base64.encodeToString(jpeg, Base64.NO_WRAP)
                onFrame(base64)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error analyzing frame: ${e.message}")
        } finally {
            image.close()
        }
    }

    private fun imageProxyToJpeg(image: ImageProxy): ByteArray? {
        if (image.format != ImageFormat.YUV_420_888) {
            return null
        }

        val yBuffer = image.planes[0].buffer
        val uBuffer = image.planes[1].buffer
        val vBuffer = image.planes[2].buffer

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = ByteArray(ySize + uSize + vSize)

        // Y plane
        yBuffer.get(nv21, 0, ySize)
        // VU interleaved for NV21
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)

        val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), Constants.JPEG_QUALITY, out)
        return out.toByteArray()
    }
}
