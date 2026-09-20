-- First administrator bootstrap. Run only as postgres.
-- No password is issued. The owner uses password recovery to prove email ownership.
-- Replace the two values below before running this file.
BEGIN;
SELECT set_config('nv.owner_email', 'owner@example.com', true);
SELECT set_config('nv.owner_name', 'Owner name', true);
DO $$
DECLARE
  owner_id uuid;
  owner_email text := current_setting('nv.owner_email');
  owner_name text := current_setting('nv.owner_name');
BEGIN
 SELECT id INTO owner_id FROM auth.users WHERE lower(email)=lower(owner_email);
 IF owner_id IS NULL THEN
   owner_id:=gen_random_uuid();
   INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
   VALUES('00000000-0000-0000-0000-000000000000',owner_id,'authenticated','authenticated',owner_email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
   INSERT INTO auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at)
   VALUES(gen_random_uuid(),owner_id,owner_id::text,jsonb_build_object('sub',owner_id::text,'email',owner_email,'email_verified',true,'phone_verified',false),'email',now(),now());
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_accounts WHERE auth_user_id=owner_id) THEN
   INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role,status)
   VALUES(gen_random_uuid()::text,owner_id,owner_name,owner_email,'saas_admin',null,'CEO','active');
 END IF;
END $$;
COMMIT;
