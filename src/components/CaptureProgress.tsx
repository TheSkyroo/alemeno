import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type CaptureProgressProps = {
  count: number;
  target: number;
};

export default function CaptureProgress({count, target}: CaptureProgressProps) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (count === 0) {
      return;
    }

    pulse.value = 0;
    pulse.value = withSequence(withTiming(1, {duration: 180}), withTiming(0, {duration: 420}));
  }, [count, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + (1 - pulse.value) * 0.28,
    transform: [{scale: 1 + pulse.value * 0.6}],
  }));

  return (
    <View style={styles.wrapper}>
      <View style={styles.copyBlock}>
        <Text style={styles.eyebrow}>Capture progress</Text>
        <Text style={styles.mainLabel}>{`${count} / ${target} frames captured`}</Text>
      </View>

      <View style={styles.pulseWrap}>
        <Animated.View style={[styles.pulseRing, pulseStyle]} />
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
