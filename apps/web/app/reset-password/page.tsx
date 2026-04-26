import { AuthShell } from "../../components/auth-shell";
import { PasswordResetForm } from "../../components/password-reset-form";

export default function ResetPasswordPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset a Cognito password by SMS."
      description="Use this when Cognito requires a password reset or when the user no longer knows the current password."
    >
      <PasswordResetForm />
    </AuthShell>
  );
}