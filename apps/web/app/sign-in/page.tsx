import { Suspense } from "react";
import { authCopy } from "@trapit/auth";
import { AuthForm } from "../../components/auth-form";
import { AuthShell } from "../../components/auth-shell";

export default function SignInPage() {
  return (
    <AuthShell title={authCopy.signInTitle}>
      <Suspense fallback={null}>
        <AuthForm mode="sign-in" />
      </Suspense>
    </AuthShell>
  );
}