import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getSession, UnauthenticatedError, WorkspaceAccessError } from "@/server/auth/session";
import { OnboardingWizard } from "./OnboardingWizard";

export const metadata: Metadata = {
  title: "Set up your workspace — ServiceOS",
};

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  // Onboarding only makes sense for the owner of a real, just-created
  // workspace — not the 4 demo presets (which never go through signup)
  // and not someone else's workspace. Reuses the exact same session
  // check every real Server Action already goes through.
  try {
    await getSession(workspaceSlug);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    if (error instanceof WorkspaceAccessError) {
      redirect("/business");
    }
    throw error;
  }

  const locale = await getRequestLocale();
  const { onboarding } = getMessages(locale);

  return <OnboardingWizard messages={onboarding} workspaceSlug={workspaceSlug} />;
}
