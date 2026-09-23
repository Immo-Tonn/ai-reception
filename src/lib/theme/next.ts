import "server-only";
import { cookies } from "next/headers";
import { THEME_COOKIE, defaultTheme, resolveTheme, type Theme } from "./theme";

export { THEME_COOKIE };

export async function getRequestTheme(): Promise<Theme> {
  const store = await cookies();
  return resolveTheme(store.get(THEME_COOKIE)?.value ?? defaultTheme);
}
