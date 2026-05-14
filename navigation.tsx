import React, {startTransition, useEffect, useMemo, useRef, useState} from 'react';
import {DarkTheme, NavigationContainer, type NavigationContainerRef} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import CameraScreen from './src/screens/CameraScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import type {MarkerCapture} from './src/types';

export type RootStackParamList = {
  Camera: undefined;
  Results: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const [captures, setCaptures] = useState<MarkerCapture[]>([]);
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    const routeName = navigationRef.current?.getCurrentRoute()?.name;
    if (captures.length >= 20 && routeName !== 'Results') {
      navigationRef.current?.navigate('Results');
    }
  }, [captures.length]);

  const handleCapture = (capture: MarkerCapture) => {
    startTransition(() => {
      setCaptures(previous => {
        if (previous.length >= 20) {
          return previous;
        }

        return [
          ...previous,
          {
            ...capture,
            label: `Frame #${previous.length + 1}`,
          },
        ];
      });
    });
  };

  const handleReset = () => {
    startTransition(() => {
      setCaptures([]);
      setSessionKey(current => current + 1);
    });

    navigationRef.current?.reset({
      index: 0,
      routes: [{name: 'Camera'}],
    });
  };

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
          animation: 'fade',
          headerShown: false,
        }}>
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
        <Stack.Screen name="Results">
          {() => <ResultsScreen captures={captures} onScanAgain={handleReset} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
