/**
 * CaptureProgress.tsx
 *
 * A compact HUD widget that shows how many marker frames have been captured
 * out of the session target (e.g. "3 / 20 frames captured").
 *
 * Each time `count` increases, the green pulse ring briefly scales up and
 * fades back to give tactile feedback that a capture occurred.
 */

import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type CaptureProgressProps = {
  /** Number of frames captured so far in this session. */
  count: number;
  /** Total frames required to complete the session. */
  target: number;
};

export default function CaptureProgress({count, target}: CaptureProgressProps) {
  // Shared value drives the pulse ring animation (0 = rest, 1 = peak)
  const pulse = useSharedValue(0);

  // Trigger a quick pulse animation whenever a new frame is captured
  useEffect(() => {
    if (count === 0) {
      return; // Skip animation on initial render / after reset
    }

    // Reset to 0, then animate up and back down
    pulse.value = 0;
    pulse.value = withSequence(
      withTiming(1, {duration: 180}),
      withTiming(0, {duration: 420}),
    );
  }, [count, pulse]);

  // Map the pulse shared value to opacity + scale transforms
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + (1 - pulse.value) * 0.28,
    transform: [{scale: 1 + pulse.value * 0.6}],
  }));

  return (
    <View style={styles.wrapper}>
      {/* Left side: text labels */}
      <View style={styles.copyBlock}>
        <Text style={styles.eyebrow}>Capture progress</Text>
        <Text style={styles.mainLabel}>{`${count} / ${target} frames captured`}</Text>
      </View>

      {/* Right side: animated pulse indicator */}
      <View style={styles.pulseWrap}>
        {/* Outer ring that scales/fades on each capture */}
        <Animated.View style={[styles.pulseRing, pulseStyle]} />

        {/* Static inner badge with "OK" label */}
        <View style={styles.pulseCore}>
          <Text style={styles.check}>OK</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  copyBlock: {
    gap: 4,
  },
  eyebrow: {
    color: 'rgba(227, 241, 238, 0.62)',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  mainLabel: {
    color: '#f3faf8',
    fontSize: 16,
    fontWeight: '700',
  },
  pulseWrap: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  pulseRing: {
    borderColor: '#37e58d',
    borderRadius: 20,
    borderWidth: 2,
    height: 40,
    position: 'absolute',
    width: 40,
  },
  pulseCore: {
    alignItems: 'center',
    backgroundColor: '#0e2a25',
    borderColor: 'rgba(55, 229, 141, 0.36)',
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  check: {
    color: '#37e58d',
    fontSize: 12,
    fontWeight: '800',
  },
});
