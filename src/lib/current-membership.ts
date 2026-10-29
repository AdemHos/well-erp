import { resolveProfile } from "@/lib/staff-profiles";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { AccessError, membershipContext, type ActiveMembership } from "@/lib/auth-context";

export async function getBaseMembership(options: { required?: boolean } = {}): Promise<ActiveMembership | null> {
  const session = await auth();
  if (!session?.user?.email) {
    if (options.required) throw new AccessError("Oturum açmanız gerekiyor.", 401);
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true, image: true, memberships: {
      where: { isActive: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { organization: { select: { id: true, name: true } }, branchAccess: { where: { isActive: true }, select: { branchId: true } } },
    } },
  });
  const selected = (await cookies()).get("wellpos-active-organization")?.value;
  const membership = selected ? user?.memberships.find((item) => item.organizationId === selected) : user?.memberships[0];
  if (!user || !membership) {
    if (options.required) throw new AccessError("Aktif işletme üyeliğiniz yok.", 403);
    return null;
  }
  return { ...membership, user: { id: user.id, email: user.email, name: user.name, image: user.image } };
}

export async function getCurrentMembership(options: { required?: boolean } = {}): Promise<ActiveMembership | null> {
  const cached = membershipContext.getStore(); if (cached) return cached;
  const base = await getBaseMembership(options); if (!base) return null;
  return resolveProfile(base);
}
