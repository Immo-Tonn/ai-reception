import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { listStaffAction } from "@/server/actions/staff.actions";
import { StaffView } from "./StaffView";

export default async function SettingsStaffPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { settingsStaff, common } = getMessages(locale);
  const initialStaff = await listStaffAction(workspaceSlug);

  return (
    <StaffView
      workspaceSlug={workspaceSlug}
      initialStaff={initialStaff}
      messages={settingsStaff}
      backLabel={common.back}
    />
  );
}
