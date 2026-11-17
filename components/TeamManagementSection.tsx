'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Users, UserPlus, Trash2, Mail, ShieldCheck } from 'lucide-react';

type TeamMember = {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
};

type PendingInvite = {
  id: string;
  email: string;
  role: string;
  created_at: string;
};

type Props = {
  orgId: string;
  userRole: string;
  currentUserId?: string;
  isIntelligencePlus: boolean;
  isReadOnly?: boolean;
};

const INVITE_ROLES = [
  { value: 'admin', label: 'Admin — Full access & team management' },
  { value: 'staff', label: 'Staff — Create invoices, receipts & expenses' },
  { value: 'viewer', label: 'Viewer — Read-only reports & documents' }
] as const;

export default function TeamManagementSection({
  orgId,
  userRole,
  currentUserId,
  isIntelligencePlus,
  isReadOnly = false
}: Props) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'staff' | 'viewer'>('staff');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const canManage =
    isIntelligencePlus &&
    !isReadOnly &&
    ['owner', 'admin'].includes((userRole || '').toLowerCase());

  const loadTeam = useCallback(async () => {
    const [teamRes, invRes] = await Promise.all([
      supabase.rpc('list_org_team', { p_org_id: orgId }),
      supabase
        .from('organization_invites')
        .select('id, email, role, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
    ]);

    if (!teamRes.error) {
      setMembers((teamRes.data as TeamMember[] | null) ?? []);
    }
    if (!invRes.error) {
      setInvites((invRes.data as PendingInvite[] | null) ?? []);
    }
  }, [orgId]);

  useEffect(() => {
    let active = true;
    async function init() {
      const [teamRes, invRes] = await Promise.all([
        supabase.rpc('list_org_team', { p_org_id: orgId }),
        supabase
          .from('organization_invites')
          .select('id, email, role, created_at')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
      ]);
      if (!active) return;
      if (!teamRes.error) setMembers((teamRes.data as TeamMember[] | null) ?? []);
      if (!invRes.error) setInvites((invRes.data as PendingInvite[] | null) ?? []);
    }
    init();
    return () => {
      active = false;
    };
  }, [orgId]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail) return;

    if (members.some(m => m.email.toLowerCase() === normalizedEmail)) {
      setErrorMsg('That user is already a member of this business.');
      return;
    }
    if (invites.some(i => i.email.toLowerCase() === normalizedEmail)) {
      setErrorMsg('An invite is already pending for that email.');
      return;
    }

    setIsBusy(true);
    try {
      const { error } = await supabase.from('organization_invites').insert({
        org_id: orgId,
        email: normalizedEmail,
        role: inviteRole
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setInviteEmail('');
      setStatusMsg(
        `Invite queued for ${normalizedEmail}. They will automatically join when they sign in or sign up with that email.`
      );
      await loadTeam();
    } finally {
      setIsBusy(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    const { error } = await supabase.from('organization_invites').delete().eq('id', inviteId);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await loadTeam();
  };

  const handleRoleChange = async (targetUserId: string, newRole: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    const { error } = await supabase.rpc('update_org_member_role', {
      p_org_id: orgId,
      p_target_user_id: targetUserId,
      p_new_role: newRole
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setStatusMsg('Member role updated.');
    await loadTeam();
  };

  const handleRemoveMember = async (targetUserId: string, email: string) => {
    if (!confirm(`Remove ${email} from this business?`)) return;
    setErrorMsg(null);
    setStatusMsg(null);
    const { error } = await supabase.rpc('remove_org_member', {
      p_org_id: orgId,
      p_target_user_id: targetUserId
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setStatusMsg(`${email} removed from workspace.`);
    await loadTeam();
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            Team & Role Access
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Invite accountants, clerks, or managers to collaborate on this workspace.
          </p>
        </div>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 uppercase">
          Your role: {userRole}
        </span>
      </div>

      {!isIntelligencePlus && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          Multi-user team invites and role controls require the <strong>INTELLIGENCE</strong> plan.
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
          {statusMsg}
        </div>
      )}

      {canManage && (
        <form onSubmit={handleSendInvite} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <input
            type="email"
            required
            placeholder="teammate@company.co.ke"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            className="sm:col-span-6 border border-slate-300 rounded-xl px-3 py-2 text-sm"
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value as 'admin' | 'staff' | 'viewer')}
            className="sm:col-span-4 border border-slate-300 rounded-xl px-2.5 py-2 text-xs bg-white"
          >
            {INVITE_ROLES.map(r => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isBusy}
            className="sm:col-span-2 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Invite
          </button>
        </form>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Active Members ({members.length})
        </p>
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {members.map(member => {
            const isOwner = member.role.toLowerCase() === 'owner';
            const isSelf = currentUserId === member.user_id;
            return (
              <div
                key={member.user_id}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate">
                    {member.email || 'Unknown user'}
                    {isSelf && <span className="ml-1.5 text-[11px] text-slate-400">(You)</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isOwner || !canManage || isSelf ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 uppercase">
                      {isOwner && <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />}
                      {member.role}
                    </span>
                  ) : (
                    <>
                      <select
                        value={member.role.toLowerCase()}
                        onChange={e => handleRoleChange(member.user_id, e.target.value)}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white uppercase font-medium"
                      >
                        <option value="admin">ADMIN</option>
                        <option value="staff">STAFF</option>
                        <option value="viewer">VIEWER</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(member.user_id, member.email)}
                        title="Remove member"
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {members.length === 0 && (
            <p className="px-3.5 py-3 text-xs text-slate-400">No members found.</p>
          )}
        </div>
      </div>

      {invites.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Pending Invites ({invites.length})
          </p>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
            {invites.map(inv => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-slate-700 truncate">{inv.email}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 uppercase">
                    {inv.role}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(inv.id)}
                      title="Revoke invite"
                      className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}