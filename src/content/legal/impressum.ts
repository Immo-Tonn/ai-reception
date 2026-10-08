/**
 * Impressum (provider information) — the ONE file to update.
 *
 * Canonical legal text stays German and is never machine-translated. No fact
 * may be invented: every value is either a verified fact or the TODO marker,
 * which the page renders as a visible, unmistakable placeholder.
 *
 * Source status: the only Impressum found read-only on this machine
 * (Desktop/Labrity, "Diensteanbieter / Kontaktmöglichkeiten / Inhaltlich
 * verantwortlich") belongs to another site and cannot be proven to be the
 * operator of ServiceOS, so NONE of its personal data was taken over. Only
 * the section structure (incl. the "§ 18 Abs. 2 MStV" heading) was reused.
 * See docs/LEGAL_TODO.md. Set `impressumApproved` to true only after every
 * TODO is replaced AND the text had a legal review.
 */

export const TODO = "TODO" as const;
export type TodoMarker = typeof TODO;

/** Release blocker flag, checked by `npm run check:legal`. */
export const impressumApproved = false;

export interface ImpressumField {
  id: string;
  /** German label (canonical legal wording). */
  label: string;
  value: string | TodoMarker;
  /** Only for fields that are mandatory under certain conditions. */
  conditional?: boolean;
}

export interface ImpressumSection {
  id: string;
  title: string;
  fields: ImpressumField[];
}

/** Values that were verified in a reference source. Empty on purpose. */
export const verifiedImpressumFacts: readonly string[] = [];

export const impressumSections: ImpressumSection[] = [
  {
    id: "diensteanbieter",
    title: "Diensteanbieter",
    fields: [
      { id: "providerName", label: "Name / Firma", value: TODO },
      { id: "owner", label: "Inhaber / Vertretungsberechtigte(r)", value: TODO },
      { id: "street", label: "Straße und Hausnummer", value: TODO },
      { id: "postalCity", label: "PLZ und Ort", value: TODO },
      { id: "country", label: "Land", value: TODO },
    ],
  },
  {
    id: "kontakt",
    title: "Kontaktmöglichkeiten",
    fields: [
      { id: "email", label: "E-Mail-Adresse", value: TODO },
      { id: "phone", label: "Telefon", value: TODO },
    ],
  },
  {
    id: "verantwortlich",
    title: "Inhaltlich verantwortlich",
    fields: [
      { id: "responsibleName", label: "Verantwortlich für Inhalte gemäß § 18 Abs. 2 MStV", value: TODO },
      { id: "responsibleAddress", label: "Anschrift der verantwortlichen Person", value: TODO },
    ],
  },
  {
    id: "register",
    title: "Register und Steuer (falls zutreffend)",
    fields: [
      { id: "legalForm", label: "Rechtsform", value: TODO, conditional: true },
      { id: "commercialRegister", label: "Handelsregister und Registernummer", value: TODO, conditional: true },
      { id: "vatId", label: "Umsatzsteuer-Identifikationsnummer", value: TODO, conditional: true },
      { id: "supervisoryAuthority", label: "Zuständige Aufsichtsbehörde", value: TODO, conditional: true },
    ],
  },
];

export function allImpressumFields(): ImpressumField[] {
  return impressumSections.flatMap((s) => s.fields);
}

export function missingImpressumFields(): ImpressumField[] {
  return allImpressumFields().filter((f) => f.value === TODO);
}
