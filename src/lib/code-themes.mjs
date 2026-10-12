import githubDarkDimmed from 'shiki/themes/github-dark-dimmed.mjs';

/** @type {Record<'light' | 'dark', import('shiki').BundledTheme | import('shiki').ThemeRegistration>} */
export const codeThemes = {
  light: 'github-light-default',
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
