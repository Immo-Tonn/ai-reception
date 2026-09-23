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
  const { work, appointment } = getMessages(locale);

  return (
    <WorkView
      workspaceSlug={workspaceSlug}
      locale={locale}
      messages={work}
      appointmentMessages={appointment}
    />
  );
}
