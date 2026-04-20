import { devices } from '@playwright/test';

export const desktop = { viewport: { width: 1440, height: 900 } };
export const tablet  = devices['iPad Mini'];
export const mobile  = devices['iPhone 14'];

export type ViewportName = 'desktop' | 'tablet' | 'mobile';
