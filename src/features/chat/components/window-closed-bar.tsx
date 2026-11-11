import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { withAlpha } from '@/theme/color-utils';
import { useTheme } from '@/theme/use-theme';

interface WindowClosedBarProps {
  onSendFlow: () => void;
}

/** Shown above the composer once the 24h customer-service window has closed: explains that the
 * channel may reject free-form replies and offers a flow/template. The input stays usable — the
 * server returns the channel's own error if a reply is refused. */
export function WindowClosedBar({ onSendFlow }: WindowClosedBarProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();

  return (
    <View>
      <View
        style={[
          styles.banner,
          {
            backgroundColor: withAlpha(colors.warning, 0.14),
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.base,
            gap: spacing.base,
          },
        ]}
      >
        <Icon name="clock" size={18} color={colors.warning} />
        <Text variant="caption" style={styles.bannerText}>
          {t('chat.windowClosedBanner')}
        </Text>
        <Pressable accessibilityRole="button" onPress={onSendFlow} hitSlop={8}>
          <Text variant="caption" color="brand">
            {t('chat.sendFlow')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'flex-start' },
  bannerText: { flex: 1 },
});
