import { getMessages } from "@/lib/i18n";
import { MobileBackToToday } from "@/components/layout/MobileBackToToday/MobileBackToToday";
import { getRequestLocale } from "@/lib/i18n/next";
import { WorkView } from "./WorkView";

export default async function WorkPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { work, workOps, appointment, repositoryErrors, nav } = getMessages(locale);

  return (
    <>
      <MobileBackToToday workspaceSlug={workspaceSlug} label={nav.today} />
      <WorkView
        workspaceSlug={workspaceSlug}
        locale={locale}
        messages={work}
        opsMessages={workOps}
        errorMessages={repositoryErrors}
        appointmentMessages={appointment}
      />
    </>
  );
}
