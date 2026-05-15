package com.visionclaw.app.audio

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.util.Log

class BluetoothAudioRouter(private val context: Context) {
    companion object {
        private const val TAG = "BluetoothAudioRouter"
    }

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private var bluetoothHeadset: BluetoothHeadset? = null
    private var isRouted = false

    var onConnectionChanged: ((connected: Boolean) -> Unit)? = null

    private val profileListener = object : BluetoothProfile.ServiceListener {
        override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
            if (profile == BluetoothProfile.HEADSET) {
                bluetoothHeadset = proxy as BluetoothHeadset
                checkAndRoute()
            }
        }

        override fun onServiceDisconnected(profile: Int) {
            if (profile == BluetoothProfile.HEADSET) {
                bluetoothHeadset = null
                isRouted = false
                onConnectionChanged?.invoke(false)
            }
        }
    }

    private val scoReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED -> {
                    val state = intent.getIntExtra(
                        AudioManager.EXTRA_SCO_AUDIO_STATE,
                        AudioManager.SCO_AUDIO_STATE_DISCONNECTED
                    )
                    when (state) {
                        AudioManager.SCO_AUDIO_STATE_CONNECTED -> {
                            Log.d(TAG, "SCO audio connected")
                            isRouted = true
                            onConnectionChanged?.invoke(true)
                        }
                        AudioManager.SCO_AUDIO_STATE_DISCONNECTED -> {
                            Log.d(TAG, "SCO audio disconnected")
                            isRouted = false
                            onConnectionChanged?.invoke(false)
                        }
                    }
                }
                BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED -> {
                    val state = intent.getIntExtra(
                        BluetoothProfile.EXTRA_STATE,
                        BluetoothProfile.STATE_DISCONNECTED
                    )
                    if (state == BluetoothProfile.STATE_CONNECTED) {
                        checkAndRoute()
                    } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                        stopSco()
                        onConnectionChanged?.invoke(false)
                    }
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun start() {
        val filter = IntentFilter().apply {
            addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
            addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(scoReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(scoReceiver, filter)
        }

        bluetoothManager?.adapter?.getProfileProxy(context, profileListener, BluetoothProfile.HEADSET)
    }

    fun stop() {
        stopSco()
        try {
            context.unregisterReceiver(scoReceiver)
        } catch (_: Exception) {}

        bluetoothHeadset?.let {
            bluetoothManager?.adapter?.closeProfileProxy(BluetoothProfile.HEADSET, it)
        }
        bluetoothHeadset = null
    }

    val isBluetoothConnected: Boolean
        get() = isRouted

    @SuppressLint("MissingPermission")
    private fun checkAndRoute() {
        val headset = bluetoothHeadset ?: return
        val devices = headset.connectedDevices
        if (devices.isNotEmpty()) {
            Log.d(TAG, "BT headset found: ${devices[0].name}, starting SCO")
            startSco()
        }
    }

    private fun startSco() {
        if (!isRouted) {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            @Suppress("DEPRECATION")
            audioManager.startBluetoothSco()
            audioManager.isBluetoothScoOn = true
        }
    }

    private fun stopSco() {
        if (isRouted) {
            audioManager.isBluetoothScoOn = false
            @Suppress("DEPRECATION")
            audioManager.stopBluetoothSco()
            audioManager.mode = AudioManager.MODE_NORMAL
            isRouted = false
        }
    }
}
