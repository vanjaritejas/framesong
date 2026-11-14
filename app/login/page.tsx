import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import LoginForm from "@/components/LoginForm";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sign in – FrameSong" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/studio";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(safeNext);

  return (
    <>
      <SiteHeader />
      <main className="auth">
        <div className="auth-card">
          <h1>Sign in to FrameSong</h1>
          <p className="hint">
            Enter your email and we’ll send you a sign-in link. No password needed.
          </p>
          {error && (
            <p className="notice error" role="alert">
              That sign-in link didn’t work. It may have expired or been opened in a
              different browser. Request a new link below.
            </p>
          )}
          <LoginForm next={safeNext} />
        </div>
      </main>
    </>
  );
}
