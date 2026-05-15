package com.visionclaw.app

import android.Manifest
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.style.ForegroundColorSpan
import android.widget.ScrollView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.visionclaw.app.databinding.ActivityMainBinding
import com.visionclaw.app.model.ConnectionState
import com.visionclaw.app.model.LogEntry
import com.visionclaw.app.model.LogType
import com.visionclaw.app.util.Constants
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val viewModel: MainViewModel by viewModels()
    private lateinit var prefs: SharedPreferences
    private lateinit var cameraExecutor: ExecutorService

    private val requiredPermissions: Array<String>
        get() = buildList {
            add(Manifest.permission.CAMERA)
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                add(Manifest.permission.BLUETOOTH_CONNECT)
            }
        }.toTypedArray()

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.all { it.value }
        if (allGranted) {
            setupCamera()
            viewModel.startBluetooth()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = getSharedPreferences(Constants.PREFS_NAME, MODE_PRIVATE)
        cameraExecutor = Executors.newSingleThreadExecutor()

        setupUI()
        observeState()
        requestPermissions()
    }

    private fun setupUI() {
        // Restore saved URL
        val savedUrl = prefs.getString(Constants.PREF_SERVER_URL, Constants.DEFAULT_SERVER_URL)
        binding.serverUrlInput.setText(savedUrl)

        // Restore saved FPS
        val savedFps = prefs.getFloat(Constants.PREF_FRAME_RATE, Constants.DEFAULT_FRAME_RATE_FPS)
        binding.fpsSlider.value = savedFps
        updateFpsLabel(savedFps)
        viewModel.setFrameRate(savedFps)

        // Connect button
        binding.connectButton.setOnClickListener {
            if (viewModel.connectionState.value.isActive ||
                viewModel.connectionState.value == ConnectionState.CONNECTING) {
                viewModel.disconnect()
            } else {
                val url = binding.serverUrlInput.text.toString().trim()
                if (url.isNotEmpty()) {
                    prefs.edit().putString(Constants.PREF_SERVER_URL, url).apply()
                    viewModel.connect(url)
                }
            }
        }

        // FPS slider
        binding.fpsSlider.addOnChangeListener { _, value, _ ->
            updateFpsLabel(value)
            viewModel.setFrameRate(value)
            prefs.edit().putFloat(Constants.PREF_FRAME_RATE, value).apply()
        }
    }

    private fun updateFpsLabel(fps: Float) {
        binding.fpsLabel.text = String.format(getString(R.string.frame_rate), fps)
    }

    private fun observeState() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    viewModel.connectionState.collect { state ->
                        binding.statusText.text = state.displayName
                        binding.statusIndicator.setImageResource(state.statusDrawableRes)
                        binding.connectButton.text = if (state.isActive || state == ConnectionState.CONNECTING) {
                            getString(R.string.disconnect)
                        } else {
                            getString(R.string.connect)
                        }
                        binding.serverUrlInput.isEnabled = !state.isActive && state != ConnectionState.CONNECTING
                    }
                }

                launch {
                    viewModel.logs.collect { logs ->
                        renderLogs(logs)
                    }
                }

                launch {
                    viewModel.btConnected.collect { connected ->
                        binding.btStatus.text = if (connected) {
                            getString(R.string.bt_connected)
                        } else {
                            getString(R.string.bt_disconnected)
                        }
                        binding.btStatus.setTextColor(
                            ContextCompat.getColor(
                                this@MainActivity,
                                if (connected) R.color.status_connected else R.color.status_disconnected
                            )
                        )
                    }
                }
            }
        }
    }

    private fun renderLogs(logs: List<LogEntry>) {
        val sb = SpannableStringBuilder()
        val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

        for (entry in logs) {
            val time = timeFormat.format(Date(entry.timestamp))
            val prefix = "[$time] "
            val line = "$prefix${entry.message}\n"
            val start = sb.length
            sb.append(line)

            val color = when (entry.type) {
                LogType.TOOL_CALL -> ContextCompat.getColor(this, R.color.log_tool_call)
                LogType.TOOL_RESULT -> ContextCompat.getColor(this, R.color.log_tool_result)
                LogType.ERROR -> ContextCompat.getColor(this, R.color.log_error)
                LogType.TEXT -> ContextCompat.getColor(this, R.color.log_text)
                LogType.STATUS -> Color.parseColor("#90CAF9")
                LogType.INFO -> Color.parseColor("#B0BEC5")
            }
            sb.setSpan(
                ForegroundColorSpan(color),
                start,
                start + line.length,
                Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
            )
        }

        binding.logText.text = sb
        binding.logScroll.post {
            binding.logScroll.fullScroll(ScrollView.FOCUS_DOWN)
        }
    }

    private fun requestPermissions() {
        val needed = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isEmpty()) {
            setupCamera()
            viewModel.startBluetooth()
        } else {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun setupCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder()
                .build()
                .also { it.surfaceProvider = binding.cameraPreview.surfaceProvider }

            val imageAnalysis = ImageAnalysis.Builder()
                .setTargetResolution(android.util.Size(Constants.CAMERA_WIDTH, Constants.CAMERA_HEIGHT))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { it.setAnalyzer(cameraExecutor, viewModel.cameraFrameManager) }

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    imageAnalysis
                )
            } catch (e: Exception) {
                android.util.Log.e("MainActivity", "Camera bind failed: ${e.message}")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
        viewModel.stopBluetooth()
    }
}
