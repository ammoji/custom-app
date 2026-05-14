import { Platform } from 'react-native';

export const colors = {
  primary: '#0E7C3A',
  primaryDark: '#0A5E2C',
  primaryLight: '#E6F4EC',
  bg: '#FFFFFF',
  surface: '#F7F8FA',
  border: '#E5E7EB',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  success: '#16A34A',
  warning: '#F59E0B',
  danger: '#DC2626',
  info: '#2563EB',
  mrpStrike: '#9CA3AF',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radii = { sm: 6, md: 10, lg: 14, pill: 999 };

export const typography = {
  h1: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28, color: colors.textPrimary },
  h2: { fontSize: 18, fontWeight: '700' as const, lineHeight: 24, color: colors.textPrimary },
  h3: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22, color: colors.textPrimary },
  body: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20, color: colors.textPrimary },
  bodyBold: { fontSize: 14, fontWeight: '600' as const, lineHeight: 20, color: colors.textPrimary },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16, color: colors.textSecondary },
  price: { fontSize: 15, fontWeight: '700' as const, lineHeight: 20, color: colors.textPrimary },
};

export const shadow = {
  card: Platform.select({
    web: { boxShadow: '0px 2px 6px rgba(0,0,0,0.06)' } as object,
    default: {
      elevation: 2,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
  }),
};
