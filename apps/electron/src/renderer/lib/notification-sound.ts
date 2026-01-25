/**
 * Notification Sound Player
 *
 * Uses Web Audio API to play a pleasant notification tone with volume control.
 * Generates the sound programmatically - no audio file needed.
 */

let audioContext: AudioContext | null = null

/**
 * Get or create the AudioContext (lazy initialization)
 */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

/**
 * Play a notification sound with the specified volume.
 *
 * Creates a pleasant two-tone chime similar to macOS notifications.
 *
 * @param volume - Volume level from 0 to 100
 */
export function playNotificationSound(volume: number): void {
  try {
    const ctx = getAudioContext()

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    // Convert volume (0-100) to gain (0-1), with some curve for better perception
    const gain = Math.pow(volume / 100, 2) * 0.3 // Max gain of 0.3 to avoid being too loud

    const now = ctx.currentTime

    // Create a pleasant two-tone chime
    // First tone: Higher pitch
    playTone(ctx, 880, now, 0.1, gain) // A5
    // Second tone: Lower pitch, slightly delayed
    playTone(ctx, 659.25, now + 0.1, 0.15, gain * 0.8) // E5
  } catch (error) {
    console.error('Failed to play notification sound:', error)
  }
}

/**
 * Play a single tone
 */
function playTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  volume: number
): void {
  // Create oscillator for the tone
  const oscillator = ctx.createOscillator()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(frequency, startTime)

  // Create gain node for volume and envelope
  const gainNode = ctx.createGain()
  gainNode.gain.setValueAtTime(0, startTime)
  // Quick attack
  gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01)
  // Sustain then decay
  gainNode.gain.setValueAtTime(volume, startTime + duration * 0.3)
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

  // Connect nodes
  oscillator.connect(gainNode)
  gainNode.connect(ctx.destination)

  // Play
  oscillator.start(startTime)
  oscillator.stop(startTime + duration)
}

/**
 * Initialize the notification sound listener.
 * Call this once when the app starts.
 *
 * @returns Cleanup function to remove the listener
 */
export function initNotificationSoundListener(): () => void {
  if (!window.electronAPI?.onNotificationPlaySound) {
    console.warn('Notification sound API not available')
    return () => {}
  }

  return window.electronAPI.onNotificationPlaySound((volume) => {
    playNotificationSound(volume)
  })
}
