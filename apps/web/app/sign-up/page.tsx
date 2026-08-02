import { Suspense } from "react";
import { authCopy } from "@trapit/auth";
import { AuthForm } from "../../components/auth-form";
import { AuthShell } from "../../components/auth-shell";
import { HeroFeatureAssets } from "../../components/hero-feature-assets";

export default function SignUpPage() {
  return (
    <AuthShell
      title={authCopy.signUpTitle}
      description="Tests, Apportions and Polls Simplified, Smart, and Precise"
      heroVisual={<HeroFeatureAssets />}
      showHeroLinks={false}
    >
      <Suspense fallback={null}>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthShell>
  );
}