import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_PAGE_SIZES,
  createAdminUserSchema,
  manageableRoles,
  updateAdminUserSchema,
  type AdminUser,
  type AdminUserSortField,
  type AdminUsersPage,
  type Role,
  type SessionUser,
  type UpdateAdminUserInput,
} from "@pm/shared";
import { api } from "../api";
import { navigate } from "../lib/router";
import { displayName } from "../lib/users";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

const ROLE_LABELS: Record<Role, string> = { user: "User", admin: "Admin", superadmin: "Superadmin" };

const SEARCH_DELAY_MS = 250;

type Order = "asc" | "desc";

/** Sortable columns; `firstOrder` is the direction a column sorts in when first clicked. */
const COLUMNS: { field: AdminUserSortField; label: string; firstOrder: Order }[] = [
  { field: "username", label: "Username", firstOrder: "asc" },
  { field: "name", label: "Name", firstOrder: "asc" },
  { field: "role", label: "Role", firstOrder: "desc" },
  { field: "createdAt", label: "Created", firstOrder: "desc" },
];

/**
 * /admin, for admins and superadmins: the accounts whose role is below one's own
 * (a superadmin sees admins and users, an admin sees users), with creating and editing them.
 * The server enforces the same rules.
 */
export function AdminPage({ me }: { me: SessionUser }) {
  const roles = manageableRoles(me.role);
  const [query, setQuery] = useState("");
  /** `query` once typing pauses; this is what's searched for. */
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ field: AdminUserSortField; order: Order }>({ field: "username", order: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(ADMIN_DEFAULT_PAGE_SIZE);
  const [result, setResult] = useState<AdminUsersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  /** Bumped to load the current page again (after creating or editing someone). */
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .adminListUsers({ q: search, page, pageSize, sort: sort.field, order: sort.order })
      .then((res) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(res.total / res.pageSize));
        // The page emptied (e.g. someone was moved out of view): go to the last one that has accounts.
        if (res.users.length === 0 && page > lastPage) {
          setPage(lastPage);
          return;
        }
        setResult(res);
        setError(null);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, page, pageSize, sort, reloads]);

  const onSort = (column: (typeof COLUMNS)[number]) => {
    setSort((s) =>
      s.field === column.field
        ? { field: s.field, order: s.order === "asc" ? "desc" : "asc" }
        : { field: column.field, order: column.firstOrder },
    );
    setPage(1);
  };

  const users = result?.users ?? null;
  const lastPage = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <section className="profile-page admin-page">
      <header className="room-header admin-header">
        <button type="button" className="secondary" onClick={() => navigate("/")}>
          ← Back to chats
        </button>
        <h2>Administration</h2>
      </header>
      <div className="admin-content">
        <p className="muted">
          You're signed in as <strong>{ROLE_LABELS[me.role].toLowerCase()}</strong>. You can see, create and edit{" "}
          {roles.map((r) => `${ROLE_LABELS[r].toLowerCase()}s`).join(" and ")}.
        </p>
        <div className="admin-toolbar">
          <input
            type="search"
            placeholder="Search by username or name"
            aria-label="Search users"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" onClick={() => setCreating(true)}>
            + New user
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {users === null ? (
          !error && <p className="muted">Loading…</p>
        ) : (
          <>
            <div className={`admin-table-wrap ${loading ? "loading" : ""}`}>
              <table className="admin-table">
                <thead>
                  <tr>
                    {COLUMNS.map((column) => {
                      const active = sort.field === column.field;
                      const Arrow = !active ? ArrowUpDown : sort.order === "asc" ? ArrowUp : ArrowDown;
                      return (
                        <th
                          key={column.field}
                          aria-sort={active ? (sort.order === "asc" ? "ascending" : "descending") : "none"}
                        >
                          <button
                            type="button"
                            className={`sort-button ${active ? "active" : ""}`}
                            onClick={() => onSort(column)}
                          >
                            {column.label}
                            <Arrow size={14} aria-hidden="true" />
                          </button>
                        </th>
                      );
                    })}
                    <th>Created by</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length + 2} className="muted admin-empty">
                        {search ? "Nobody matches." : "No accounts yet."}
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <span className="admin-user">
                            <Avatar user={user} size={32} />@{user.username}
                          </span>
                        </td>
                        <td>{user.name ?? <span className="muted">—</span>}</td>
                        <td>
                          <span className={`role-badge role-${user.role}`}>{ROLE_LABELS[user.role]}</span>
                        </td>
                        <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                        <td>
                          {user.createdBy ? (
                            displayName(user.createdBy)
                          ) : (
                            <span className="muted">signed up</span>
                          )}
                        </td>
                        <td className="admin-actions">
                          <button type="button" className="secondary" onClick={() => setEditing(user)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              lastPage={lastPage}
              pageSize={pageSize}
              total={result!.total}
              shown={users.length}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </div>

      {creating && (
        <CreateUserModal
          roles={roles}
          onClose={() => setCreating(false)}
          onCreated={() => {
            reload();
            setCreating(false);
          }}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            reload();
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function Pagination({
  page,
  lastPage,
  pageSize,
  total,
  shown,
  onPage,
  onPageSize,
}: {
  page: number;
  lastPage: number;
  pageSize: number;
  total: number;
  shown: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const from = shown === 0 ? 0 : (page - 1) * pageSize + 1;
  return (
    <div className="admin-pagination">
      <span className="muted small">
        {total === 0 ? "0 accounts" : `${from}–${from + shown - 1} of ${total}`}
      </span>
      <label className="admin-page-size">
        Per page
        <select className="admin-select" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {ADMIN_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <div className="admin-pager">
        <button
          type="button"
          className="ghost icon"
          aria-label="Previous page"
          title="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="small">
          Page {page} of {lastPage}
        </span>
        <button
          type="button"
          className="ghost icon"
          aria-label="Next page"
          title="Next page"
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function RoleSelect({ roles, value, onChange }: { roles: Role[]; value: Role; onChange: (role: Role) => void }) {
  return (
    <label>
      Role
      <select className="admin-select" value={value} onChange={(e) => onChange(e.target.value as Role)}>
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

function CreateUserModal({
  roles,
  onClose,
  onCreated,
}: {
  roles: Role[];
  onClose: () => void;
  onCreated: (user: AdminUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(roles[0]!);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createAdminUserSchema.safeParse({ username, password, name: name.trim() || undefined, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      onCreated(await api.adminCreateUser(parsed.data));
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title="New user" onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
        <label>
          Username
          <input autoFocus autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Name <span className="muted small">(optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {roles.length > 1 && <RoleSelect roles={roles} value={role} onChange={setRole} />}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "…" : `Create ${ROLE_LABELS[role].toLowerCase()}`}
        </button>
      </form>
    </Modal>
  );
}

function EditUserModal({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  roles: Role[];
  onClose: () => void;
  onSaved: (user: AdminUser) => void;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState<Role>(user.role);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const changes: UpdateAdminUserInput = {
    ...(name.trim() !== (user.name ?? "") && { name: name.trim() || null }),
    ...(role !== user.role && { role }),
    ...(password !== "" && { password }),
  };
  const changed = Object.keys(changes).length > 0;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = updateAdminUserSchema.safeParse(changes);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      onSaved(await api.adminUpdateUser(user.id, parsed.data));
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Edit @${user.username}`} onClose={onClose}>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Not set" />
        </label>
        {roles.length > 1 && <RoleSelect roles={roles} value={role} onChange={setRole} />}
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Leave empty to keep the current one"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="muted small">Setting a new password signs them out on all devices.</span>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting || !changed}>
          {submitting ? "…" : "Save"}
        </button>
      </form>
    </Modal>
  );
}
