import NextAuth, { type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";

declare module "next-auth" {
  interface Session {
    user: { login?: string } & DefaultSession["user"];
  }
}

/**
 * Dashboard login. Sessions are signed JWT cookies, so there are no user or
 * session tables. The only thing we need to remember about a user is their
 * GitHub login, which is what GitHub's permission API is keyed on.
 *
 * Reads AUTH_SECRET, AUTH_GITHUB_ID and AUTH_GITHUB_SECRET from the env.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, profile }) {
      // `profile` is only present on sign-in. It is GitHub's own response,
      // so the login cannot be chosen by the user.
      if (profile && typeof profile.login === "string") {
        token.login = profile.login;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.login === "string") {
        session.user.login = token.login;
      }
      return session;
    },
  },
});

/** GitHub login of the signed-in user, or null when signed out. */
export async function getSignedInLogin(): Promise<string | null> {
  const session = await auth();
  return session?.user?.login ?? null;
}
