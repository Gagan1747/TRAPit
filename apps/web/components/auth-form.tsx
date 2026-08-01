"use client";

import {
  combinePhoneNumber,
  DEFAULT_PHONE_COUNTRY_CODE,
  formatPhoneCountryLabel,
  getPhoneCountryByCode,
  PHONE_COUNTRIES,
  sanitizeNationalPhoneInput,
} from "@trapit/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  getPublicWebAuthSetupMessage,
  isPublicWebAuthConfigured,
} from "../lib/public-auth-config";
import { markNotificationPromptOpportunity } from "./browser-push-prompt";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

type SignUpSubMode = "confirm" | "create";

const EXISTING_ACCOUNT_ERROR = "An account with this phone number already exists.";
const TERMS_OF_SERVICE = [
  "Effective Date: 2026-08-01",
  "Welcome to TRAPit.in. By creating an account, accessing, or using TRAPit.in, you agree to be bound by these Terms & Conditions (Terms). If you do not agree, you should not use the platform.",
  "1. Acceptance of Terms: By signing up for or using TRAPit.in, you agree to these Terms, the Privacy Policy, and any other policies or guidelines published by TRAPit.in from time to time.",
  "2. Privacy and Data Use: You acknowledge that TRAPit.in may collect, use, store, and process your personal information in accordance with its Privacy Policy and as necessary to provide, maintain, secure, and improve the platform. By using the site, you consent to our use of cookies to enhance your experience and analyse traffic.",
  "3. Accuracy of Information: You agree that all information provided during registration or while using TRAPit.in is true, accurate, current, and complete. You are responsible for updating your information when necessary.",
  "4. Eligibility to Use: Users confirm that they are legally eligible to use TRAPit.in. Users under 18 years of age may use the platform only with the consent and supervision of a parent, legal guardian, teacher, school, or other authorized adult.",
  "5. Account Security: You are responsible for keeping your credentials confidential and for all activity under your account. Promptly notify us of any unauthorized access.",
  "6. Permitted and Lawful Use: You agree to use TRAPit.in only for lawful purposes and in accordance with these Terms. You must not use the platform for fraud, abuse, cheating, harmful conduct, unauthorized access, or any activity that may disrupt the platform or affect other users.",
  "7. Service Communications: By creating an account, you agree to receive essential service-related communications from TRAPit.in, including account verification, password reset messages, security notices, technical updates, and other important administrative communications.",
  "8. Content and Conduct Rules: You agree not to upload, post, share, submit, or transmit any content that is unlawful, defamatory, obscene, abusive, harmful, misleading, violates rights, contains harmful code, or interferes with the operation, security, or integrity of TRAPit.in.",
  "9. Suspension or Termination: TRAPit.in reserves the right to suspend, restrict, or terminate your account or access to the platform, with or without notice where appropriate, if it believes that you have violated these Terms, misused the platform, created security or legal risk, or engaged in conduct that is harmful to TRAPit.in or others.",
  "10. Changes to Terms: TRAPit.in may revise or update these Terms from time to time. Updated Terms will become effective upon posting or on the date otherwise specified. Your continued use of the platform after such changes become effective constitutes your acceptance of the revised Terms.",
  "11. User Responsibility for Uploaded Content and Copyright: You are solely responsible for any content, material, documents, images, text, questions, answers, media, or other information uploaded, posted, shared, or submitted by you on TRAPit.in. You represent and warrant that you own such content or have all necessary rights, permissions, licenses, and authorizations to use and upload it. TRAPit.in does not claim ownership of user-uploaded content and shall not be held responsible for copyright infringement, trademark violation, intellectual property dispute, or other legal claim arising from content uploaded by users. You agree to indemnify and hold harmless TRAPit.in, its owners, operators, employees, and affiliates from claims, losses, damages, liabilities, costs, or expenses related to your uploaded content or violation of third-party rights.",
  "12. Compliance with Indian Law: You agree to use TRAPit.in in compliance with all applicable laws in India, including laws relating to information technology, intellectual property, privacy, cyber offences, and electronic communications.",
  "13. Educational / Test Platform Disclaimer: If TRAPit.in is used for online tests, apportions, or polls, the platform acts only as a technology facilitator unless expressly stated otherwise. TRAPit.in does not guarantee academic outcomes, scores, rankings, admissions, certifications, or institutional decisions based on platform usage.",
  "14. Availability of Service: TRAPit.in does not guarantee uninterrupted, timely, secure, or error-free operation of the platform and may temporarily suspend access for maintenance, upgrades, technical issues, or circumstances beyond its control.",
  "15. Limitation of Liability: To the maximum extent permitted under applicable law, TRAPit.in shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of data, revenue, profits, goodwill, or opportunity arising out of or in connection with the use of or inability to use the platform.",
];

