import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPER_ADMIN_EMAIL = 'quentinwg2015@gmail.com';
const VALID_MODULES = new Set([
  'TRANSPORT',
  'RENTALS',
  'MANUFACTURING',
  'WAREHOUSE',
  'PAYROLL',
  'PROCUREMENT',
  'CRM'
]);

type ProvisionBody = {
  name?: string;
  industry?: string;
  ownerEmail?: string;
  kraPin?: string | null;
  currency?: string;
  plan?: string;
  transportAddon?: boolean;
  enabledModules?: string[];
};

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server configuration missing.' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Missing authorization token.' }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  const callerEmail = user?.email?.toLowerCase();
  if (userError || !callerEmail) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Verify caller is either the owner or an active Sales/Super Admin in platform_admins
  let adminRole: 'SUPER_ADMIN' | 'SALES_ADMIN' | null =
    callerEmail === SUPER_ADMIN_EMAIL ? 'SUPER_ADMIN' : null;

  if (!adminRole) {
    const { data: paRow } = await adminClient
      .from('platform_admins')
      .select('role, is_active')
      .eq('email', callerEmail)
      .maybeSingle();

    if (paRow?.is_active && (paRow.role === 'SUPER_ADMIN' || paRow.role === 'SALES_ADMIN')) {
      adminRole = paRow.role;
    }
  }

  if (!adminRole) {
    return NextResponse.json({ error: 'Platform admin access required.' }, { status: 403 });
  }

  const body = (await req.json()) as ProvisionBody;
  const ownerEmail = body.ownerEmail?.trim().toLowerCase();
  const name = body.name?.trim();

  if (!name || !ownerEmail) {
    return NextResponse.json({ error: 'Business name and owner email are required.' }, { status: 400 });
  }

  // Sales admins onboard new clients onto TRIAL by default unless Super Admin overrides
  const targetPlan = body.plan || 'STARTER';
  const normalizedModules = Array.from(
    new Set(
      (Array.isArray(body.enabledModules) ? body.enabledModules : [])
        .map(m => String(m).trim().toUpperCase())
        .filter(m => VALID_MODULES.has(m))
    )
  );
  if (body.transportAddon && !normalizedModules.includes('TRANSPORT')) {
    normalizedModules.push('TRANSPORT');
  }

  // Check if owner already has a Supabase auth account
  const { data: existingUsers } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === ownerEmail);

  // Create organization stamped with onboarded_by_email
  const { data: orgRow, error: orgErr } = await adminClient
    .from('organizations')
    .insert({
      name,
      industry: body.industry?.trim() || 'General Business',
      kra_pin: body.kraPin?.trim() || null,
      currency: body.currency?.trim() || 'KES',
      onboarded_by_email: callerEmail
    })
    .select('id')
    .single();

  if (orgErr || !orgRow) {
    return NextResponse.json({ error: orgErr?.message || 'Failed to create organization.' }, { status: 400 });
  }

  // Create subscription (14-day TRIAL for Sales Admin onboardings, ACTIVE for Super Admin)
  const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { error: subErr } = await adminClient.from('subscriptions').insert({
    org_id: orgRow.id,
    plan: targetPlan,
    status: adminRole === 'SALES_ADMIN' ? 'TRIAL' : 'ACTIVE',
    transport_addon: normalizedModules.includes('TRANSPORT'),
    enabled_modules: normalizedModules,
    current_period_end: trialEnd
  });

  if (subErr) {
    return NextResponse.json({ error: subErr.message }, { status: 400 });
  }

  let inviteEmailSent = false;
  let inviteNote: string | null = null;
  let provisionStatus = 'INVITED_NEW_USER';

  if (existingUser) {
    provisionStatus = 'LINKED_EXISTING_USER';
    await adminClient.from('memberships').upsert(
      {
        org_id: orgRow.id,
        user_id: existingUser.id,
        role: 'owner'
      },
      { onConflict: 'org_id,user_id' }
    );
  } else {
    const origin = req.nextUrl.origin;
    const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      ownerEmail,
      { redirectTo: `${origin}/set-password` }
    );
    if (inviteErr) {
      inviteNote = inviteErr.message;
    } else {
      inviteEmailSent = true;
      if (invited?.user?.id) {
        await adminClient.from('memberships').upsert(
          {
            org_id: orgRow.id,
            user_id: invited.user.id,
            role: 'owner'
          },
          { onConflict: 'org_id,user_id' }
        );
      }
    }
  }

  return NextResponse.json({
    provision: { org_id: orgRow.id, status: provisionStatus },
    enabledModules: normalizedModules,
    inviteEmailSent,
    inviteNote
  });
}