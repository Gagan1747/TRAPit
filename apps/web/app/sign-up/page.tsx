import { Suspense } from "react";
import { authCopy } from "@trapit/auth";
import { AuthForm } from "../../components/auth-form";
import { AuthShell } from "../../components/auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell title={authCopy.signUpTitle}>
      <Suspense fallback={null}>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthShell>
  );
}