-- Room layout overrides are writable only by the authenticated owner of the
-- matching room membership. Edge Function writes independently enforce the
-- same identity using requireUser(); this policy also protects direct clients.
alter table public.vio_room_overrides enable row level security;
drop policy if exists vio_overrides_write_self on public.vio_room_overrides;
create policy vio_overrides_write_self on public.vio_room_overrides
  for all to authenticated
  using (
    user_id = vio_private.vio_current_app_user_id()
    and vio_private.vio_is_room_member(room_id)
  )
  with check (
    user_id = vio_private.vio_current_app_user_id()
    and vio_private.vio_is_room_member(room_id)
  );
