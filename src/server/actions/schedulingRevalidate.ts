import { revalidatePath } from "next/cache";

/** Pickers, calendar and public booking all read these entities: refresh the whole workspace layout. */
export function revalidateScheduling(workspaceSlug: string): void {
  revalidatePath(`/${workspaceSlug}`, "layout");
  revalidatePath(`/book/${workspaceSlug}`, "layout");
}
