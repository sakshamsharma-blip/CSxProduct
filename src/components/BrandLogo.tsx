interface BrandLogoProps {
  variant?: 'full' | 'mark';
  size?: 'sm' | 'md' | 'lg';
  productName?: string;
}

const LOGO_HEIGHTS: Record<NonNullable<BrandLogoProps['size']>, string> = {
  sm: 'h-5',
  md: 'h-7',
  lg: 'h-10',
};

const MARK_HEIGHTS: Record<NonNullable<BrandLogoProps['size']>, string> = {
  sm: 'h-5',
  md: 'h-6',
  lg: 'h-9',
};

const PRODUCT_SIZES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-lg',
};

export function BrandLogo({ variant = 'full', size = 'md', productName }: BrandLogoProps) {
  if (variant === 'mark') {
    return (
      <img
        src="/crelio-mark.png"
        alt="CrelioHealth"
        className={`${MARK_HEIGHTS[size]} w-auto`}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <img
        src="/crelio-logo.png"
        alt="CrelioHealth"
        className={`${LOGO_HEIGHTS[size]} w-auto`}
      />
      {productName && (
        <span className={`${PRODUCT_SIZES[size]} font-semibold text-gray-400`}>
          {productName}
        </span>
      )}
    </div>
  );
}
