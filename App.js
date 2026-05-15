import { initSentry } from "./src/services/sentry";
initSentry();

import '@react-native-firebase/functions';

import { NavigationContainer } from "@react-navigation/native";
import { registerRootComponent } from "expo";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AuthBootstrap from "./src/components/AuthBootstrap";
import ErrorBoundary from "./src/components/ErrorBoundary";
import AppNavigator from "./src/navigation/AppNavigator";
import "./src/services/firebase";

function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthBootstrap />
        <NavigationContainer>
          <StatusBar style="dark" />
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

registerRootComponent(App);
