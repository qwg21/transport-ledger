import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type InviteBody = {
  orgId?: string;
  email?: string;
  role?: 'admin' | 'staff' | 'viewer';
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

  if (userError || !user) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  const body = (await req.json()) as InviteBody;
  const orgId = body.orgId;
  const email = body.email?.trim().toLowerCase();
  const role = body.role;

  if (!orgId || !email || !role || !['admin', 'staff', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'Invalid invite details.' }, { status: 400 });
  }

  // Uses userClient so PostgreSQL RLS enforces INTELLIGENCE+ and OWNER/ADMIN role
  const { error: insertErr } = await userClient.from('organization_invites').insert({
    org_id: orgId,
    email,
    role
  });

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const origin = req.nextUrl.origin;
  const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/set-password`
  });

  if (inviteErr) {
    return NextResponse.json({
      invited: true,
      emailSent: false,
      note: inviteErr.message
    });
  }

  return NextResponse.json({ invited: true, emailSent: true });
}