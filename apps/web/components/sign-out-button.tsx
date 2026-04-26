"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleSignOut() {
    setIsPending(true);

    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
      });
      router.push("/sign-in");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button className="button-secondary" disabled={isPending} type="button" onClick={handleSignOut}>
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}