/**
 * Pack roles in a team workspace (docs/PACKS.md, Roles): owners and admins
 * give each member a role in the pack. A role that does not see some fields
 * is marked restricted on the server, which then keeps those fields (they
 * travel in each item's hidden document) off that member's devices.
 */
import { useEffect, useState } from "react";
import { accountApi, type Member, type PackRole } from "../../account/api";
import { useAccount } from "../../account/store";
import { errorMessage } from "../../lib/api";
import { useStore } from "../../state/store";
import { Select } from "../../ui/Select";
import type { PackDef } from "../definition";
import { isRestricted } from "../hidden";

export function PackRoles({ pack }: { pack: PackDef }) {
  const view = useAccount((s) => s.view);
  const ws = view?.workspaces.find((w) => w.id === view.activeWorkspaceId) ?? null;
  const manage = ws?.role === "owner" || ws?.role === "admin";
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<PackRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ws) return;
    let alive = true;
    Promise.all([manage ? accountApi.members(ws.id) : Promise.resolve({ members: [] as Member[], offline: false }), accountApi.packRoles(ws.id)])
      .then(([m, r]) => {
        if (!alive) return;
        setMembers(m.members);
        setRoles(r.filter((x) => x.packId === pack.id));
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [ws?.id, manage, pack.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ws || pack.roles.length < 2) return null;
  const roleOf = (userId: string) => roles.find((r) => r.userId === userId)?.roleId ?? "";
  const labelOf = (id: string) => pack.roles.find((r) => r.id === id)?.label ?? id;

  if (!manage) {
    const mine = roles[0];
    return mine ? (
      <div className="set-row">
        <div className="set-row-text">
          <div className="set-row-label">Your role in this pack</div>
          <div className="set-row-hint">{labelOf(mine.roleId)}</div>
        </div>
      </div>
    ) : null;
  }

  const set = async (userId: string, roleId: string) => {
    const role = pack.roles.find((r) => r.id === roleId) ?? null;
    try {
      await accountApi.setPackRole(ws.id, userId, pack.id, role?.id ?? null, role ? isRestricted(role) : false);
      setRoles((list) => [...list.filter((r) => r.userId !== userId), ...(role ? [{ userId, packId: pack.id, roleId: role.id, restricted: isRestricted(role) }] : [])]);
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };

  return (
    <>
      <div className="set-row">
        <div className="set-row-text">
          <div className="set-row-label">Roles in this pack</div>
          <div className="set-row-hint">Owners and admins see everything. A role that does not see some fields never receives them on its devices.</div>
        </div>
      </div>
      {error && <p className="set-note">{error}</p>}
      {members
        .filter((m) => m.role !== "owner" && m.role !== "admin")
        .map((m) => (
          <div key={m.userId} className="set-row">
            <div className="set-row-text">
              <div className="set-row-label bidi">{m.displayName || m.email || m.userId}</div>
            </div>
            <Select
              value={roleOf(m.userId)}
              label={m.displayName}
              options={[{ value: "", label: "No role" }, ...pack.roles.map((r) => ({ value: r.id, label: r.label }))]}
              onChange={(v) => void set(m.userId, v)}
            />
          </div>
        ))}
    </>
  );
}
