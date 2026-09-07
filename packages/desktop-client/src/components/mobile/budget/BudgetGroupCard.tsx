import type { ReactNode } from 'react';

import type { CSSProperties } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

type BudgetGroupCardProps = {
  style?: CSSProperties;
  children: ReactNode;
};

/**
 * The card a budget group sits in.
 *
 * Deliberately not `Card` from the component library: that wraps its children
 * in a second view with `overflow: hidden` to round the corners, which makes
 * it the scrollport for the frozen category-name column and stops `sticky`
 * from ever engaging. The rows carry their own borders, so nothing needs
 * clipping here.
 */
export function BudgetGroupCard({ style, children }: BudgetGroupCardProps) {
  return (
    <View
      style={{
        marginTop: 15,
        marginLeft: 5,
        marginRight: 5,
        borderRadius: 6,
        backgroundColor: theme.cardBackground,
        borderColor: theme.cardBorder,
        boxShadow: '0 1px 2px #9594A8',
        ...style,
      }}
    >
      {children}
    </View>
  );
}
