import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { OnboardingWizard } from "./OnboardingWizard";

export const metadata: Metadata = {
  title: "Set up your workspace — ServiceOS",
};

export default async function OnboardingPage() {
  const locale = await getRequestLocale();
  const { onboarding } = getMessages(locale);

  return <OnboardingWizard messages={onboarding} />;
}
