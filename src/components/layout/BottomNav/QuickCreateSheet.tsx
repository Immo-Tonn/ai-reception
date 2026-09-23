"use client";

import { useRouter } from "next/navigation";
import { Icon, Sheet, type IconName } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import styles from "./QuickCreateSheet.module.css";

interface QuickCreateSheetProps {
  open: boolean;
  onClose: () => void;
  workspaceSlug: string;
  messages: Messages["quickCreate"];
}

export function QuickCreateSheet({
  open,
  onClose,
  workspaceSlug,
  messages,
}: QuickCreateSheetProps) {
  const router = useRouter();
  const base = `/${workspaceSlug}`;

  const items: { icon: IconName; title: string; hint: string; href: string }[] = [
    {
      icon: "calendar",
      title: messages.appointment,
      hint: messages.appointmentHint,
      href: `${base}/calendar?create=appointment`,
    },
    {
      icon: "clients",
      title: messages.client,
      hint: messages.clientHint,
      href: `${base}/clients?create=client`,
    },
    {
      icon: "receipt",
      title: messages.invoice,
      hint: messages.invoiceHint,
      href: `${base}/finance?create=invoice`,
    },
  ];

  function handleSelect(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <Sheet open={open} onClose={onClose} title={messages.title}>
      <div className={styles.list}>
        {items.map((item) => (
          <button
            key={item.href}
            type="button"
            className={styles.item}
            onClick={() => handleSelect(item.href)}
          >
            <span className={styles.itemIcon}>
              <Icon name={item.icon} size={20} />
            </span>
            <span className={styles.itemBody}>
              <span className={styles.itemTitle}>{item.title}</span>
              <span className={styles.itemHint}>{item.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
