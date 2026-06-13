import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { CategoryId } from '../constants/categories';
import AddressEditScreen from '../screens/AddressEditScreen';
import CartScreen from '../screens/CartScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import HomeScreen from '../screens/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import OrderConfirmationScreen from '../screens/OrderConfirmationScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import OrdersScreen from '../screens/OrdersScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SearchScreen from '../screens/SearchScreen';
import ShopDetailScreen from '../screens/ShopDetailScreen';
import ShopListScreen from '../screens/ShopListScreen';
import AdminOrdersScreen from '../screens/admin/AdminOrdersScreen';
// PR 8 Part A — DO NOT REMOVE. Auto-formatter has stripped helper +
// screen imports across PRs 4–8; this comment + import survives the
// pattern. Used by the AuditLog Stack.Screen registration below.
// PR 38 — DO NOT REMOVE. Used by the AdminUsage Stack.Screen
// registration below. Same auto-formatter-strip risk as PR 8's
// AuditLogScreen import — the comment is the canary.
import AdminUsageScreen from '../screens/admin/AdminUsageScreen';
import AuditLogScreen from '../screens/admin/AuditLogScreen';
import DeliveryRequestDetailScreen from '../screens/admin/DeliveryRequestDetailScreen';
import PendingDeliveryRequestsScreen from '../screens/admin/PendingDeliveryRequestsScreen';
import PendingShopsScreen from '../screens/admin/PendingShopsScreen';
import ShopDetailManagementScreen from '../screens/admin/ShopDetailManagementScreen';
import ShopManagementScreen from '../screens/admin/ShopManagementScreen';
import ShopRegistrationDetailScreen from '../screens/admin/ShopRegistrationDetailScreen';
import UserDetailScreen from '../screens/admin/UserDetailScreen';
import UserManagementScreen from '../screens/admin/UserManagementScreen';
// PR-NEXT-BUNDLE-D §A — DO NOT REMOVE. The 4-tab delivery workspace
// replaces the bare dashboard at the `DeliveryDashboard` route. The
// dashboard itself is now mounted as the Home tab inside the
// navigator, so AppNavigator no longer imports it directly.
import DeliveryTabNavigator from './DeliveryTabNavigator';
// PR-NEXT-REVIEW-SYSTEM §F/§G — DO NOT REMOVE. Public reviews + correction.
import ShopReviewsScreen from '../screens/shop/ShopReviewsScreen';
import RatingAmendmentScreen from '../screens/customer/RatingAmendmentScreen';
// HOTFIX-RESPOND-OWNER-AND-CARD-NAV §E/§F — DO NOT REMOVE. Dedicated
// flagged_low attention queue reached from the dashboard card grid.
import AttentionQueueScreen from '../screens/AttentionQueueScreen';
// PR-NEXT-5.1 §D — DO NOT REMOVE. Partner public reviews screen.
import PartnerReviewsScreen from '../screens/delivery/PartnerReviewsScreen';
import DeliveryOrderDetailScreen from '../screens/delivery/DeliveryOrderDetailScreen';
import BecomeDeliveryPartnerScreen from '../screens/roles/BecomeDeliveryPartnerScreen';
// PR 1 — security hardening delivery waiting screen (mirrors WaitingForApproval).
import DeliveryApprovalWaitingScreen from '../screens/roles/DeliveryApprovalWaitingScreen';
import RegisterShopScreen from '../screens/roles/RegisterShopScreen';
import WaitingForApprovalScreen from '../screens/roles/WaitingForApprovalScreen';
import AddCustomMenuItemScreen from '../screens/shop/AddCustomMenuItemScreen';
// PR 32 — AI photo-to-catalog wizard. Reachable from ShopMenuScreen
// via the "📸 Scan rate-list (AI)" CTA. Shop-owner only; the
// callable enforces the shopOwner claim server-side.
import ScanMenuScreen from '../screens/shop/ScanMenuScreen';
// PR-NEXT-BUNDLE-L — DO NOT REMOVE. Paper-workflow scan screen
// (photograph filled catalog pages → OCR → CatalogReview).
import ScanCatalogPagesScreen from '../screens/shop/ScanCatalogPagesScreen';
import ShopMenuItemEditScreen from '../screens/shop/ShopMenuItemEditScreen';
import ShopMenuScreen from '../screens/shop/ShopMenuScreen';
import ShopOrderDetailScreen from '../screens/shop/ShopOrderDetailScreen';
import ShopCustomersScreen from '../screens/shop/ShopCustomersScreen';
import ShopOwnerDashboardScreen from '../screens/shop/ShopOwnerDashboardScreen';
import ShopSettingsScreen from '../screens/shop/ShopSettingsScreen';
// PR-NEXT-BUNDLE-K — DO NOT REMOVE. Catalog onboarding screens.
import BuildCatalogScreen from '../screens/shop/catalog/BuildCatalogScreen';
// PR-NEXT-BUNDLE-K.1 — DO NOT REMOVE. Replaces the deleted swipe-card
// browse with the Excel-style table view.
import CategoryListScreen from '../screens/shop/catalog/CategoryListScreen';
import CatalogReviewScreen from '../screens/shop/catalog/CatalogReviewScreen';
import ProposeCustomItemScreen from '../screens/shop/catalog/ProposeCustomItemScreen';
import PendingCatalogQueueScreen from '../screens/admin/PendingCatalogQueueScreen';

