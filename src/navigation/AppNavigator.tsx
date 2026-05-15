import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { CategoryId } from '../constants/categories';
import CartScreen from '../screens/CartScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import HomeScreen from '../screens/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import OrderConfirmationScreen from '../screens/OrderConfirmationScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import OrdersScreen from '../screens/OrdersScreen';
import SearchScreen from '../screens/SearchScreen';
import ShopDetailScreen from '../screens/ShopDetailScreen';
import ShopListScreen from '../screens/ShopListScreen';
import AdminOrdersScreen from '../screens/admin/AdminOrdersScreen';
import PendingShopsScreen from '../screens/admin/PendingShopsScreen';
import ShopDetailManagementScreen from '../screens/admin/ShopDetailManagementScreen';
import ShopManagementScreen from '../screens/admin/ShopManagementScreen';
import ShopRegistrationDetailScreen from '../screens/admin/ShopRegistrationDetailScreen';
import UserDetailScreen from '../screens/admin/UserDetailScreen';
import UserManagementScreen from '../screens/admin/UserManagementScreen';
import DeliveryDashboardScreen from '../screens/delivery/DeliveryDashboardScreen';
import DeliveryOrderDetailScreen from '../screens/delivery/DeliveryOrderDetailScreen';
import BecomeDeliveryPartnerScreen from '../screens/roles/BecomeDeliveryPartnerScreen';
import RegisterShopScreen from '../screens/roles/RegisterShopScreen';
import WaitingForApprovalScreen from '../screens/roles/WaitingForApprovalScreen';
import AddCustomMenuItemScreen from '../screens/shop/AddCustomMenuItemScreen';
import ShopMenuItemEditScreen from '../screens/shop/ShopMenuItemEditScreen';
import ShopMenuScreen from '../screens/shop/ShopMenuScreen';
import ShopOwnerDashboardScreen from '../screens/shop/ShopOwnerDashboardScreen';

export type RootStackParamList = {
  Home: undefined;
  ShopList: undefined;
  ShopDetail: { shopId: string };
  Cart: undefined;
  Checkout: undefined;
  OrderConfirmation: { orderId: string };
  Orders: undefined;
  OrderDetail: { orderId: string };
  Search: { query?: string; category?: CategoryId } | undefined;
  AdminOrders: undefined;
  // Phase 12a-v2-i: BecomeShopOwner is now an alias for the registration
  // form. The route name is preserved so existing HomeScreen nav targets
  // and any deep-link references keep resolving without churn; the screen
  // it renders is RegisterShopScreen. The optional `prefill` param lets
  // WaitingForApproval re-open the form pre-populated for resubmission.
  BecomeShopOwner: { prefill?: ShopRegistrationPrefill } | undefined;
  RegisterShop: { prefill?: ShopRegistrationPrefill } | undefined;
  WaitingForApproval: { shopId: string };
  PendingShops: undefined;
  ShopRegistrationDetail: { shopId: string };
  // Phase 12a-v2-i-bis: admin governance.
  UserManagement: undefined;
  UserDetail: { uid: string };
  ShopManagement: undefined;
  ShopDetailManagement: { shopId: string };
  BecomeDeliveryPartner: undefined;
  ShopOwnerDashboard: undefined;
  // Phase 12a-v2-ii: per-shop menu management.
  ShopMenu: undefined;
  ShopMenuItemEdit: { menuItemId: string };
  AddCustomMenuItem: undefined;
  DeliveryDashboard: undefined;
  DeliveryOrderDetail: { orderId: string };
  Login: { returnTo?: keyof RootStackParamList } | undefined;
};

export type ShopRegistrationPrefill = {
  name?: string;
  address?: string;
  phone?: string;
  hours?: { open: string; close: string };
  gstNumber?: string;
  fssaiLicense?: string;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="ShopList" component={ShopListScreen} />
      <Stack.Screen name="ShopDetail" component={ShopDetailScreen} />
      <Stack.Screen name="Cart" component={CartScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />
      <Stack.Screen name="Orders" component={OrdersScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="AdminOrders" component={AdminOrdersScreen} />
      {/*
        BecomeShopOwner now points at the registration form. We keep the
        old route name as an alias for backward compat with HomeScreen.
      */}
      <Stack.Screen name="BecomeShopOwner" component={RegisterShopScreen} />
      <Stack.Screen name="RegisterShop" component={RegisterShopScreen} />
      <Stack.Screen
        name="WaitingForApproval"
        component={WaitingForApprovalScreen}
      />
      <Stack.Screen name="PendingShops" component={PendingShopsScreen} />
      <Stack.Screen
        name="ShopRegistrationDetail"
        component={ShopRegistrationDetailScreen}
      />
      <Stack.Screen
        name="UserManagement"
        component={UserManagementScreen}
      />
      <Stack.Screen name="UserDetail" component={UserDetailScreen} />
      <Stack.Screen
        name="ShopManagement"
        component={ShopManagementScreen}
      />
      <Stack.Screen
        name="ShopDetailManagement"
        component={ShopDetailManagementScreen}
      />
      <Stack.Screen
        name="BecomeDeliveryPartner"
        component={BecomeDeliveryPartnerScreen}
      />
      <Stack.Screen
        name="ShopOwnerDashboard"
        component={ShopOwnerDashboardScreen}
      />
      <Stack.Screen name="ShopMenu" component={ShopMenuScreen} />
      <Stack.Screen
        name="ShopMenuItemEdit"
        component={ShopMenuItemEditScreen}
      />
      <Stack.Screen
        name="AddCustomMenuItem"
        component={AddCustomMenuItemScreen}
      />
      <Stack.Screen
        name="DeliveryDashboard"
        component={DeliveryDashboardScreen}
      />
      <Stack.Screen
        name="DeliveryOrderDetail"
        component={DeliveryOrderDetailScreen}
      />
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}
