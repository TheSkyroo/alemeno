/**
 * ResultsScreen.tsx
 *
 * Displayed after the user has captured all 20 marker frames.
 * Shows a scrollable gallery (via MarkerGrid) of the normalised
 * 300×300 px PNG thumbnails, plus a "Scan Again" button that
 * resets the session and returns to the Camera screen.
 */

import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import MarkerGrid from '../components/MarkerGrid';
import type {MarkerCapture} from '../types';

type ResultsScreenProps = {
  /** All 20 captured marker snapshots, in capture order. */
  captures: MarkerCapture[];
  /** Callback invoked when the user taps "Scan Again". */
  onScanAgain: () => void;
};

export default function ResultsScreen({captures, onScanAgain}: ResultsScreenProps) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={styles.headerBlock}>
          <Text style={styles.title}>20 Captured Markers</Text>
          <Text style={styles.subtitle}>
            Each processed image is stored internally at 300×300 px after warp
            and rotation correction.
          </Text>
        </View>

        {/* ── Thumbnail gallery ────────────────────────────────────────── */}
        <MarkerGrid captures={captures} />

        {/* ── Reset action ─────────────────────────────────────────────── */}
        <Pressable onPress={onScanAgain} style={styles.primaryButton}>
          <Text style={styles.primaryButtonLabel}>Scan Again</Text>
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#041214',
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
  },
  headerBlock: {
    marginBottom: 20,
  },
  title: {
    color: '#f3faf8',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 10,
  },
  subtitle: {
    color: '#b6c9c6',
    fontSize: 15,
    lineHeight: 22,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#37e58d', // Accent green
    borderRadius: 18,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  primaryButtonLabel: {
    color: '#042218', // Dark text for contrast on the green button
    fontSize: 16,
    fontWeight: '800',
  },
});