export type RootStackParamList = {
  Home: undefined;
  ShopList: undefined;
  ShopDetail: { shopId: string };
  Cart: undefined;
  Checkout: undefined;
  OrderConfirmation: { orderId: string };
  Orders: undefined;
  OrderDetail: { orderId: string };
  // PR 19 — customer's per-shop favorites list. Reachable from
  // the HomeScreen "❤ N favorites" tile.
  Favorites: undefined;
  Search: { query?: string; category?: CategoryId } | undefined;
  AdminOrders: undefined;
  // PR 8 Part A — DO NOT REMOVE (formatter stripped this once
  // already during PR 8). The AuditLog route renders AuditLogScreen.
  AuditLog: undefined;
  // PR 38 — admin feature-usage dashboard. Reached from the
  // HomeScreen admin tile group; reads featureUsageLog/ for
  // 7d/30d breakdowns by feature + role.
  AdminUsage: undefined;
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
  // PR 1 — security hardening. Delivery applicants land on
  // BecomeDeliveryPartner (form); on submit they replace to
  // DeliveryApprovalWaiting (status poll). Admins reach
  // PendingDeliveryRequests / DeliveryRequestDetail from the
  // HomeScreen admin tiles.
  BecomeDeliveryPartner: undefined;
  DeliveryApprovalWaiting: undefined;
  PendingDeliveryRequests: undefined;
  DeliveryRequestDetail: { uid: string };
  ShopOwnerDashboard: undefined;
  // PR 36 — shop owner Customer CRM (Top / Recent / Stopped tabs).
  ShopCustomers: undefined;
  // Phase 12a-v2-iv-followup: per-order detail for shop owners.
  ShopOrderDetail: { orderId: string };
  // Phase 12a-v2-ii: per-shop menu management.
  ShopMenu: undefined;
  ShopMenuItemEdit: { menuItemId: string };
  AddCustomMenuItem: undefined;
  // PR 32 — AI photo-to-catalog wizard.
  ScanMenu: undefined;
  // PR-NEXT-BUNDLE-L — paper-workflow: scan filled catalog pages.
  ScanCatalogPages: undefined;
  // PR 5: shop owner self-service for deliveryFee + minOrder.
  // PR 5 hotfix: optional shopId param lets admin target any shop.
  // Without param (shop owner path): server uses claim's shopId.
  // With param (admin path): server validates admin claim + uses param.
  ShopSettings: { shopId?: string } | undefined;
  DeliveryDashboard: undefined;
  DeliveryOrderDetail: { orderId: string };
  Login: { returnTo?: keyof RootStackParamList } | undefined;
  // Phase 12a-v2-iv: profile + saved address book.
  Profile: undefined;
  AddressEdit:
    | {
        addressId?: string;
        prefill?: {
          name?: string;
          phone?: string;
          line1?: string;
          line2?: string;
          city?: string;
          pincode?: string;
        };
      }
    | undefined;
  // PR-NEXT-REVIEW-SYSTEM §F/§G
  // PR-NEXT-BUNDLE-E §E — optional `mode='admin'` shows ALL reviews
  // (pre-published included) for admin moderation; default 'public'.
  ShopReviews: { shopId: string; shopName?: string; mode?: 'public' | 'admin' };
  // PR-NEXT-5.1 §D
  PartnerReviews: {
    partnerUid: string;
    partnerName?: string;
    // PR-NEXT-BUNDLE-G §B — 'own' mode: partner views all their own reviews.
    mode?: 'public' | 'admin' | 'own';
  };
  RatingAmendment: {
    ratingId: string;
    orderId: string;
    shopName?: string;
    originalShopStars?: number;
    responseText?: string | null;
    responseBy?: string | null;
    // PR-NEXT-BUNDLE-G §D — partner identity for amendment screen photo.
    deliveryPersonName?: string | null;
    deliveryPersonPhotoUrl?: string | null;
    // PR-NEXT-BUNDLE-J §L — DO NOT REMOVE. Which dimension the customer is
    // correcting, so amend/ack target the right side independently. Absent ⇒
    // 'shop' (legacy deep-links). originalDeliveryStars drives delivery amend.
    dimension?: 'shop' | 'delivery';
    originalDeliveryStars?: number;
  };
  // HOTFIX-RESPOND-OWNER-AND-CARD-NAV §F — DO NOT REMOVE. Dedicated
  // flagged_low attention queue; role selects which callable + OrderDetail.
  AttentionQueue: { role: 'delivery' | 'shop' };
  // PR-NEXT-BUNDLE-K — Catalog onboarding routes.
  BuildCatalog: undefined;
  CategoryList: { categoryId: string };
  CatalogReview: { drafts: import('../types').PriceDraft[] };
  ProposeCustomItem: undefined;
  PendingCatalogQueue: undefined;
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
      <Stack.Screen name="Favorites" component={FavoritesScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="AdminOrders" component={AdminOrdersScreen} />
      <Stack.Screen name="AuditLog" component={AuditLogScreen} />
      <Stack.Screen name="AdminUsage" component={AdminUsageScreen} />
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
        name="DeliveryApprovalWaiting"
        component={DeliveryApprovalWaitingScreen}
      />
      <Stack.Screen
        name="PendingDeliveryRequests"
        component={PendingDeliveryRequestsScreen}
      />
      <Stack.Screen
        name="DeliveryRequestDetail"
        component={DeliveryRequestDetailScreen}
      />
      <Stack.Screen
        name="ShopOwnerDashboard"
        component={ShopOwnerDashboardScreen}
      />
      <Stack.Screen
        name="ShopOrderDetail"
        component={ShopOrderDetailScreen}
      />
      <Stack.Screen name="ShopMenu" component={ShopMenuScreen} />
      <Stack.Screen name="ShopSettings" component={ShopSettingsScreen} />
      <Stack.Screen
        name="ShopMenuItemEdit"
        component={ShopMenuItemEditScreen}
      />
      <Stack.Screen
        name="AddCustomMenuItem"
        component={AddCustomMenuItemScreen}
      />
      <Stack.Screen name="ScanMenu" component={ScanMenuScreen} />
      <Stack.Screen
        name="ScanCatalogPages"
        component={ScanCatalogPagesScreen}
      />
      <Stack.Screen name="ShopCustomers" component={ShopCustomersScreen} />
      <Stack.Screen
        name="DeliveryDashboard"
        component={DeliveryTabNavigator}
      />
      <Stack.Screen
        name="DeliveryOrderDetail"
        component={DeliveryOrderDetailScreen}
      />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="AddressEdit" component={AddressEditScreen} />
      <Stack.Screen name="ShopReviews" component={ShopReviewsScreen} />
      <Stack.Screen name="RatingAmendment" component={RatingAmendmentScreen} />
      <Stack.Screen name="AttentionQueue" component={AttentionQueueScreen} />
      <Stack.Screen name="PartnerReviews" component={PartnerReviewsScreen} />
      {/* PR-NEXT-BUNDLE-K — DO NOT REMOVE. Catalog onboarding. */}
      <Stack.Screen name="BuildCatalog" component={BuildCatalogScreen} />
      <Stack.Screen name="CategoryList" component={CategoryListScreen} />
      <Stack.Screen name="CatalogReview" component={CatalogReviewScreen} />
      <Stack.Screen name="ProposeCustomItem" component={ProposeCustomItemScreen} />
      <Stack.Screen name="PendingCatalogQueue" component={PendingCatalogQueueScreen} />
    </Stack.Navigator>
  );
}
