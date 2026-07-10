import type { AccountView } from "@neivara/shared";

export interface Session {
  token: string;
  account: AccountView;
}

const KEY = "neivara.session.v1";

export function readSession(): Session | null {
  try {
    const value = localStorage.getItem(KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<Session>;
    return parsed.token && parsed.account?.id && parsed.account.username
      ? (parsed as Session)
      : null;
  } catch {
    return null;
  }
}

export function writeSession(session: Session | null): void {
  if (session) localStorage.setItem(KEY, JSON.stringify(session));
  else localStorage.removeItem(KEY);
}
