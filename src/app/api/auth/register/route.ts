import { credentialsInput } from "@/lib/auth-input";
import { consumeRateLimit, requestIdentity } from "@/lib/rate-limit";
import { assertSameOrigin, boundedJson } from "@/lib/http-security";
import { AccessError } from "@/lib/auth-context";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    consumeRateLimit("register", requestIdentity(request), 20, 3600000);
    const { name, email, password } = credentialsInput(await boundedJson(request, 4096), true);

    const existingUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Bu e-posta adresi zaten kullanılıyor." },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        message: "Hesap başarıyla oluşturuldu.",
        user,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers: error.status === 429 ? { "Retry-After": "900" } : {} });
    console.error("REGISTER_ERROR:", error instanceof Error ? error.name : "UnknownError");

    return NextResponse.json(
      { error: "Hesap oluşturulurken bir hata oluştu." },
      { status: 500 }
    );
  }
}