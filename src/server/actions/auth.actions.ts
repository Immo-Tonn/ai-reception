"use server";

import { redirect } from "next/navigation";
import { getBusinessAuth } from "@/server/auth/supabaseBusinessAuth";

/** Ends the business session and returns to the sign-in page. */
export async function signOutAction(): Promise<void> {
  await getBusinessAuth().signOut();
  redirect("/login");
}
