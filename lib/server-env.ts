// Secret keys only exist on the server. Never import this from a "use client" file.
export function requireEnv(name: "ANTHROPIC_API_KEY" | "FAL_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is missing. Add it to .env.local, then stop the website (Ctrl + C) and start it again with npm run dev.`,
    );
  }
  return value;
}
