import Link from "next/link";
import type { Metadata } from "next";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { googleErrorFromParam, isGoogleLoginEnabled } from "@/lib/auth/googleLogin";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { PublicFooter } from "@/components/layout/PublicFooter/PublicFooter";
import { BackLink } from "@/components/ui";
import { sanitizeClientRedirect } from "@/features/clientAccount/redirect";
import { LoginForm } from "./LoginForm";
import styles from "../client.module.css";

export const metadata: Metadata = {
  title: "Sign in — ServiceOS",
};

export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[]; google?: string | string[] }>;
}) {
  const params = await searchParams;
  const redirect = sanitizeClientRedirect(params.redirect);
  const googleError = googleErrorFromParam(params.google);
  const locale = await getRequestLocale();
  const { client, common, authErrors, googleAuth } = getMessages(locale);

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <BackLink href="/client" label={common.backToClientArea} />
        <Preferences />
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>{client.loginTitle}</h1>
        <p className={styles.subtitle}>{client.loginSubtitle}</p>
        {isGoogleLoginEnabled() ? (
          <GoogleButton
            intent="client"
            next={redirect}
            label={googleAuth.continueWith}
            orLabel={googleAuth.or}
            errorText={googleError ? authErrors[googleError] : undefined}
          />
        ) : null}
        <LoginForm
          messages={client}
          errors={authErrors}
          passwordLabels={{ show: common.showPassword, hide: common.hidePassword }}
          redirect={redirect}
        />
        <p className={styles.promptRow}>
          {client.businessPrompt}{" "}
          <Link href="/business" className={styles.promptLink}>
            {client.businessLink}
          </Link>
        </p>
      </div>
      <PublicFooter />
    </main>
  );
}
