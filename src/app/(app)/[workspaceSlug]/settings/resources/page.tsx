import { notFound } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import type { ResourceRecord } from "@/features/scheduling/types";
import { getSession } from "@/server/auth/session";
import { listResourcesAdmin } from "@/server/services/resourcesAdmin.service";
import { listServiceOptions, type ServiceOption } from "@/server/services/staffAdmin.service";
import { getBusinessName } from "@/server/services/schedulingShared";
import { ResourcesView } from "./ResourcesView";

export default async function ResourcesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { resourcesSettings, hoursSettings, repositoryErrors, common } = getMessages(locale);
  const readOnly = isDemoWorkspaceSlug(workspaceSlug);

  let businessName: string;
  let resources: ResourceRecord[];
  let services: ServiceOption[];
  if (readOnly) {
    const config = getWorkspaceConfig(workspaceSlug);
    businessName = config.name;
    resources = config.resources.map((r, i) => ({
      id: r.id,
      name: r.translations?.[locale] ?? r.name,
      type: r.type,
      description: "",
      active: true,
      sortOrder: i * 10,
      serviceIds: [],
    }));
    services = config.services.map((s) => ({ id: s.id, name: s.translations?.[locale] ?? s.name, active: s.active !== false, requiredResourceType: s.requiredResourceType ?? null }));
  } else {
    try {
      const session = await getSession(workspaceSlug);
      [businessName, resources, services] = await Promise.all([getBusinessName(session), listResourcesAdmin(session), listServiceOptions(session)]);
    } catch {
      notFound();
    }
  }

  return (
    <ResourcesView
      workspaceSlug={workspaceSlug}
      businessName={businessName}
      initialResources={resources}
      services={services}
      readOnly={readOnly}
      messages={resourcesSettings}
      hours={hoursSettings}
      errors={repositoryErrors}
      backLabel={common.back}
      statusLabels={common.saveStatus}
    />
  );
}
