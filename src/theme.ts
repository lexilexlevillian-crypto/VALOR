import {z} from 'zod';

export const themeIds=[
 'neon-green-terminal','neon-pink-scene','neon-purple-night','neon-blue-electric',
 'neon-red-heat','neon-amber','neon-cyan','neon-white-chrome',
 'soft-baby-pink','soft-baby-blue','soft-butter-yellow'
] as const;
export const themeIdSchema=z.enum(themeIds);
export type ThemeId=typeof themeIds[number];
export const defaultThemeId:ThemeId='neon-green-terminal';
