import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession, UnauthenticatedError, WorkspaceAccessError } from "@/server/auth/session";
import { OnboardingWizard } from "../OnboardingWizard";

export const metadata: Metadata = {
  title: "Set up your workspace — ServiceOS",
};

/** Onboarding for a just-created REAL workspace; only its signed-in member may open it. */
export default async function WorkspaceOnboardingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  if (isDemoWorkspaceSlug(workspaceSlug)) notFound();

  let failure: "signin" | "missing" | null = null;
  try {
    await getSession(workspaceSlug);
  } catch (error) {
    if (error instanceof UnauthenticatedError) failure = "signin";
    else if (error instanceof WorkspaceAccessError) failure = "missing";
    else throw error;
  }
  if (failure === "signin") redirect("/login");
  if (failure === "missing") notFound();

  const locale = await getRequestLocale();
  const { onboarding } = getMessages(locale);
  return <OnboardingWizard messages={onboarding} workspaceSlug={workspaceSlug} />;
}
