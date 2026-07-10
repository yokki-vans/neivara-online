import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { Session } from "../session";

interface Props {
  onAuthenticated: (session: Session) => void;
}

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response =
        mode === "login"
          ? await api.login(username, password)
          : await api.register(username, password);
      onAuthenticated(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Неизвестная ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-lore" aria-label="О мире">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <i />
        </div>
        <p className="eyebrow">Браузерная 3D MMORPG · ранний прототип</p>
        <h1>
          Истоки
          <span>Нейвары</span>
        </h1>
        <p className="lead">
          Земля помнит больше, чем должна. Станьте Свидетелем и отделите настоящее
          от опасных отголосков прошлого.
        </p>
        <div className="feature-row">
          <span>Общий мир</span>
          <span>PvE и PvP</span>
          <span>Оригинальная вселенная</span>
        </div>
      </section>

      <section className="auth-panel panel-glass">
        <div className="status-line">
          <span className="status-dot" />
          Долина открыта для Свидетелей
        </div>
        <div className="tabs" role="tablist" aria-label="Вход или регистрация">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
            role="tab"
            aria-selected={mode === "login"}
          >
            Войти
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
            role="tab"
            aria-selected={mode === "register"}
          >
            Создать аккаунт
          </button>
        </div>

        <form onSubmit={submit} className="stack-form">
          <label>
            <span>Логин</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={24}
              placeholder="Имя аккаунта"
              required
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              minLength={8}
              maxLength={128}
              placeholder="Не менее 8 символов"
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Соединяемся…" : mode === "login" ? "Войти в Нейвару" : "Стать Свидетелем"}
          </button>
        </form>
        <p className="fine-print">
          Это самостоятельный ранний прототип. Персонажи memory-сервера удаляются
          при его перезапуске; PostgreSQL сохраняет прогресс постоянно.
        </p>
      </section>
    </main>
  );
}
