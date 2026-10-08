import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { WorkView } from "./WorkView";

export default async function WorkPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { work, workOps, appointment, repositoryErrors } = getMessages(locale);

  return (
    <WorkView
      workspaceSlug={workspaceSlug}
      locale={locale}
      messages={work}
      opsMessages={workOps}
      errorMessages={repositoryErrors}
      appointmentMessages={appointment}
    />
  );
}
