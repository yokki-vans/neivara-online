import {
  CLASSES,
  RACES,
  getClass,
  getRace,
  type CharacterSummary,
  type ClassId,
  type RaceId,
} from "@neivara/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import type { Session } from "../session";

interface Props {
  session: Session;
  onChoose: (character: CharacterSummary) => void;
  onLogout: () => void;
}

export function CharacterScreen({ session, onChoose, onLogout }: Props) {
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [race, setRace] = useState<RaceId>("erim");
  const [classId, setClassId] = useState<ClassId>("warbound");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listCharacters(session.token);
      setCharacters(response.characters);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onLogout();
      else setError(caught instanceof Error ? caught.message : "Не удалось загрузить героев");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const response = await api.createCharacter(session.token, { name, race, classId });
      setCharacters((current) => [response.character, ...current]);
      setName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать героя");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="lobby-shell">
      <header className="lobby-header">
        <div>
          <p className="eyebrow">Совет Мостов · реестр Свидетелей</p>
          <h1>Выберите героя</h1>
        </div>
        <div className="account-chip">
          <span>{session.account.username}</span>
          <button onClick={onLogout}>Выйти</button>
        </div>
      </header>

      <div className="lobby-grid">
        <section className="roster panel-glass">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Ваши персонажи</p>
              <h2>{characters.length} / 7</h2>
            </div>
            <button className="quiet-button" onClick={() => void load()} disabled={loading}>
              Обновить
            </button>
          </div>
          {loading ? (
            <div className="empty-state">Читаем записи Истока…</div>
          ) : characters.length === 0 ? (
            <div className="empty-state">
              <strong>Реестр пока пуст</strong>
              <span>Создайте первого Свидетеля справа.</span>
            </div>
          ) : (
            <div className="character-list">
              {characters.map((character) => {
                const raceInfo = getRace(character.race);
                const classInfo = getClass(character.classId);
                return (
                  <button
                    className="character-card"
                    key={character.id}
                    onClick={() => onChoose(character)}
                    style={{ "--race-color": raceInfo.color } as React.CSSProperties}
                  >
                    <span className="character-sigil" aria-hidden="true" />
                    <span className="character-copy">
                      <strong>{character.name}</strong>
                      <small>
                        {raceInfo.name} · {classInfo.name}
                      </small>
                    </span>
                    <span className="level-medallion">{character.level}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="creator panel-glass">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Новая запись</p>
              <h2>Создать Свидетеля</h2>
            </div>
          </div>
          <form onSubmit={create} className="creator-form">
            <label className="name-field">
              <span>Имя героя</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={20}
                placeholder="Например, Тайра"
                required
              />
            </label>

            <fieldset>
              <legend>Народ</legend>
              <div className="choice-grid races">
                {RACES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={race === entry.id ? "choice active" : "choice"}
                    onClick={() => setRace(entry.id)}
                    style={{ "--choice-color": entry.color } as React.CSSProperties}
                  >
                    <span className="choice-glyph" />
                    <strong>{entry.name}</strong>
                  </button>
                ))}
              </div>
              <p className="choice-description">{getRace(race).summary}</p>
            </fieldset>

            <fieldset>
              <legend>Путь</legend>
              <div className="choice-grid classes">
                {CLASSES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={classId === entry.id ? "choice active" : "choice"}
                    onClick={() => setClassId(entry.id)}
                    style={{ "--choice-color": entry.color } as React.CSSProperties}
                  >
                    <span className="choice-glyph class-glyph" />
                    <strong>{entry.name}</strong>
                    <small>{entry.role}</small>
                  </button>
                ))}
              </div>
              <p className="choice-description">{getClass(classId).summary}</p>
            </fieldset>
            {error && <div className="form-error">{error}</div>}
            <button className="primary-button" type="submit" disabled={creating || characters.length >= 7}>
              {creating ? "Записываем имя…" : "Создать героя"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
