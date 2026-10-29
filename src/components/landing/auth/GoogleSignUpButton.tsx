"use client";

import { signIn } from "next-auth/react";

export default function GoogleSignInButton() {
  return (
    <button
      type="button"
      onClick={() =>
        signIn("google", {
          callbackUrl: "/dashboard",
        })
      }
      className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-500"
    >
      Google ile Devam Et
    </button>
  );
}