-- An expected stale edit is an HTTP conflict, not a transaction serialization
-- failure. Keep gateways from treating it as a transient database failure.
do $$
declare
  signature regprocedure;
  definition text;
begin
  foreach signature in array array[
    'public.site_admin_save_school(text,uuid,integer,boolean)'::regprocedure,
    'public.site_admin_set_manager(uuid,uuid,integer,boolean)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    if strpos(definition, 'errcode = ''40001''') = 0 then
      raise exception 'Unexpected school mutation definition';
    end if;
    execute replace(definition, 'errcode = ''40001''', 'errcode = ''PT409''');
  end loop;
end;
$$;
