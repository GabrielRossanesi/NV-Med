-- Disposable database only. No invitation or credential operation; all fixtures roll back.
BEGIN;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO public.medical_documents(id,organization_id,doctor_id,name,type,status)
 SELECT 'workspace-'||lpad(n::text,5,'0'),'nv-bank-org','nv-bank-doctor','Comprovante fictício','workspace_'||n,'not_sent' FROM generate_series(1,1001)n;
CREATE TEMP TABLE workspace_preserved AS SELECT
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.doctors t) doctors,
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.shifts t) shifts,
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM auth.users t) auth,
 (SELECT count(*) FROM public.doctor_access_operations) access;
SET LOCAL ROLE authenticated;
DO $$ DECLARE batch jsonb; collected jsonb:='[]'; cursor_id text; expected bigint; started timestamptz:=clock_timestamp(); BEGIN
 SELECT count(*) INTO expected FROM public.medical_documents WHERE organization_id='nv-bank-org';
 LOOP
  batch:=public.nv_workspace_documents('nv-bank-org',NULL,cursor_id);
  IF jsonb_array_length(batch)>500 OR EXISTS(SELECT FROM jsonb_array_elements(batch)d WHERE d->>'organization_id'<>'nv-bank-org' OR d ?| ARRAY['file_url','cpf','bank','account_number']) THEN RAISE EXCEPTION 'FAIL: metadata scope or projection'; END IF;
  collected:=collected||batch;EXIT WHEN jsonb_array_length(batch)<500;cursor_id:=batch->-1->>'id';
 END LOOP;
 IF jsonb_array_length(collected)<>expected OR (SELECT count(DISTINCT d->>'id') FROM jsonb_array_elements(collected)d)<>expected THEN RAISE EXCEPTION 'FAIL: truncated or repeated metadata'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(public.nv_workspace_documents('nv-bank-org','nv-bank-doctor'))d WHERE d->>'doctor_id'<>'nv-bank-doctor') THEN RAISE EXCEPTION 'FAIL: doctor scope'; END IF;
 PERFORM public.nv_workspace_document_audit('nv-bank-org','nv-bank-doctor');
 BEGIN PERFORM public.nv_workspace_documents('nv-bank-other');RAISE EXCEPTION 'FAIL: cross-company documents';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.nv_workspace_document_audit('nv-bank-other');RAISE EXCEPTION 'FAIL: cross-company audit';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.nv_workspace_documents('nv-bank-org','not-this-doctor');RAISE EXCEPTION 'FAIL: doctor IDOR';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.nv_workspace_documents('nv-bank-org',NULL,NULL,10000);RAISE EXCEPTION 'FAIL: unbounded page';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.nv_workspace_organization_counts();RAISE EXCEPTION 'FAIL: tenant global counts';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS: workspace metadata: % rows, % ms.',expected,round(extract(epoch FROM clock_timestamp()-started)*1000,1);
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM workspace_preserved WHERE doctors IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.doctors t) OR shifts IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.shifts t) OR auth IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM auth.users t) OR access<>(SELECT count(*) FROM public.doctor_access_operations)) THEN RAISE EXCEPTION 'FAIL: read-only preservation'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.nv_workspace_documents('nv-bank-org');RAISE EXCEPTION 'FAIL: physician administrative documents';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES('60000000-0000-4000-8000-000000000007','authenticated','authenticated','workspace-ceo@example.invalid',now());
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,role,status) VALUES('workspace-ceo','60000000-0000-4000-8000-000000000007','CEO fictício','workspace-ceo@example.invalid','saas_admin','CEO','active');
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.nv_workspace_organization_counts();
 IF result->'nv-bank-org'->>'doctors' IS NULL THEN RAISE EXCEPTION 'FAIL: CEO aggregate'; END IF;
END $$;
RESET ROLE;
UPDATE public.user_accounts SET role='Financeiro' WHERE id='workspace-ceo';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.nv_workspace_organization_counts();
 IF result->'nv-bank-org'->>'doctors' IS NOT NULL OR result->'nv-bank-org'->>'documents' IS NOT NULL THEN RAISE EXCEPTION 'FAIL: granular aggregate permissions'; END IF;
END $$;
RESET ROLE;
UPDATE public.user_accounts SET status='inactive' WHERE id='workspace-ceo';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.nv_workspace_organization_counts();RAISE EXCEPTION 'FAIL: revoked actor aggregate';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.nv_workspace_documents('nv-bank-org');RAISE EXCEPTION 'FAIL: revoked actor metadata';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.nv_workspace_documents(text,text,text,integer)','public.nv_workspace_document_audit(text,text)','public.nv_workspace_organization_counts()'] LOOP
  IF has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('service_role',signature,'EXECUTE') OR NOT has_function_privilege('authenticated',signature,'EXECUTE') THEN RAISE EXCEPTION 'FAIL: workspace grants'; END IF;
  IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=signature::regprocedure AND prosecdef AND proconfig=ARRAY['search_path=""']) THEN RAISE EXCEPTION 'FAIL: workspace function security'; END IF;
 END LOOP;
END $$;
ROLLBACK;
