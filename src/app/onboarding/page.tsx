import BrandLogo from "@/components/BrandLogo";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import OnboardingForm from "@/components/onboarding/OnboardingForm";

export default async function OnboardingPage() {
  const session = await auth();

  // Giriş yapılmamışsa login'e gönder
  if (!session?.user?.email) {
    redirect("/login");
  }

  // Kullanıcıyı ve üyeliklerini bul
  const user = await prisma.user.findUnique({
    where: {
      email: session.user.email,
    },
    include: {
      memberships: {
        take: 1,
      },
    },
  });

  // Kullanıcı DB'de bulunamazsa login'e gönder
  if (!user) {
    redirect("/login");
  }

  // Zaten bir işletmesi varsa onboarding'e tekrar girmesin
  if (user.memberships.length > 0) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div>
            <BrandLogo className="h-20 w-30" />

            <h1 className="mt-2 text-2xl font-bold text-slate-950">
              İşletmenizi oluşturalım
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              WellPOS&apos;u kullanmaya başlamak için işletme ve ana
              şube bilgilerinizi girin.
            </p>
          </div>

          <OnboardingForm />
        </div>
      </div>
    </main>
  );
}