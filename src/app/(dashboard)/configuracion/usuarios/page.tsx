"use client";

/**
 * D2 §4.2 — `/configuracion/usuarios`
 *
 * Operator-facing roster of org members:
 *   - Table of Clerk memberships (read via `useOrganization({memberships})`).
 *   - Click a row → drawer showing assigned clients + assign / unassign.
 *   - "Invitar usuario" modal POSTs to `/api/clerk/invite-user`.
 *
 * Auth gate: `org:admin` only. Members are redirected back to
 * `/configuracion` (mirrors the Resend page pattern).
 *
 * OrganizationSwitcher race (spec §7): when the active org changes mid-
 * session the drawer + invite modal are auto-closed and selection state
 * is reset so the user never sees stale data from the previous org.
 */

import Link from "next/link";
import {
  Users,
  ChevronLeft,
  Plus,
  X,
  Mail,
  UserCheck,
  Loader2,
} from "lucide-react";
import { useOrganization } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

type Row = {
  membershipId: string;
  userId: string | undefined;
  name: string;
  email: string;
  role: string;
  assignedClientCount: number;
};

/** Map a Clerk userId → display name, or `null` when no longer a member. */
type UserNameLookup = (userId: string) => string | null;

export default function UsuariosPage() {
  const { organization, membership, memberships, isLoaded } = useOrganization({
    memberships: { infinite: true, pageSize: 50 },
  });
  const router = useRouter();
  const isAdmin = membership?.role === "org:admin";

  useEffect(() => {
    if (isLoaded && !isAdmin) {
      router.replace("/configuracion");
    }
  }, [isLoaded, isAdmin, router]);

  // Spec §7 — OrganizationSwitcher race: drop selection + close dialogs
  // whenever the active org changes.
  const orgIdKey = organization?.id;
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  useEffect(() => {
    setSelectedUserId(null);
    setInviteOpen(false);
  }, [orgIdKey]);

  const assignments = useQuery(
    api.functions.users.queries.listAssignmentsForOrg,
    isLoaded && isAdmin ? {} : "skip"
  );
  const allClients = useQuery(
    api.functions.clients.queries.list,
    isLoaded && isAdmin ? {} : "skip"
  );

  const rows: Row[] = useMemo(() => {
    if (!memberships?.data) return [];
    return memberships.data.map((m) => {
      const userId = m.publicUserData?.userId;
      const count = assignments?.find((a) => a.userId === userId)
        ?.assignedClientCount ?? 0;
      const firstName = m.publicUserData?.firstName ?? "";
      const lastName = m.publicUserData?.lastName ?? "";
      const name = `${firstName} ${lastName}`.trim();
      return {
        membershipId: m.id,
        userId,
        name: name || "—",
        email: m.publicUserData?.identifier ?? "—",
        role: m.role,
        assignedClientCount: count,
      };
    });
  }, [memberships?.data, assignments]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.userId === selectedUserId) ?? null,
    [rows, selectedUserId]
  );

  // Lookup used by the drawer to label cross-assigned clients with the
  // current assignee's name (spec §4.2 — prevent silent reassignment).
  const lookupUserName: UserNameLookup = useCallback(
    (userId) => {
      const m = memberships?.data?.find(
        (mem) => mem.publicUserData?.userId === userId
      );
      if (!m) return null;
      const firstName = m.publicUserData?.firstName ?? "";
      const lastName = m.publicUserData?.lastName ?? "";
      const name = `${firstName} ${lastName}`.trim();
      return name || m.publicUserData?.identifier || userId;
    },
    [memberships?.data]
  );

  if (!isLoaded || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <Link
        href="/configuracion"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ChevronLeft size={16} aria-hidden="true" /> Configuración
      </Link>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="text-accent" size={28} aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold">Usuarios</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Ejecutivos de tu organización y los clientes que tienen
              asignados.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          data-testid="invite-user-btn"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors"
        >
          <Plus size={16} aria-hidden="true" />
          Invitar usuario
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {memberships === undefined || memberships?.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 w-full animate-pulse rounded bg-secondary"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No hay usuarios todavía. Invita al primero.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Nombre
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Email
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Rol
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Clientes
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.membershipId}
                  onClick={() => r.userId && setSelectedUserId(r.userId)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/30 transition-colors"
                  data-testid={`user-row-${r.userId ?? "unknown"}`}
                >
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                      {r.role.replace("org:", "")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {r.assignedClientCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedRow && (
        <UserDetailDrawer
          row={selectedRow}
          onClose={() => setSelectedUserId(null)}
          allClients={allClients ?? []}
          lookupUserName={lookupUserName}
        />
      )}

      {inviteOpen && (
        <InviteUserDialog onClose={() => setInviteOpen(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Drawer — assigned clients for a single user                       */
/* ------------------------------------------------------------------ */

function UserDetailDrawer({
  row,
  onClose,
  allClients,
  lookupUserName,
}: {
  row: Row;
  onClose: () => void;
  allClients: Array<{ _id: Id<"clients">; name: string; assignedTo?: string }>;
  lookupUserName: UserNameLookup;
}) {
  const userId = row.userId;
  const assigned = useQuery(
    api.functions.users.queries.listAssignedClients,
    userId ? { userId } : "skip"
  );
  const assignToClient = useMutation(
    api.functions.users.mutations.assignToClient
  );
  const unassign = useMutation(api.functions.users.mutations.unassign);

  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const assignedIds = new Set(assigned?.map((c) => c._id) ?? []);
  // Spec §4.2 — include cross-assigned clients so the operator can see the
  // current assignee instead of silently overwriting them. Filter out only
  // the clients that already belong to this user.
  const assignableClients = allClients.filter((c) => !assignedIds.has(c._id));

  const handleAssign = async (clientId: Id<"clients">) => {
    if (!userId) return;
    setMutating(true);
    setError(null);
    try {
      await assignToClient({ clientId, userId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al asignar.");
    } finally {
      setMutating(false);
    }
  };

  const handleUnassign = async (clientId: Id<"clients">) => {
    setMutating(true);
    setError(null);
    try {
      await unassign({ clientId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al desasignar.");
    } finally {
      setMutating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-drawer-heading"
      onClick={onClose}
    >
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
      />
      <aside
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="user-drawer-heading" className="text-lg font-semibold">
            {row.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 hover:bg-secondary"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-mono text-xs">{row.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Rol</dt>
            <dd>{row.role}</dd>
          </div>
        </dl>

        {error && (
          <div
            className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
            role="alert"
          >
            {error}
          </div>
        )}

        <section className="mt-6 space-y-2" aria-labelledby="assigned-clients-heading">
          <h3
            id="assigned-clients-heading"
            className="text-sm font-medium text-muted-foreground"
          >
            Clientes asignados ({assigned?.length ?? 0})
          </h3>
          {assigned === undefined ? (
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground"
              aria-label="Cargando asignaciones"
            />
          ) : assigned.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sin clientes asignados.
            </p>
          ) : (
            <ul className="space-y-1">
              {assigned.map((c) => (
                <li
                  key={c._id}
                  className="flex items-center justify-between rounded border border-border bg-secondary/30 px-3 py-2 text-sm"
                >
                  <span>{c.name}</span>
                  <button
                    type="button"
                    onClick={() => handleUnassign(c._id)}
                    disabled={mutating}
                    data-testid={`unassign-${c._id}`}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    Desasignar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 space-y-2" aria-labelledby="assignable-clients-heading">
          <h3
            id="assignable-clients-heading"
            className="text-sm font-medium text-muted-foreground"
          >
            Asignar nuevo cliente
          </h3>
          {assignableClients.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay clientes disponibles para asignar.
            </p>
          ) : (
            <>
              <p
                className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
                role="note"
              >
                Reasignar moverá al cliente entre ejecutivos.
              </p>
              <select
                aria-label="Seleccionar cliente para asignar"
                disabled={mutating || !userId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  handleAssign(val as Id<"clients">);
                  e.currentTarget.value = "";
                }}
                defaultValue=""
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="" disabled>
                  Seleccionar cliente…
                </option>
                {assignableClients.map((c) => {
                  // When assigned to someone OTHER than the currently-
                  // selected user, surface that so the operator never
                  // overwrites an assignment silently.
                  const otherAssignee =
                    c.assignedTo && c.assignedTo !== userId
                      ? c.assignedTo
                      : null;
                  const currentName = otherAssignee
                    ? lookupUserName(otherAssignee)
                    : null;
                  const suffix = otherAssignee
                    ? currentName
                      ? ` — actualmente: ${currentName}`
                      : " — ya no es miembro"
                    : "";
                  return (
                    <option key={c._id} value={c._id}>
                      {c.name}
                      {suffix}
                    </option>
                  );
                })}
              </select>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Invite dialog — POST /api/clerk/invite-user                        */
/* ------------------------------------------------------------------ */

function InviteUserDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"org:admin" | "org:member">("org:member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Email inválido.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/clerk/invite-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Error al enviar la invitación.");
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      setEmail("");
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-dialog-heading"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
      <div
        className="relative w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2
            id="invite-dialog-heading"
            className="text-lg font-semibold flex items-center gap-2"
          >
            <UserCheck size={18} className="text-accent" aria-hidden="true" />
            Invitar usuario
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar"
            className="rounded p-1 hover:bg-secondary"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="invite-email"
              className="mb-1.5 block text-sm font-medium text-muted-foreground"
            >
              Email
            </label>
            <div className="relative">
              <Mail
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejecutivo@empresa.mx"
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 pl-9 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="invite-role"
              className="mb-1.5 block text-sm font-medium text-muted-foreground"
            >
              Rol
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "org:admin" | "org:member")
              }
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="org:member">Miembro (org:member)</option>
              <option value="org:admin">Administrador (org:admin)</option>
            </select>
          </div>

          {error && (
            <div
              className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
              role="alert"
            >
              {error}
            </div>
          )}
          {success && (
            <div
              className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400"
              role="status"
            >
              Invitación enviada.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-testid="invite-submit-btn"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting && (
                <Loader2
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              )}
              Enviar invitación
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
