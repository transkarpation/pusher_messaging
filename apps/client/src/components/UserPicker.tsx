import { useEffect, useState } from "react";
import type { User } from "@pm/shared";
import { api } from "../api";
import { displayName } from "../lib/users";

const SEARCH_DEBOUNCE_MS = 250;

interface UserPickerProps {
  selected: User[];
  onChange: (users: User[]) => void;
  /** Users that can't be picked (e.g. already members). */
  excludeIds?: number[];
}

export function UserPicker({ selected, onChange, excludeIds = [] }: UserPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .searchUsers(query.trim())
        .then((users) => {
          if (cancelled) return;
          setResults(users);
          setError(null);
        })
        .catch((e) => !cancelled && setError((e as Error).message));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const selectedIds = new Set(selected.map((u) => u.id));
  const excluded = new Set(excludeIds);
  const visible = results.filter((u) => !excluded.has(u.id));

  const toggle = (user: User) =>
    onChange(selectedIds.has(user.id) ? selected.filter((u) => u.id !== user.id) : [...selected, user]);

  return (
    <div className="stack picker">
      {selected.length > 0 && (
        <ul className="chips">
          {selected.map((u) => (
            <li key={u.id}>
              {displayName(u)}
              <button type="button" className="ghost icon" aria-label={`Remove ${displayName(u)}`} onClick={() => toggle(u)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="search"
        placeholder="Search people by name or username"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <ul className="picker-results">
        {visible.length === 0 ? (
          <li className="muted">{query ? "No one found" : "No one to add"}</li>
        ) : (
          visible.map((u) => (
            <li key={u.id}>
              <label>
                <input type="checkbox" checked={selectedIds.has(u.id)} onChange={() => toggle(u)} />
                <span>
                  {displayName(u)} <span className="muted">@{u.username}</span>
                </span>
              </label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
