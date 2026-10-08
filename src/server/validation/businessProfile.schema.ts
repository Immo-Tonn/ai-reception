import { z } from "zod";

export const businessIndustries = [
  "beauty", "cleaning", "auto", "repair", "photography", "education", "consulting", "agency", "other",
] as const;

export const businessCurrencies = ["EUR", "USD", "GBP", "CHF", "PLN", "UAH", "CZK"] as const;

/** Countries offered in the form (ISO 3166-1 alpha-2). A stored value outside this list is kept as is. */
export const businessCountries = [
  "DE", "AT", "CH", "UA", "PL", "CZ", "GB", "US", "FR", "IT", "ES", "NL", "BE", "LT", "LV", "EE",
] as const;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "labrity.de" -> "https://labrity.de"; empty stays empty. */
function normalizeWebsite(value: string): string {
  const v = value.trim();
  // Any other scheme (javascript:, ftp:, ...) is left as is and rejected by the check below.
  if (v === "" || /^https?:\/\//i.test(v) || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v)) return v;
  return `https://${v}`;
}

const optionalText = (max: number) => z.string().trim().max(max);

/**
 * What an owner may change about the business itself. The slug is deliberately absent: it is the
 * public URL. Contact, address, website and description are shown to customers on the public
 * booking page; `discoverable` is a separate consent to be listed in the ServiceOS directory.
 */
export const updateBusinessProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    industry: z.string().trim().min(1).max(50),
    description: optionalText(1000),
    phone: optionalText(40),
    email: z.string().trim().max(254).email().or(z.literal("")),
    website: z.string().transform(normalizeWebsite).pipe(z.string().max(300).regex(/^https?:\/\/[^\s]+$/i).or(z.literal(""))),
    addressLine1: optionalText(200),
    postalCode: optionalText(20),
    city: optionalText(100),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).or(z.literal("")),
    timezone: z.string().refine(isTimeZone),
    currency: z.enum(businessCurrencies),
    publicBookingEnabled: z.boolean(),
    discoverable: z.boolean(),
  })
  // Listed in the directory means bookable: closing online booking also withdraws the listing.
  .transform((value) => ({ ...value, discoverable: value.publicBookingEnabled && value.discoverable }));

export type UpdateBusinessProfileInput = z.input<typeof updateBusinessProfileSchema>;
export type BusinessProfileData = z.output<typeof updateBusinessProfileSchema>;
