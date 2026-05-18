/**
 * index.js
 *
 * Entry point for the React Native application.
 * Registers the root App component with the AppRegistry so
 * React Native can mount it on both Android and iOS.
 */

import 'react-native-gesture-handler'; // Must be the very first import
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

// Register the root component under the app name defined in app.json
AppRegistry.registerComponent(appName, () => App);
