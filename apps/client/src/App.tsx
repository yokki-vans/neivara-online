import type { CharacterSummary } from "@neivara/shared";
import { lazy, Suspense, useState } from "react";
import { AuthScreen } from "./screens/AuthScreen";
import { CharacterScreen } from "./screens/CharacterScreen";
import { readSession, writeSession, type Session } from "./session";

const GameScreen = lazy(() =>
  import("./screens/GameScreen").then((module) => ({ default: module.GameScreen })),
);

export function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [character, setCharacter] = useState<CharacterSummary | null>(null);

  const acceptSession = (next: Session) => {
    writeSession(next);
    setSession(next);
  };
  const logout = () => {
    writeSession(null);
    setCharacter(null);
    setSession(null);
  };

  if (!session) return <AuthScreen onAuthenticated={acceptSession} />;
  if (!character) {
    return (
      <CharacterScreen
        session={session}
        onChoose={setCharacter}
        onLogout={logout}
      />
    );
  }
  return (
    <Suspense fallback={<div className="game-loading">Пробуждаем память Истока…</div>}>
      <GameScreen
        session={session}
        character={character}
        onExit={() => setCharacter(null)}
        onSessionExpired={logout}
      />
    </Suspense>
  );
}
