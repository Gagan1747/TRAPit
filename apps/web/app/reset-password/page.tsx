import { AuthShell } from "../../components/auth-shell";
import { PasswordResetForm } from "../../components/password-reset-form";

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Reset Password">
      <PasswordResetForm />
    </AuthShell>
  );
}