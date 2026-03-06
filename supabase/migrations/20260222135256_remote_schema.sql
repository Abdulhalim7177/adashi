drop extension if exists "pg_net";

drop policy "Admins can manage all scheme members" on "public"."scheme_members";

drop policy "Users can manage their own schemes and admins can manage all" on "public"."schemes";

alter table "public"."schemes" disable row level security;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, role, phone_number, home_address, alt_phone_number)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url',
    COALESCE((new.raw_user_meta_data->>'role')::public.user_role, 'member'::public.user_role),
    new.raw_user_meta_data->>'phone_number',
    new.raw_user_meta_data->>'home_address',
    new.raw_user_meta_data->>'alt_phone_number'
  );
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$function$
;


  create policy "Admins can manage scheme members"
  on "public"."scheme_members"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.schemes
  WHERE ((schemes.id = scheme_members.scheme_id) AND (schemes.admin_id = auth.uid())))));



  create policy "Admins can manage their schemes"
  on "public"."schemes"
  as permissive
  for all
  to public
using ((auth.uid() = admin_id));



  create policy "Admins can manage transactions for their schemes"
  on "public"."transactions"
  as permissive
  for all
  to public
using ((auth.uid() = admin_id));



  create policy "Users can view their own transactions"
  on "public"."transactions"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



