export const DESIGN_VARIANTS = ['classic', 'daisy', 'shadcn'] as const;

export type DesignVariant = (typeof DESIGN_VARIANTS)[number];

// Change this value to select the site-wide design at build time.
export const ACTIVE_DESIGN: DesignVariant = 'shadcn';
