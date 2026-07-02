    .order('branch', { ascending: true })
    .order('staff_name_normalized', { ascending: true });

  if (listError) return jsonNoCache({ ok: false, error: listError.message }, 500);

  return jsonNoCache({
    ok: true,
    cycle,
    week_start: weekStart,
    branches: BRANCHES,
    orders: data || [],
    can_manage: canManageStaffMeal(user),
    menu_set: menuSetForWeek(weekStart),
    menu: menus[menuSetForWeek(weekStart)],
    menus,
  });
}

export async function POST(req: NextRequest) {
  await cleanupOldOrders();

  const cycle = staffMealCycle();
  const body = await req.json().catch(() => ({}));
  const branch = normalizeBranch(body?.branch);
  const staffName = normalizeName(body?.staff_name);
  const staffNameNormalized = normalizeNameKey(staffName);
  const meals = normalizeMeals(body?.meals);
  const totals = countMeals(meals);

  if (!branch) return jsonNoCache({ ok: false, error: 'Please select a valid branch.' }, 400);
  if (!staffName || staffName.length < 2) return jsonNoCache({ ok: false, error: 'Please enter your name.' }, 400);
  if (totals.lunch + totals.dinner <= 0) {
    return jsonNoCache({ ok: false, error: 'Please select at least one lunch or dinner.' }, 400);
  }

  const payload = {
    order_week_start: cycle.order_week_start,
    order_week_end: cycle.order_week_end,
    branch,
    staff_name: staffName,
    staff_name_normalized: staffNameNormalized,
    meals,
    notes: normalizeName(body?.notes || ''),
  };

  const { data, error } = await supabaseAdmin
    .from('staff_meal_orders')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return jsonNoCache({
        ok: false,
        error: `${staffName} has already submitted a staff meal order for ${branch} for this order week.`,
      }, 409);
    }
    return jsonNoCache({ ok: false, error: error.message }, 500);
  }

  return jsonNoCache({ ok: true, cycle, order: data, totals });
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  if (body?.action === 'save_menu') {
    if (!canViewStaffMeal(user)) return jsonNoCache({ ok: false, error: 'Access denied.' }, 403);

    const setName: MenuSetName = body?.set_name === 'B' ? 'B' : 'A';
    const rows = normalizeMenuPayload(body?.menu).map((row) => ({
      set_name: setName,
      day_index: row.day_index,
      menu_text: row.menu_text,
      updated_at: new Date().toISOString(),
      updated_by_name: user.name,
      updated_by_email: user.email,
    }));

    const { error: menuError } = await supabaseAdmin
      .from('staff_meal_weekly_menus')
      .upsert(rows, { onConflict: 'set_name,day_index' });

    if (menuError) return jsonNoCache({ ok: false, error: menuError.message }, 500);

    const menus = await loadStaffMealMenus();
    return jsonNoCache({ ok: true, menus });
  }

  if (!canManageStaffMeal(user)) return jsonNoCache({ ok: false, error: 'Only superusers can edit staff meal orders.' }, 403);

  const id = normalizeName(body?.id);
  const branch = normalizeBranch(body?.branch);
  const staffName = normalizeName(body?.staff_name);
  const meals = normalizeMeals(body?.meals);
  const totals = countMeals(meals);

  if (!id) return jsonNoCache({ ok: false, error: 'Missing order id.' }, 400);
  if (!branch) return jsonNoCache({ ok: false, error: 'Please select a valid branch.' }, 400);
  if (!staffName || staffName.length < 2) return jsonNoCache({ ok: false, error: 'Please enter staff name.' }, 400);
  if (totals.lunch + totals.dinner <= 0) return jsonNoCache({ ok: false, error: 'Please select at least one meal.' }, 400);

  const { data, error: updateError } = await supabaseAdmin
    .from('staff_meal_orders')
    .update({
      branch,
      staff_name: staffName,
      staff_name_normalized: normalizeNameKey(staffName),
      meals,
      notes: normalizeName(body?.notes || ''),
      updated_at: new Date().toISOString(),
      updated_by_name: user.name,
      updated_by_email: user.email,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updateError) {
    if (updateError.code === '23505') {
      return jsonNoCache({ ok: false, error: 'Another order already exists for this name and branch.' }, 409);
    }
    return jsonNoCache({ ok: false, error: updateError.message }, 500);
  }

  return jsonNoCache({ ok: true, order: data });
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);
  if (!canManageStaffMeal(user)) return jsonNoCache({ ok: false, error: 'Only superusers can delete staff meal orders.' }, 403);

  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return jsonNoCache({ ok: false, error: 'Missing order id.' }, 400);

  const { error: deleteError } = await supabaseAdmin
    .from('staff_meal_orders')
    .delete()
    .eq('id', id);

  if (deleteError) return jsonNoCache({ ok: false, error: deleteError.message }, 500);
  return jsonNoCache({ ok: true });
}
