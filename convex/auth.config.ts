import { AuthConfig } from "convex/server";

const issuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;
if (!issuerDomain) {
  // Fail loudly at config time instead of silently breaking every
  // authenticated query/mutation with an undefined issuer.
  throw new Error(
    "CLERK_JWT_ISSUER_DOMAIN no está configurado en el deployment de Convex. " +
      "Cópialo del JWT template 'convex' en el dashboard de Clerk y ejecuta: " +
      "npx convex env set CLERK_JWT_ISSUER_DOMAIN <issuer-url>."
  );
}

export default {
  providers: [
    {
      domain: issuerDomain,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
