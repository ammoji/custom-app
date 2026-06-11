import { Feather } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
// PR-NEXT-BUNDLE-D §A — DO NOT REMOVE. The 4-tab delivery workspace.
// Home keeps the existing dashboard; Earnings / Profile / Settings are
// new purpose-built surfaces. Auto-formatter strip risk on these
// screen imports — this comment is the canary.
import DeliveryDashboardScreen from '../screens/delivery/DeliveryDashboardScreen';
import DeliveryEarningsScreen from '../screens/delivery/DeliveryEarningsScreen';
import DeliveryProfileScreen from '../screens/delivery/DeliveryProfileScreen';
import DeliverySettingsScreen from '../screens/delivery/DeliverySettingsScreen';

export type DeliveryTabParamList = {
  DeliveryHome: undefined;
  DeliveryEarnings: undefined;
  DeliveryProfile: undefined;
  DeliverySettings: undefined;
};

const Tab = createBottomTabNavigator<DeliveryTabParamList>();

/**
 * PR-NEXT-BUNDLE-D §A — delivery partner bottom-tab workspace.
 *
 * Splits the old single-scroll dashboard into 4 purpose-built tabs:
 *   - Home: live orders (existing DeliveryDashboardScreen)
 *   - Earnings: today / week sums + recent deliveries
 *   - Profile: editable photo / name / vehicle
 *   - Settings: low-rating alerts + account actions
 *
 * Rendered by the `DeliveryDashboard` route in AppNavigator, so
 * transient stack screens (DeliveryOrderDetail, PartnerReviews) still
 * push on top of the parent native-stack as before.
 */
export default function DeliveryTabNavigator() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 4,
          paddingTop: 4,
        },
      }}
    >
      <Tab.Screen
        name="DeliveryHome"
        component={DeliveryDashboardScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="DeliveryEarnings"
        component={DeliveryEarningsScreen}
        options={{
          tabBarLabel: 'Earnings',
          tabBarIcon: ({ color, size }) => (
            <Feather name="trending-up" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="DeliveryProfile"
        component={DeliveryProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Feather name="user" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="DeliverySettings"
        component={DeliverySettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Feather name="settings" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
