"use client";

import { useMemo } from "react";
import { useRepositoryCollection } from "@/lib/repository/useRepository";
import { getAppointmentsRepository } from "./repository";

export function useAppointments(workspaceSlug: string) {
  const repository = useMemo(() => getAppointmentsRepository(workspaceSlug), [workspaceSlug]);
  return useRepositoryCollection(repository);
}
