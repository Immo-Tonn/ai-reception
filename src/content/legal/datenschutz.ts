/**
 * Datenschutzerklärung — layout skeleton ONLY. There is deliberately no
 * legal text: it must be written and approved (Needs legal review) first.
 * Flip `datenschutzApproved` to true only when the real, reviewed text
 * replaces the placeholder; `npm run check:legal` fails the release check
 * while it is false.
 */

export const datenschutzApproved = false;

/** ISO date (YYYY-MM-DD) of the approved text; null while it is a draft. */
export const datenschutzLastUpdated: string | null = null;

export interface DatenschutzSection {
  id: string;
  title: string;
}

/** Headings only — the table of contents and section anchors. */
export const datenschutzSections: DatenschutzSection[] = [
  { id: "verantwortlicher", title: "Verantwortlicher" },
  { id: "verarbeitete-daten", title: "Verarbeitete Daten und Zwecke" },
  { id: "rechtsgrundlagen", title: "Rechtsgrundlagen" },
  { id: "empfaenger", title: "Empfänger und Auftragsverarbeiter" },
  { id: "speicherdauer", title: "Speicherdauer" },
  { id: "cookies", title: "Cookies und lokale Speicherung" },
  { id: "betroffenenrechte", title: "Ihre Rechte" },
  { id: "kontakt", title: "Kontakt und Beschwerderecht" },
];
