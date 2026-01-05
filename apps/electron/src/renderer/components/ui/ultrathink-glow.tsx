import * as React from 'react'
import { PulsingBorder } from '@paper-design/shaders-react'
import { motion, AnimatePresence } from 'motion/react'

interface UltrathinkGlowProps {
  /** Whether the glow is active */
  enabled: boolean
  /** Container width for proper aspect ratio */
  width?: number
  /** Container height for proper corner radius calculation */
  height?: number
}

/**
 * UltrathinkGlow - Animated Pulsing Border shader effect for ultrathink mode
 *
 * Uses the Paper Design pulsing-border shader with vibrant colors
 * aligned with the input field border.
 * Uses absolute positioning to fill parent container.
 */
export function UltrathinkGlow({ enabled, width = 600, height = 120 }: UltrathinkGlowProps) {
  // Calculate roundness based on 8px corner radius relative to the shorter dimension
  // The shader's roundness is a 0-1 ratio where the value represents corner radius / (shorter dimension / 2)
  const cornerRadiusPx = 8
  const shorterDimension = Math.min(width, height)
  const roundness = (cornerRadiusPx / (shorterDimension / 2))
  return (
    <AnimatePresence>
      {enabled && (
        <motion.div
          className="absolute inset-0 overflow-hidden rounded-[8px] pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <PulsingBorder
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
            }}
            colors={["#0dc1fd", "#d915ef", "#ff3f2ecc"]}
            colorBack="#00000000"
            roundness={roundness}
            thickness={0.015}
            softness={0.5}
            intensity={0.15}
            bloom={0.15}
            spotSize={0.5}
            spots={4}
            pulse={0.2}
            smoke={0.2}
            smokeSize={0.0}
            speed={0.96}
            scale={1.0}
            rotation={0}
            offsetX={0}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
