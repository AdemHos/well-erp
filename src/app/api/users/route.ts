import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: {
        email: session.user.email,
      },
      select: { id: true, name: true, email: true, image: true },
    });
    if (!user) return NextResponse.json({ error: "Kullanıcı bulunamadı." }, { status: 404 });

    return NextResponse.json({
      success: true,
      user,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Kullanıcı bilgileri alınamadı.",
      },
      { status: 500 }
    );
  }
}
