"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import { demoWorkspaces } from "@/features/workspace/registry";
import styles from "./WorkspaceSwitcher.module.css";

/**
 * Demo-only presentation tool: jump between industry presets — same
 * Calendar/Appointment/Clients engine, different WorkspaceConfig — to
 * show ServiceOS isn't a beauty-only product. Not gated behind an env
 * check on purpose (there's no separate prod build in this project yet);
 * it only ever lists the four demo slugs, never a real workspace.
 */
export function WorkspaceSwitcher({ currentSlug }: { currentSlug: string }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const current = demoWorkspaces.find((w) => w.slug === currentSlug);

  function selectWorkspace(slug: string) {
    setOpen(false);
    if (slug === currentSlug) return;
    // Keep whatever sub-page you're on (e.g. /calendar, /clients) so
    // switching workspaces lands on the same screen, just re-themed.
    const segments = pathname?.split("/").filter(Boolean) ?? [];
    const rest = segments.slice(1).join("/");
    router.push(`/${slug}${rest ? `/${rest}` : ""}`);
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.triggerEmoji}>{current?.emoji ?? "🏢"}</span>
        <span className={styles.triggerLabel}>{current?.name ?? currentSlug}</span>
        <Icon name="chevronDown" size={14} />
      </button>

      {open ? (
        <div className={styles.menu} role="listbox">
          <div className={styles.menuLabel}>Demo workspace</div>
          {demoWorkspaces.map((workspace) => (
            <button
              key={workspace.slug}
              type="button"
              role="option"
              aria-selected={workspace.slug === currentSlug}
              className={styles.option}
              onClick={() => selectWorkspace(workspace.slug)}
            >
              <span className={styles.optionEmoji}>{workspace.emoji}</span>
              <span className={styles.optionBody}>
                <span className={styles.optionName}>{workspace.name}</span>
                <span className={styles.optionTagline}>{workspace.tagline}</span>
              </span>
              {workspace.slug === currentSlug ? (
                <span className={styles.optionCheck}>
                  <Icon name="check" size={16} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
