/**
 * App.tsx
 *
 * Root component of the Marker Scanner app.
 * Wraps the entire application in gesture and safe-area providers,
 * sets a dark status bar, and mounts the navigation tree.
 */

import React from 'react';
import {StatusBar, StyleSheet} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import NavigationRoot from './navigation';

export default function App() {
  return (
    // GestureHandlerRootView must wrap the entire tree to support swipe gestures
    <GestureHandlerRootView style={styles.root}>
      {/* SafeAreaProvider insets content away from device notches / home indicators */}
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#041214" />
        <NavigationRoot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#041214', // Deep dark teal — matches the overall dark theme
  },
});
