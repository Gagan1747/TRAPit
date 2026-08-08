"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SignOutButtonProps = {
  className?: string;
  onSignedOut?: () => void;
};

export function SignOutButton({ className = "button-secondary", onSignedOut }: SignOutButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleSignOut() {
    setIsPending(true);

    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
      });
      onSignedOut?.();
      router.push("/sign-in");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button className={className} disabled={isPending} type="button" onClick={handleSignOut}>
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}