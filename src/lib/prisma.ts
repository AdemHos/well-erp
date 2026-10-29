import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaConstructor: typeof PrismaClient | undefined;
};

// Next.js retains globalThis across hot reloads. A client constructed before
// `prisma generate` cannot query newly added fields, even after this module reloads.
export const prisma =
  (globalForPrisma.prismaConstructor === PrismaClient
    ? globalForPrisma.prisma
    : undefined) ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaConstructor = PrismaClient;
}
