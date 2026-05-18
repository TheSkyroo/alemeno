/**
 * navigation.tsx
 *
 * Root navigation component for the Marker Scanner app.
 *
 * Responsibilities:
 *  - Owns the shared `captures` state (array of scanned markers).
 *  - Owns a `sessionKey` that increments on reset, forcing child
 *    components to re-mount with a fresh state.
 *  - Automatically navigates to the Results screen once 20 frames
 *    have been captured.
 *  - Exposes `handleCapture` and `handleReset` callbacks to screens
 *    via props (no Context needed at this scale).
 */

import React, {startTransition, useEffect, useMemo, useRef, useState} from 'react';
import {DarkTheme, NavigationContainer, type NavigationContainerRef} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import CameraScreen from './src/screens/CameraScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import type {MarkerCapture} from './src/types';

/** Route param-list for the root stack — neither screen requires params. */
export type RootStackParamList = {
  Camera: undefined;
  Results: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Extended dark theme that matches the app's deep-teal color palette. */
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#041214',
    card: '#041214',
    border: '#112426',
    primary: '#37e58d',
    text: '#f3faf8',
  },
};

export default function NavigationRoot() {
  // Ref used to imperatively navigate / reset without triggering re-renders
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  // Accumulated captured frames for the current session
  const [captures, setCaptures] = useState<MarkerCapture[]>([]);

  // Incrementing key; bumped on reset so screens fully re-mount
  const [sessionKey, setSessionKey] = useState(0);

  // ── Auto-navigate to Results when the target count is reached ──────────
  useEffect(() => {
    const routeName = navigationRef.current?.getCurrentRoute()?.name;

    if (captures.length >= 20 && routeName !== 'Results') {
      navigationRef.current?.navigate('Results');
    }
  }, [captures.length]);

  // ── Capture handler ─────────────────────────────────────────────────────
  /**
   * Appends a new capture to the list (up to 20).
   * Wrapped in startTransition so the heavy state update is
   * treated as non-urgent by the React scheduler.
   */
  const handleCapture = (capture: MarkerCapture) => {
    startTransition(() => {
      setCaptures(previous => {
        if (previous.length >= 20) {
          return previous; // Cap reached — discard additional captures
        }

        return [
          ...previous,
          {
            ...capture,
            label: `Frame #${previous.length + 1}`, // Human-readable label
          },
        ];
      });
    });
  };

  // ── Reset handler ───────────────────────────────────────────────────────
  /**
   * Clears all captures, bumps the session key, and navigates
   * back to the Camera screen.
   */
  const handleReset = () => {
    startTransition(() => {
      setCaptures([]);
      setSessionKey(current => current + 1);
    });

    // Hard-reset the navigation stack so the back button disappears
    navigationRef.current?.reset({
      index: 0,
      routes: [{name: 'Camera'}],
    });
  };

  // ── Memoised props passed down to both screens ──────────────────────────
  // Memoised to prevent re-creating the object on every render
  const screenProps = useMemo(
    () => ({
      captures,
      sessionKey,
      onCapture: handleCapture,
      onReset: handleReset,
    }),
    [captures, sessionKey],
  );

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="Camera"
        screenOptions={{
          animation: 'fade',   // Smooth cross-fade between screens
          headerShown: false,  // Custom headers are rendered inside each screen
        }}>

        {/* Camera screen — live marker detection */}
        <Stack.Screen name="Camera">
          {() => (
            <CameraScreen
              captures={screenProps.captures}
              sessionKey={screenProps.sessionKey}
              onCapture={screenProps.onCapture}
              onReset={screenProps.onReset}
            />
          )}
        </Stack.Screen>

        {/* Results screen — gallery of captured marker images */}
        <Stack.Screen name="Results">
          {() => <ResultsScreen captures={captures} onScanAgain={handleReset} />}
        </Stack.Screen>

      </Stack.Navigator>
    </NavigationContainer>
  );
}
