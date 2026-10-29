import { credentialsInput } from "@/lib/auth-input";
import { consumeRateLimit, requestIdentity } from "@/lib/rate-limit";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),

  session: {
    strategy: "jwt",
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.deviceSessionId = randomUUID(); token.authenticatedAt = Date.now(); }
      return token;
    },
    async session({ session, token }) {
      return Object.assign(session, { deviceSessionId: token.deviceSessionId, authenticatedAt: token.authenticatedAt });
    },
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),

    Credentials({
      name: "credentials",

      credentials: {
        email: {
          label: "Email",
          type: "email",
        },
        password: {
          label: "Password",
          type: "password",
        },
      },

      async authorize(credentials, request) {
        let input;
        try {
          consumeRateLimit("login-ip", requestIdentity(request), 100, 60000);
          input = credentialsInput(credentials);
          consumeRateLimit("login-account", input.email, 10, 15 * 60000);
        } catch { return null; }
        const { email, password } = input;

        const user = await prisma.user.findUnique({
          where: {
            email,
          },
        });

        if (!user || !user.password) {
          return null;
        }

        const passwordMatch = await bcrypt.compare(
          password,
          user.password
        );

        if (!passwordMatch) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
});