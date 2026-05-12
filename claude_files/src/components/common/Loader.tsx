import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../../constants/theme';

type Props = { fullScreen?: boolean };

export default function Loader({ fullScreen }: Props) {
  return (
    <View style={fullScreen ? styles.full : styles.inline}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  inline: { padding: 24, alignItems: 'center' },
});
