import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  const memberships = await prisma.membership.findMany({ where: { isActive: true, user: { email: session.user.email } }, select: { organizationId: true, role: true, organization: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ memberships });
}
