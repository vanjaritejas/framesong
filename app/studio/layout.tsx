import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";

export default async function StudioLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio");

  return (
    <>
      <SiteHeader email={user.email} />
      <main className="page">
        <div className="wrap">{children}</div>
      </main>
    </>
  );
}