async function readAuthResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  const payload = await response.text();
  const htmlTitleMatch = payload.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const htmlText = htmlTitleMatch?.[1]?.trim();
  const textPayload = payload.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  throw new Error(htmlText || textPayload || fallbackMessage);
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = (() => {
    const redirectValue = searchParams.get("redirect")?.trim() ?? "";

    return redirectValue.startsWith("/") ? redirectValue : "";
  })();
  const redirectQuery = redirectPath ? `?redirect=${encodeURIComponent(redirectPath)}` : "";
  const initialSignUpSubMode = searchParams.get("step") === "confirm" ? "confirm" : "create";
  const initialConfirmAvailable = searchParams.get("step") === "confirm";
  const initialSignUpHint = searchParams.get("signup") === "retry"
    ? "If your earlier SMS code expired or got lost, enter your phone number below, resend the OTP, and confirm the account."
    : null;
  const [confirmationCode, setConfirmationCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [selectedCountryCode, setSelectedCountryCode] = useState(DEFAULT_PHONE_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [signUpSubMode, setSignUpSubMode] = useState<SignUpSubMode>(initialSignUpSubMode);
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [isTermsAgreementVisible, setIsTermsAgreementVisible] = useState(mode === "sign-up");
  const [isConfirmOptionAvailable, setIsConfirmOptionAvailable] = useState(initialConfirmAvailable);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [signUpHint, setSignUpHint] = useState<string | null>(initialSignUpHint);
  const [signUpState, setSignUpState] = useState<{
    destination: string | null;
    requiresConfirmation: boolean;
    warning?: string;
  } | null>(null);
  const authConfigured = isPublicWebAuthConfigured();
  const infoMessage =
    mode !== "sign-in"
      ? null
      : searchParams.get("error") === "session"
        ? "Your session is missing or expired. Sign in to open the requested page."
        : searchParams.get("reset")
        ? "Password updated. Sign in with the new password."
        : searchParams.get("confirmed")
          ? "Account confirmed. You can sign in now."
          : searchParams.get("created")
            ? "Account created. Sign in after confirmation completes."
            : null;

  const selectedCountry = getPhoneCountryByCode(selectedCountryCode);
  const combinedPhoneNumber = combinePhoneNumber(selectedCountry.dialCode, phoneNumber);

  function handlePhoneNumberChange(nextPhoneNumber: string) {
    const sanitizedPhoneNumber = sanitizeNationalPhoneInput(nextPhoneNumber);

    if (sanitizedPhoneNumber === phoneNumber) {
      return;
    }

    setPhoneNumber(sanitizedPhoneNumber);
    setPassword("");
    setConfirmPassword("");
    setIsPasswordVisible(false);
    setConfirmationCode("");
    setSignUpState(null);
    setErrorMessage(null);
    setResendMessage(null);
  }

  function handleCountryChange(nextCountryCode: string) {
    if (nextCountryCode === selectedCountryCode) {
      return;
    }

    setSelectedCountryCode(nextCountryCode);
    setPassword("");
    setConfirmPassword("");
    setIsPasswordVisible(false);
    setConfirmationCode("");
    setSignUpState(null);
    setErrorMessage(null);
    setResendMessage(null);
  }

  function openConfirmAccount(options?: {
    destination?: string | null;
    hint?: string | null;
    warning?: string;
  }) {
    setIsConfirmOptionAvailable(true);
    setSignUpSubMode("confirm");
    setSignUpHint(options?.hint ?? null);
    setResendMessage(null);

    if (options?.destination || options?.warning) {
      setSignUpState({
        destination: options.destination ?? null,
        requiresConfirmation: true,
        warning: options.warning,
      });
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setResendMessage(null);

    if (!authConfigured) {
      setErrorMessage(getPublicWebAuthSetupMessage());
      return;
    }

    if (mode === "sign-up" && signUpSubMode === "confirm") {
      await handleConfirmSignUp();
      return;
    }

    if (mode === "sign-up" && !fullName.trim()) {
      setErrorMessage("Full name, phone number, and password are required.");
      return;
    }

    if (!phoneNumber || !password) {
      setErrorMessage(
        mode === "sign-up"
          ? "Full name, phone number, and password are required."
          : "Phone number and password are required.",
      );
      return;
    }

    if (mode === "sign-up" && signUpSubMode === "create" && !confirmPassword) {
      setErrorMessage("Confirm password is required.");
      return;
    }

    if (mode === "sign-up" && signUpSubMode === "create" && password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (mode === "sign-up" && signUpSubMode === "create" && !hasAcceptedTerms) {
      setIsTermsAgreementVisible(true);
      setErrorMessage("Accept the TRAPit.in Terms of Service to create an account.");
      return;
    }

    setIsPending(true);

    try {
      if (mode === "sign-up") {
        const response = await fetch("/api/auth/sign-up", {
          body: JSON.stringify({ acceptedTerms: hasAcceptedTerms, fullName, phoneNumber: combinedPhoneNumber, password }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const payload = await readAuthResponse<{
          deliveryDestination?: string | null;
          error?: string;
          requiresConfirmation?: boolean;
          warning?: string;
        }>(response, "Sign-up failed.");

        if (!response.ok) {
          const nextError = payload.error ?? "Sign-up failed.";

          if (nextError === EXISTING_ACCOUNT_ERROR) {
            openConfirmAccount({
              hint: "This phone number already has a pending account. Confirm it with the OTP, or resend the OTP if you no longer have it.",
            });
          }

          throw new Error(nextError);
        }

        setSignUpState({
          destination: payload.deliveryDestination ?? null,
          requiresConfirmation: payload.requiresConfirmation ?? true,
          warning: payload.warning,
        });
        setIsConfirmOptionAvailable(true);
        setSignUpSubMode("confirm");
        setSignUpHint("Use the OTP sent for this account creation to confirm your number before signing in.");

        if (!(payload.requiresConfirmation ?? true)) {
          markNotificationPromptOpportunity();
          router.push(`/sign-in?created=1${redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : ""}`);
        }

        return;
      }

      const response = await fetch("/api/auth/sign-in", {
        body: JSON.stringify({ acceptedTerms: hasAcceptedTerms, phoneNumber: combinedPhoneNumber, password }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await readAuthResponse<{
        error?: string;
        redirectTo?: string;
        requiresTermsConsent?: boolean;
      }>(response, "Sign-in failed.");

      if (!response.ok && payload.requiresTermsConsent) {
        setIsTermsAgreementVisible(true);
        setErrorMessage(payload.error ?? "Review and accept the TRAPit.in Terms of Service to continue.");
        return;
      }

      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error ?? "Sign-in failed.");
      }

      router.push(redirectPath || payload.redirectTo);
  markNotificationPromptOpportunity();
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Authentication failed.",
      );
    } finally {
      setIsPending(false);
    }
  }

  async function handleResendConfirmationCode() {
    setErrorMessage(null);
    setResendMessage(null);

    if (!authConfigured) {
      setErrorMessage(getPublicWebAuthSetupMessage());
      return;
    }

    if (!phoneNumber) {
      setErrorMessage("Phone number is required to resend the confirmation code.");
      return;
    }

    setIsPending(true);

    try {
      const response = await fetch("/api/auth/resend-confirmation-code", {
        body: JSON.stringify({ phoneNumber: combinedPhoneNumber }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await readAuthResponse<{
        deliveryDestination?: string | null;
        error?: string;
      }>(response, "Unable to resend the confirmation code.");

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to resend the confirmation code.");
      }

      setSignUpState((currentState) => ({
        destination: payload.deliveryDestination ?? currentState?.destination ?? null,
        requiresConfirmation: true,
        warning: currentState?.warning,
      }));
      setResendMessage(`A new OTP was sent${payload.deliveryDestination ? ` to ${payload.deliveryDestination}` : ""}.`);
      setIsConfirmOptionAvailable(true);
      setSignUpSubMode("confirm");
      setSignUpHint("Use the latest OTP you receive by SMS. Older OTPs may no longer work.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to resend the confirmation code.",
      );
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirmSignUp() {
    setErrorMessage(null);

    if (!authConfigured) {
      setErrorMessage(getPublicWebAuthSetupMessage());
      return;
    }

    if (!phoneNumber || !confirmationCode) {
      setErrorMessage("Phone number and confirmation code are required.");
      return;
    }

    setIsPending(true);

    try {
      const response = await fetch("/api/auth/confirm-sign-up", {
        body: JSON.stringify({ code: confirmationCode, phoneNumber: combinedPhoneNumber }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await readAuthResponse<{ error?: string }>(
        response,
        "Confirmation failed.",
      );

      if (!response.ok) {
        throw new Error(payload.error ?? "Confirmation failed.");
      }

      router.push(`/sign-in?confirmed=1${redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : ""}`);
  markNotificationPromptOpportunity();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Confirmation failed.",
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div>
        <div aria-label="Authentication mode" className="segmented-control segmented-control-wide" role="group">
          <a className={`segmented-control-item${mode === "sign-in" ? " is-active" : ""}`} href={`/sign-in${redirectQuery}`}>
            Sign in
          </a>
          <a className={`segmented-control-item${mode === "sign-up" ? " is-active" : ""}`} href={`/sign-up${redirectQuery}`}>
            Sign up
          </a>
        </div>
        <h2>{mode === "sign-up" ? signUpSubMode === "confirm" ? "Confirm account" : "Create account" : "Welcome back"}</h2>
        {!authConfigured ? <p className="muted-text">{getPublicWebAuthSetupMessage()}</p> : null}
      </div>

      {mode === "sign-up" && signUpSubMode === "create" ? (
        <div className="field">
          <label htmlFor="full-name">Full name</label>
          <input
            id="full-name"
            type="text"
            placeholder="Enter your full name"
            disabled={!authConfigured}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="phone-number">Phone number</label>
        <div className="field-row phone-input-row">
          <select
            id="phone-country"
            disabled={!authConfigured}
            value={selectedCountryCode}
            onChange={(event) => handleCountryChange(event.target.value)}
          >
            {PHONE_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {formatPhoneCountryLabel(country)}
              </option>
            ))}
          </select>
          <input
            id="phone-number"
            type="tel"
            inputMode="tel"
            placeholder="Enter your number here"
            disabled={!authConfigured}
            value={phoneNumber}
            onChange={(event) => handlePhoneNumberChange(event.target.value)}
          />
        </div>
      </div>

      {mode === "sign-in" || signUpSubMode === "create" ? (
        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="field-row auth-password-row">
            <input
              id="password"
              type={isPasswordVisible ? "text" : "password"}
              placeholder="At least 8 characters"
              disabled={!authConfigured}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              className="button-secondary small-button"
              disabled={!authConfigured}
              type="button"
              onClick={() => setIsPasswordVisible((currentValue) => !currentValue)}
            >
              {isPasswordVisible ? "Hide" : "Show"}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "sign-up" && signUpSubMode === "create" ? (
        <div className="field">
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            type={isPasswordVisible ? "text" : "password"}
            placeholder="Re-enter your password"
            disabled={!authConfigured}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
      ) : null}

      {mode === "sign-up" && signUpSubMode === "confirm" ? (
        <p className="muted-text">
          Enter the same phone number you used during sign-up, then submit the latest OTP to finish creating the account. Check WhatsApp for OTP.
        </p>
      ) : null}

      {mode === "sign-up" && signUpHint ? <p className="muted-text">{signUpHint}</p> : null}

      {mode === "sign-up" && signUpSubMode === "confirm" ? (
        <div className="field">
          <label htmlFor="confirmation-code">Confirmation code</label>
          <input
            id="confirmation-code"
            placeholder="Enter the code from WhatsApp"
            disabled={!authConfigured}
            value={confirmationCode}
            onChange={(event) => setConfirmationCode(event.target.value)}
          />
          <p className="muted-text">Check WhatsApp for OTP.</p>
        </div>
      ) : null}

      {mode === "sign-up" && signUpSubMode === "confirm" ? (
        <p className="muted-text">
          OTP sent{signUpState?.destination ? ` to ${signUpState.destination}` : ""}. Confirm the account before signing in.
        </p>
      ) : null}

      {(mode === "sign-in" || signUpSubMode === "create") && isTermsAgreementVisible ? (
        <div className="terms-consent-box">
          <label className="role-option terms-consent-checkbox">
            <input
              checked={hasAcceptedTerms}
              disabled={!authConfigured}
              type="checkbox"
              onChange={(event) => setHasAcceptedTerms(event.target.checked)}
            />
            <span>I agree to the TRAPit.in Terms of Service and consent to essential service communications.</span>
          </label>
          <details className="terms-details">
            <summary>Read Terms of Service</summary>
            <div className="terms-scroll-panel">
              {TERMS_OF_SERVICE.map((term) => (
                <p key={term}>{term}</p>
              ))}
            </div>
          </details>
        </div>
      ) : mode === "sign-in" ? (
        <button className="button-secondary small-button" type="button" onClick={() => setIsTermsAgreementVisible(true)}>
          Review Terms of Service
        </button>
      ) : null}

      {mode === "sign-up" && signUpSubMode === "confirm" ? (
        <button
          className="button-secondary"
          disabled={isPending || !authConfigured}
          type="button"
          onClick={() => void handleResendConfirmationCode()}
        >
          Resend OTP
        </button>
      ) : null}

      {signUpState?.warning ? (
        <p className="muted-text">{signUpState.warning}</p>
      ) : null}

      {resendMessage ? <p className="muted-text">{resendMessage}</p> : null}

      {infoMessage ? <p className="muted-text">{infoMessage}</p> : null}

      {errorMessage ? <p className="muted-text">{errorMessage}</p> : null}

      <button className="button" disabled={isPending || !authConfigured} type="submit">
        {isPending
          ? "Working..."
          : !authConfigured
            ? "Auth setup pending"
          : mode === "sign-up"
            ? signUpSubMode === "confirm"
              ? "Confirm account"
              : "Create user account"
            : "Sign in"}
      </button>

      {mode === "sign-in" ? (
        <a className="button-secondary" href="/reset-password">
          Reset password
        </a>
      ) : null}

      {mode === "sign-up" && signUpSubMode === "confirm" ? (
        <a className="button-secondary" href={`/sign-in${redirectQuery}`}>
          Already confirmed? Sign in
        </a>
      ) : null}
    </form>
  );
}