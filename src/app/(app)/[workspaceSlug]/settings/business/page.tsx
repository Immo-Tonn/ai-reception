import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import { getBusinessProfile } from "@/server/services/businessProfile.service";
import { BusinessProfileView } from "./BusinessProfileView";

export default async function BusinessProfilePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  // Demo workspaces are fixed presets; only a real workspace has an editable profile.
  if (isDemoWorkspaceSlug(workspaceSlug)) notFound();

  const locale = await getRequestLocale();
  const { businessProfile, repositoryErrors, common } = getMessages(locale);
  let profile;
  try {
    profile = await getBusinessProfile(await getSession(workspaceSlug));
  } catch {
    // Not permitted (only roles with settings.manage) or not found: don't reveal which.
    notFound();
  }

  return (
    <BusinessProfileView
      workspaceSlug={workspaceSlug}
      initial={profile}
      messages={businessProfile}
      errors={repositoryErrors}
      backLabel={common.back}
      statusLabels={common.saveStatus}
    />
  );
}
