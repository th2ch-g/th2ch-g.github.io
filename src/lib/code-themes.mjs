import githubDarkDimmed from 'shiki/themes/github-dark-dimmed.mjs';
import githubLightDefault from 'shiki/themes/github-light-default.mjs';

/** @type {Record<'light' | 'dark', import('shiki').BundledTheme | import('shiki').ThemeRegistration>} */
export const codeThemes = {
  light: {
    ...githubLightDefault,
    // Keep comments above 4.5:1 contrast on the gray code background.
    tokenColors: githubLightDefault.tokenColors.map((rule) =>
      rule.settings.foreground === '#6e7781'
        ? { ...rule, settings: { ...rule.settings, foreground: '#59636e' } }
        : rule,
    ),
  },
  dark: {
    ...githubDarkDimmed,
    // Keep dimmed comments and punctuation above 4.5:1 contrast.
    tokenColors: githubDarkDimmed.tokenColors.map((rule) =>
      rule.settings.foreground === '#768390'
        ? { ...rule, settings: { ...rule.settings, foreground: '#9da7b3' } }
        : rule,
    ),
  },
};
