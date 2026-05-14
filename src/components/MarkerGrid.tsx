import React from 'react';
import {FlatList, Image, StyleSheet, Text, View} from 'react-native';
import type {MarkerCapture} from '../types';

type MarkerGridProps = {
  captures: MarkerCapture[];
};

export default function MarkerGrid({captures}: MarkerGridProps) {
  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={captures}
      keyExtractor={item => item.id}
      numColumns={1}
      renderItem={({item}) => (
        <View style={styles.card}>
          <Image
            source={{uri: `data:image/png;base64,${item.base64}`}}
            style={styles.thumbnail}
          />
          <Text style={styles.label}>{item.label}</Text>
        </View>
      )}
      scrollEnabled={false}
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
    backgroundColor: '#ffffff',
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
