-- Vio Studio v2.0: independent accessory rotation.
-- Existing accessories keep their current appearance (zero-degree rotation).
alter table public.vio_character_accessories
  add column if not exists rotation double precision not null default 0
  check (rotation >= -180 and rotation <= 180);

comment on column public.vio_character_accessories.rotation is
  'Per-accessory rotation in degrees, independent of avatar and other accessories.';
