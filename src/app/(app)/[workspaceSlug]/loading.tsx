import styles from "./loading.module.css";

/**
 * Instant feedback while a workspace page loads (Next.js `loading.tsx`):
 * with <Link> navigation the sidebar / bottom nav stay and this appears at
 * once, instead of a frozen screen until the server answers.
 */
export default function WorkspaceLoading() {
  return (
    <main className={styles.page} aria-busy="true">
      <div className={styles.progress} aria-hidden="true" />
      <div className={`${styles.block} ${styles.title}`} />
      <div className={styles.block} />
      <div className={styles.block} />
      <div className={`${styles.block} ${styles.short}`} />
    </main>
  );
}
