import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  if (userError || !user?.email) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const body = (await req.json()) as ProvisionBody;
  const ownerEmail = body.ownerEmail?.trim().toLowerCase();
  const name = body.name?.trim();

  if (!name || !ownerEmail) {
    return NextResponse.json({ error: 'Business name and owner email are required.' }, { status: 400 });
  }

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

  const { data: provData, error: provError } = await userClient.rpc('platform_provision_business', {
    p_name: name,
    p_industry: body.industry?.trim() || 'General Business',
    p_owner_email: ownerEmail,
    p_kra_pin: body.kraPin?.trim() || null,
    p_currency: body.currency?.trim() || 'KES',
    p_plan: body.plan || 'ESSENTIAL',
    p_transport_addon: normalizedModules.includes('TRANSPORT')
  });

  if (provError) {
    return NextResponse.json({ error: provError.message }, { status: 400 });
  }

  let modulesNote: string | null = null;
  if (provData?.org_id && normalizedModules.length > 0) {
    const { error: modError } = await userClient.rpc('platform_set_org_modules', {
      p_org_id: provData.org_id,
      p_modules: normalizedModules
    });
    if (modError) {
      modulesNote = modError.message;
    }
  }

  let inviteEmailSent = false;
  let inviteNote: string | null = null;

  if (provData?.status !== 'LINKED_EXISTING_USER') {
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const origin = req.nextUrl.origin;
    const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(ownerEmail, {
      redirectTo: `${origin}/set-password`
    });

    if (inviteErr) {
      inviteNote = inviteErr.message;
    } else {
      inviteEmailSent = true;
    }
  }

  return NextResponse.json({
    provision: provData,
    enabledModules: normalizedModules,
    modulesNote,
    inviteEmailSent,
    inviteNote
  });
}