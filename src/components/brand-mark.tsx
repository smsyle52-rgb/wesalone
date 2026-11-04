import { Image } from 'expo-image';
import { View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { brand } from '@/config/brand';
import { useTheme } from '@/theme/use-theme';

/**
 * Brand logo shown on the boot and sign-in screens. Metro only bundles assets referenced by a
 * static `require`, so each brand that ships a logo is listed here; brands without one fall back
 * to the generic chat icon in a brand-tinted circle.
 */
const BRAND_LOGOS: Record<string, number> = {
  wesalone: require('../../brands/wesalone/assets/splash-icon.png'),
};

export function getBrandLogo(brandId: string): number | null {
  return BRAND_LOGOS[brandId] ?? null;
}

export function BrandMark({ size }: { size: number }) {
  const { colors } = useTheme();
  const logo = getBrandLogo(brand.brandId);

  if (logo) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        contentFit="contain"
        source={logo}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.brandSoft,
      }}
    >
      <Icon name="messages-square" size={32} color={colors.brand} />
    </View>
  );
}
