import nextVitals from 'eslint-config-next/core-web-vitals';

/** ESLint 9 flat config: Next.js rules, as before. */
const config = [
  ...nextVitals,
  {
    rules: {
      // New with the React 19 rule set. It flags loading a form's fields from fetched data,
      // which this app does in many places and which works. Kept visible as a warning.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  { ignores: ['.next/**', '.next-dev/**', '.next-check/**', 'out/**', 'node_modules/**', 'next-env.d.ts'] },
];

export default config;
