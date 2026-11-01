"use client";

import {
  combinePhoneNumber,
  DEFAULT_PHONE_COUNTRY_CODE,
  formatPhoneCountryLabel,
  getPhoneCountryByCode,
  PHONE_COUNTRIES,
  sanitizeNationalPhoneInput,
} from "@trapit/auth";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  getPublicWebAuthSetupMessage,
  isPublicWebAuthConfigured,
} from "../lib/public-auth-config";
import { getSafeAuthReturnPath } from "../lib/auth-return-path";
import { markNotificationPromptOpportunity } from "./browser-push-prompt";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

const EXISTING_ACCOUNT_ERROR = "An account with this phone number already exists.";
const TERMS_OF_SERVICE = [
  "Effective Date: 01-Nov-2026",
  "Platform: TRAPit.in",
  "Welcome to TRAPit.in. By creating an account, accessing, or using TRAPit.in, you agree to be bound by these Terms & Conditions (\"Terms\"). If you do not agree to these Terms, please do not use the platform.",
  "1. General & Account Terms",
  "1.1 Acceptance of Terms: By signing up for or using TRAPit.in, you agree to these Terms, our Privacy Policy, and any other policies or guidelines published by TRAPit.in from time to time.",
  "1.2 Eligibility to Use: Users confirm that they are legally eligible to use TRAPit.in under applicable Indian law. Users under 18 years of age may use the platform only with the consent and supervision of a parent, legal guardian, teacher, school, or other authorized adult.",
  "1.3 Accuracy of Information: You agree that all information provided during registration or while using TRAPit.in is true, accurate, current, and complete. You are responsible for keeping your profile and details updated.",
  "1.4 Account Security: You are responsible for keeping your credentials confidential and for all activity that occurs under your account. Promptly notify us of any unauthorized access or security breach.",
  "1.5 Service Communications: By creating an account, you agree to receive essential service-related communications from TRAPit.in, including account verification, password reset messages, security notices, technical updates, subscription alerts, and administrative notifications.",
  "2. Payments, Subscriptions & Pricing",
  "2.1 Pricing and Fees: Certain features, tests, services, or subscriptions on TRAPit.in may require payment of fees. All prices and charges are displayed in Indian Rupees (INR) and are inclusive of applicable taxes unless stated otherwise.",
  "2.2 Subscription Terms: If you purchase a recurring subscription plan on TRAPit.in: Your subscription will automatically renew at the end of each billing cycle (e.g., monthly or annually) unless cancelled prior to the renewal date. You authorize us (via our third-party payment gateway) to automatically charge the applicable subscription fee to your saved payment method on each renewal date. You may manage or cancel your subscription at any time through your account settings. Cancellation will take effect at the end of the current active billing period.",
  "2.3 Payment Gateway Services: All online payments, credit/debit card transactions, UPI, net banking, and automated subscription mandates are processed securely through third-party payment gateways. By initiating a transaction, you agree to comply with the terms and privacy policies of the payment gateway provider. TRAPit.in does not store complete sensitive financial details like credit/debit card numbers or CVVs on its servers.",
  "2.4 Service Fulfillment & Delivery Policy: TRAPit.in is a digital SaaS platform. Upon successful payment verification for subscription upgrades (Pro / Pro Max), access to premium features is granted instantly or within 24 hours. For appointment bookings, digital confirmation is issued immediately upon transaction approval. No physical goods are shipped.",
  "2.5 Refund, Cancellation & Delivery Policy:",
  "Digital Services / Subscriptions: Due to the digital nature of the services provided by TRAPit.in (such as online tests, polls, and workspace access), all purchases and subscription fees paid for Pro / Pro Max tiers remain strictly non-refundable once accessed, except where required by law or explicitly stated for a specific service.",
  "Cancellation: You can cancel your subscription or paid services through your user dashboard. Once cancelled, you will retain access until the end of your paid billing cycle. No pro-rata refunds are provided for partial use periods.",
  "Disputes & Failed Transactions: Refunds are strictly limited to technical errors, duplicate charges, or failed transactions. If a technical error or double-charge occurs during payment, users must report it within 3 business days. Verified transaction failures or erroneous deductions will be refunded back to the original source account via third-party payment gateway within 10 business days. For support, please refer to the contact details mentioned in the platform's three-dot menu.",
  "3. Peer-to-Peer (P2P) Transactions & User-to-User Payments",
  "3.1 Facilitation of User Payments: TRAPit.in may allow certain users or creators to send, receive, or collect payments from other users for tests, services, group activities, or content sharing.",
  "3.2 Platform Role: TRAPit.in acts strictly as a technology facilitator and intermediary platform. We do not act as a banking institution, escrow service, or financial custodian.",
  "3.3 Independent Transactions & User Responsibility: Users engaging in peer-to-peer transactions or collections are solely responsible for setting prices, fulfilling commitments, and complying with applicable commercial and tax laws (including GST, if applicable). For appointments or services paid directly to business owners/creators (peers) on TRAPit.in, cancellation and refund terms are governed by the respective business owner's personal policy. Clients should contact the service provider directly for cancellations or adjustment requests. TRAPit.in is not responsible for any disputes, payment failures, chargebacks, fraud, or non-delivery of services arising between users. Any financial agreements or transactions are strictly between the participating users.",
  "3.4 Transaction Fees & Deductions: TRAPit.in or its payment processing partners may deduct platform fees, service charges, or gateway processing fees from user-to-user transactions as disclosed at the time of the transaction.",
  "4. User Conduct & Content Rules",
  "4.1 Permitted and Lawful Use: You agree to use TRAPit.in only for lawful purposes and in accordance with these Terms. You must not use the platform for fraud, abuse, cheating, harmful conduct, unauthorized access, or any activity that disrupts the platform or affects other users.",
  "4.2 Content and Conduct Rules: You agree not to upload, post, share, submit, or transmit any content that is unlawful, defamatory, obscene, abusive, harmful, misleading, violates rights, contains harmful code, or interferes with the operation, security, or integrity of TRAPit.in.",
  "4.3 User Responsibility for Uploaded Content and Copyright: You are solely responsible for any content, material, documents, images, text, questions, answers, media, or other information uploaded, posted, shared, or submitted by you on TRAPit.in. You represent and warrant that you own such content or have all necessary rights, permissions, licenses, and authorizations to use it. TRAPit.in does not claim ownership of user-uploaded content and shall not be held responsible for copyright infringement, trademark violation, intellectual property dispute, or other legal claim arising from content uploaded by users.",
  "4.4 Indemnification: You agree to indemnify and hold harmless TRAPit.in, its owners, operators, employees, and affiliates from any claims, losses, damages, liabilities, costs, or expenses related to your uploaded content, your transactions with other users, or your violation of these Terms or third-party rights.",
  "5. Privacy, Data Use & Compliance",
  "5.1 Privacy and Data Use: You acknowledge that TRAPit.in may collect, use, store, and process your personal and transactional information in accordance with its Privacy Policy and as necessary to provide, maintain, secure, and improve the platform. By using the site, you consent to the use of cookies to enhance your experience and analyze traffic.",
  "5.2 Sharing of Information: We do not sell or rent your personal information to third parties. Information is only shared with trusted service providers (such as Razorpay for payment processing and communication APIs for OTP/alerts) as required to deliver our services, or when required by Indian law.",
  "5.3 Compliance with Indian Law: You agree to use TRAPit.in in compliance with all applicable laws in India, including the Information Technology Act, applicable consumer protection guidelines, digital payment regulations, intellectual property laws, and cyber regulations.",
  "6. Suspension, Termination & Modifications",
  "6.1 Suspension or Termination: TRAPit.in reserves the right to suspend, restrict, or terminate your account or access to the platform, with or without notice, if it believes you have violated these Terms, misused payment features, created security or legal risks, or engaged in conduct harmful to TRAPit.in or other users.",
  "6.2 Changes to Terms: TRAPit.in may revise or update these Terms from time to time. Updated Terms will become effective upon posting on the platform. Your continued use of TRAPit.in after such changes become effective constitutes your acceptance of the revised Terms.",
  "7. Disclaimers & Limitation of Liability",
  "7.1 Educational / Test Platform Disclaimer: If TRAPit.in is used for online tests, polls, or shared workspaces, the platform acts only as a technology facilitator unless expressly stated otherwise. TRAPit.in does not guarantee academic outcomes, scores, rankings, admissions, certifications, or institutional decisions based on platform usage.",
  "7.2 Availability of Service: TRAPit.in does not guarantee uninterrupted, timely, secure, or error-free operation of the platform and may temporarily suspend access for maintenance, upgrades, technical issues, or circumstances beyond its control.",
  "7.3 Limitation of Liability: To the maximum extent permitted under applicable law, TRAPit.in shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of data, revenue, profits, goodwill, or opportunity arising out of or in connection with your use of or inability to use the platform, subscription services, or user-to-user transactions.",
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
  const redirectPath = getSafeAuthReturnPath(searchParams.get("redirect"));
  const redirectQuery = redirectPath ? `?redirect=${encodeURIComponent(redirectPath)}` : "";
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
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [selectedCountryCode, setSelectedCountryCode] = useState(DEFAULT_PHONE_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [isTermsAgreementVisible, setIsTermsAgreementVisible] = useState(mode === "sign-up");
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
      : searchParams.get("reset")
        ? "Password updated. Sign in with the new password."
        : searchParams.get("confirmed")
          ? "Account confirmed. You can sign in now."
          : searchParams.get("existing")
            ? "Account already exists and is confirmed. Sign in with your password."
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
    setIsConfirmPasswordVisible(false);
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
    setIsConfirmPasswordVisible(false);
    setConfirmationCode("");
    setSignUpState(null);
    setErrorMessage(null);
    setResendMessage(null);
  }

  function openConfirmAccount(options?: {
    destination?: string | null;
    warning?: string;
  }) {
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

    if (mode === "sign-up" && !confirmPassword) {
      setErrorMessage("Confirm password is required.");
      return;
    }

    if (mode === "sign-up" && password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (mode === "sign-up" && !signUpState?.requiresConfirmation && !hasAcceptedTerms) {
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
          shouldSignIn?: boolean;
          warning?: string;
        }>(response, "Sign-up failed.");

        if (!response.ok) {
          const nextError = payload.error ?? "Sign-up failed.";

          if (nextError === EXISTING_ACCOUNT_ERROR) {
            openConfirmAccount({
              warning: "This phone number already has a pending account. Confirm it with the OTP, or resend the OTP if you no longer have it.",
            });
          }

          throw new Error(nextError);
        }

        setSignUpState({
          destination: payload.deliveryDestination ?? null,
          requiresConfirmation: payload.requiresConfirmation ?? true,
          warning: payload.warning,
        });

        if (payload.shouldSignIn) {
          router.push(`/sign-in?existing=1${redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : ""}`);
          return;
        }

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
        {!authConfigured ? <p className="muted-text">{getPublicWebAuthSetupMessage()}</p> : null}
      </div>

      {mode === "sign-up" ? (
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

      {mode === "sign-in" || mode === "sign-up" ? (
        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="auth-password-control">
            <input
              id="password"
              type={isPasswordVisible ? "text" : "password"}
              placeholder="At least 8 characters"
              disabled={!authConfigured}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              aria-label={isPasswordVisible ? "Hide password" : "Show password"}
              aria-pressed={isPasswordVisible}
              className="auth-password-toggle"
              disabled={!authConfigured}
              type="button"
              onClick={() => setIsPasswordVisible((currentValue) => !currentValue)}
            >
              {isPasswordVisible ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "sign-up" ? (
        <div className="field">
          <label htmlFor="confirm-password">Confirm password</label>
          <div className="auth-password-control">
            <input
              id="confirm-password"
              type={isConfirmPasswordVisible ? "text" : "password"}
              placeholder="Re-enter your password"
              disabled={!authConfigured}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            <button
              aria-label={isConfirmPasswordVisible ? "Hide confirmed password" : "Show confirmed password"}
              aria-pressed={isConfirmPasswordVisible}
              className="auth-password-toggle"
              disabled={!authConfigured}
              type="button"
              onClick={() => setIsConfirmPasswordVisible((currentValue) => !currentValue)}
            >
              {isConfirmPasswordVisible ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "sign-up" && signUpHint && !signUpState?.requiresConfirmation ? <p className="muted-text">{signUpHint}</p> : null}

      {mode === "sign-up" && signUpState?.requiresConfirmation ? (
        <div className="field">
          <label htmlFor="confirmation-code">Enter OTP here, check WhatsApp for OTP</label>
          <input
            id="confirmation-code"
            placeholder="Enter the code from WhatsApp"
            disabled={!authConfigured}
            value={confirmationCode}
            onChange={(event) => setConfirmationCode(event.target.value)}
          />
        </div>
      ) : null}

      {(mode === "sign-in" || (mode === "sign-up" && !signUpState?.requiresConfirmation)) && isTermsAgreementVisible ? (
        <div className="terms-consent-box">
          <label className="role-option terms-consent-checkbox">
            <input
              checked={hasAcceptedTerms}
              disabled={!authConfigured}
              type="checkbox"
              onChange={(event) => setHasAcceptedTerms(event.target.checked)}
            />
            <span>I agree to the TRAPit.in Terms of Service.</span>
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
      ) : null}

      {mode === "sign-up" && signUpState?.requiresConfirmation ? (
        <button className="button" disabled={isPending || !authConfigured} type="button" onClick={() => void handleConfirmSignUp()}>
          {isPending ? "Working..." : "Confirm account"}
        </button>
      ) : null}

      {mode === "sign-up" && signUpState?.requiresConfirmation ? (
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

      {!(mode === "sign-up" && signUpState?.requiresConfirmation) ? (
        <button className="button" disabled={isPending || !authConfigured} type="submit">
          {isPending
            ? "Working..."
            : !authConfigured
              ? "Auth setup pending"
            : mode === "sign-up"
              ? "Create user account"
              : "Sign in"}
        </button>
      ) : null}

      {mode === "sign-in" ? (
        <nav aria-label="Sign-in help" className="auth-footer-links">
          <a href="/reset-password">Reset password</a>
          <span aria-hidden="true" className="auth-footer-divider" />
          <a href={`/sign-up${redirectQuery}`}>New user? Sign up</a>
        </nav>
      ) : null}

      {mode === "sign-up" ? <a className="auth-footer-link" href={`/sign-in${redirectQuery}`}>Already have an account? Sign in</a> : null}
    </form>
  );
}