import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  {
    ignores: [".next/**", ".test-build/**", "output/**", "node_modules/**", "public/**"],
  },
];

export default config;
