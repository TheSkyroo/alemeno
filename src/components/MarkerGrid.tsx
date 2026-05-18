/**
 * MarkerGrid.tsx
 *
 * Displays a vertical list of captured marker thumbnails.
 * Each card shows the normalised 300×300 px PNG of the marker
 * alongside its human-readable frame label (e.g. "Frame #3").
 *
 * Scroll is intentionally disabled — the parent ScrollView in
 * ResultsScreen handles scrolling for the whole page.
 */

import React from 'react';
import {FlatList, Image, StyleSheet, Text, View} from 'react-native';
import type {MarkerCapture} from '../types';

type MarkerGridProps = {
  /** The list of captures to display, in capture order. */
  captures: MarkerCapture[];
};

export default function MarkerGrid({captures}: MarkerGridProps) {
  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={captures}
      keyExtractor={item => item.id}
      numColumns={1} // Single-column vertical list
      renderItem={({item}) => (
        <View style={styles.card}>
          {/* Render the binary patch as a PNG data-URI */}
          <Image
            source={{uri: `data:image/png;base64,${item.base64}`}}
            style={styles.thumbnail}
          />
          <Text style={styles.label}>{item.label}</Text>
        </View>
      )}
      scrollEnabled={false} // Parent ScrollView owns scrolling
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    gap: 14,
    paddingBottom: 24,
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#0b1f21',
    borderColor: '#173034',
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 10,
    width: 320,
  },
  thumbnail: {
    alignSelf: 'center',
    backgroundColor: '#ffffff', // White fallback while image loads
    borderRadius: 16,
    width: 300,
    height: 300,
  },
  label: {
    color: '#dcecea',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
  },
});
