import "server-only";

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function getConfiguredContactDetails() {
  const email = process.env.ADMIN_ACCESS_CONTACT_EMAIL?.trim();
  const phone = process.env.ADMIN_ACCESS_CONTACT_PHONE?.trim();

  return {
    email: hasValue(email) ? email : null,
    phone: hasValue(phone) ? phone : null,
  };
}

export function getAdminAccessContactMessage() {
  const { email, phone } = getConfiguredContactDetails();

  if (email && phone) {
    return `Contact ${email} or ${phone} to request admin access.`;
  }

  if (email) {
    return `Contact ${email} to request admin access.`;
  }

  if (phone) {
    return `Contact ${phone} to request admin access.`;
  }

  return "Contact your administrator to request admin access.";
}

export function getAdminRoleMismatchMessage(actualRole: string, expectedRole: string) {
  return `This account is signed in as ${actualRole}, not ${expectedRole}. ${getAdminAccessContactMessage()}`;
}