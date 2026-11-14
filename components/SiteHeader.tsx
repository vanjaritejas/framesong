import Link from "next/link";

export default function SiteHeader({ email }: { email?: string | null }) {
  return (
    <header className="site-header">
      <div className="wrap">
        <Link href="/" className="brand">
          FrameSong
        </Link>
        <nav className="nav" aria-label="Main">
          {email ? (
            <>
              <Link href="/studio">Your movies</Link>
              <Link href="/studio/new">New movie</Link>
              <span className="who" title={email}>
                {email}
              </span>
              <form action="/auth/signout" method="post">
                <button type="submit" className="link-button">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
