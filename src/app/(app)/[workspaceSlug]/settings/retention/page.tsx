import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import {
  CLIENT_RETENTION_MAX_MONTHS,
  CLIENT_RETENTION_MIN_MONTHS,
  getRetentionSettings,
  RECOMMENDED_CLIENT_RETENTION_MONTHS,
  type RetentionSettings,
} from "@/server/services/retentionSettings.service";
import { RetentionView } from "./RetentionView";

export default async function RetentionSettingsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { retentionSettings, repositoryErrors, common } = getMessages(locale);

  const readOnly = isDemoWorkspaceSlug(workspaceSlug);
  let settings: RetentionSettings;
  if (readOnly) {
    settings = {
      clientRetentionMonths: RECOMMENDED_CLIENT_RETENTION_MONTHS,
      recommendedMonths: RECOMMENDED_CLIENT_RETENTION_MONTHS,
      minMonths: CLIENT_RETENTION_MIN_MONTHS,
      maxMonths: CLIENT_RETENTION_MAX_MONTHS,
      canEdit: false,
      autoAnonymizeActive: false,
      businessName: getWorkspaceConfig(workspaceSlug).name,
    };
  } else {
    try {
      settings = await getRetentionSettings(await getSession(workspaceSlug));
    } catch {
      notFound();
    }
  }

  return (
    <RetentionView
      workspaceSlug={workspaceSlug}
      initial={settings}
      readOnly={readOnly}
      messages={retentionSettings}
      errors={repositoryErrors}
      backLabel={common.back}
      statusLabels={common.saveStatus}
    />
  );
}
