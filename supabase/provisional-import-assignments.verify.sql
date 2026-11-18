-- Synthetic fixtures only. Every test is rolled back.
BEGIN;
INSERT INTO auth.users(id,email)VALUES('35000000-0000-4000-8000-000000000001','provisional-admin@example.invalid');
INSERT INTO public.organizations(id,name,settings)VALUES('nv-provisional-org','Import test','{"specialties":["Cirurgia"],"requiredDocuments":[]}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role)VALUES('nv-provisional-admin','35000000-0000-4000-8000-000000000001','Admin','provisional-admin@example.invalid','tenant_user','nv-provisional-org','Diretor');
INSERT INTO public.units(id,organization_id,name,type)VALUES('nv-provisional-unit','nv-provisional-org','Hospital','hospital');
INSERT INTO public.sectors(id,organization_id,unit_id,name,primary_specialty,specialties)VALUES('nv-provisional-sector','nv-provisional-org','nv-provisional-unit','Cirurgia PS','Cirurgia',ARRAY['Cirurgia']);
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,status,linked_units)VALUES
 ('nv-provisional-doctor','nv-provisional-org','Pending doctor','350001','SP','Cirurgia','pending',ARRAY['nv-provisional-unit']),
 ('nv-provisional-other','nv-provisional-org','Other pending doctor','350002','SP','Cirurgia','pending',ARRAY['nv-provisional-unit']);
INSERT INTO public.shifts(id,organization_id,unit_id,sector_id,specialty,date,start_time,end_time,type,status,employment_type)VALUES
 ('nv-provisional-post','nv-provisional-org','nv-provisional-unit','nv-provisional-sector','Cirurgia',current_date+10,'07:00','19:00','onsite','open','clt'),
 ('nv-provisional-overlap','nv-provisional-org','nv-provisional-unit','nv-provisional-sector','Cirurgia',current_date+10,'13:00','20:00','onsite','open','clt'),
 ('nv-provisional-unlisted','nv-provisional-org','nv-provisional-unit','nv-provisional-sector','Cirurgia',current_date+11,'07:00','19:00','onsite','open','clt');
INSERT INTO public.shifts(id,organization_id,unit_id,specialty,date,start_time,end_time,type,status,employment_type,coverage_mode,coverage_reason)
VALUES('nv-provisional-adhoc','nv-provisional-org','nv-provisional-unit','Cirurgia',current_date+12,'07:00','19:00','onsite','open','clt','adhoc','Synthetic coverage');
DO $$BEGIN
 BEGIN
  UPDATE public.shifts SET doctor_id='nv-provisional-doctor',status='pending'WHERE id='nv-provisional-post';
  RAISE EXCEPTION 'FAIL: unapproved assignment succeeded';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%'THEN RAISE;END IF;END;
END $$;
INSERT INTO public.import_assignment_authorizations(shift_id,doctor_id,organization_id,unit_id,sector_id,specialty,date,start_time,end_time,employment_type,source_sha256,identity_basis,authorization_note)
SELECT id,'nv-provisional-doctor',organization_id,unit_id,sector_id,specialty,date,start_time,end_time,employment_type,repeat('a',64),'synthetic_registry_match','Synthetic explicit authorization'
FROM public.shifts WHERE id IN('nv-provisional-post','nv-provisional-overlap');
UPDATE public.shifts SET doctor_id='nv-provisional-doctor',status='pending'WHERE id='nv-provisional-post';
DO $$DECLARE item public.shifts;BEGIN
 SELECT *INTO item FROM public.shifts WHERE id='nv-provisional-post';
 IF NOT public.nv_import_assignment_matches(item)OR public.nv_credentialed_for_shift(item.doctor_id,item)THEN RAISE EXCEPTION 'FAIL: provisional differs from credential approval';END IF;
 IF(SELECT status FROM public.doctors WHERE id=item.doctor_id)<>'pending'OR EXISTS(SELECT FROM public.doctor_enrollments WHERE doctor_id=item.doctor_id)OR EXISTS(SELECT FROM public.doctor_banking WHERE doctor_id=item.doctor_id)THEN RAISE EXCEPTION 'FAIL: fabricated credentials or banking';END IF;
 item.date:=item.date+1;IF public.nv_import_assignment_matches(item)THEN RAISE EXCEPTION 'FAIL: authorization moved to another date';END IF;
 SELECT *INTO item FROM public.shifts WHERE id='nv-provisional-post';item.doctor_id:='nv-provisional-other';IF public.nv_import_assignment_matches(item)THEN RAISE EXCEPTION 'FAIL: authorization transferred to another physician';END IF;
 SELECT *INTO item FROM public.shifts WHERE id='nv-provisional-post';item.organization_id:='other-org';IF public.nv_import_assignment_matches(item)THEN RAISE EXCEPTION 'FAIL: cross organization exception';END IF;
 BEGIN UPDATE public.shifts SET doctor_id='nv-provisional-doctor',status='pending'WHERE id='nv-provisional-overlap';RAISE EXCEPTION 'FAIL: overlap accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%'THEN RAISE;END IF;END;
 BEGIN UPDATE public.shifts SET date=date+1 WHERE id='nv-provisional-post';RAISE EXCEPTION 'FAIL: source date changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%'THEN RAISE;END IF;END;
 BEGIN UPDATE public.shifts SET status='confirmed'WHERE id='nv-provisional-post';RAISE EXCEPTION 'FAIL: uncredentialed confirmation';
 EXCEPTION WHEN raise_exception OR invalid_parameter_value THEN IF SQLERRM LIKE 'FAIL:%'THEN RAISE;END IF;END;
END $$;
-- An active legacy doctor without approved enrollment must not confirm or move
-- a provisional post by changing employment at the same time.
INSERT INTO public.doctor_banking(doctor_id,organization_id,pix_key_type,pix_key)
VALUES('nv-provisional-doctor','nv-provisional-org','email','synthetic-doctor@example.invalid');
UPDATE public.doctors SET status='active'WHERE id='nv-provisional-doctor';
DO $$BEGIN
 BEGIN UPDATE public.shifts SET status='confirmed'WHERE id='nv-provisional-post';RAISE EXCEPTION 'FAIL: active but unenrolled confirmation';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN UPDATE public.shifts SET employment_type='concursado',status='confirmed'WHERE id='nv-provisional-post';RAISE EXCEPTION 'FAIL: employment change escaped credential check';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
UPDATE public.doctors SET status='pending'WHERE id='nv-provisional-doctor';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"35000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$DECLARE item jsonb;BEGIN
 BEGIN PERFORM 1 FROM public.import_assignment_authorizations;RAISE EXCEPTION 'FAIL: staff reads private authorizations';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN DELETE FROM public.import_assignment_authorizations;RAISE EXCEPTION 'FAIL: staff changes private authorizations';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 SELECT to_jsonb(s)INTO item FROM public.nv_staff_shifts s WHERE id='nv-provisional-post';
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(item||'{"notes":"Ordinary staff note"}'));
 SELECT to_jsonb(s)INTO item FROM public.nv_staff_shifts s WHERE id='nv-provisional-unlisted';
 BEGIN PERFORM public.nv_save_operational_shifts(jsonb_build_array(item||'{"doctor_id":"nv-provisional-doctor","status":"pending"}'));RAISE EXCEPTION 'FAIL: staff assigned unlisted post';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%'THEN RAISE;END IF;END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.import_assignment_authorizations SET revoked_at=now()WHERE shift_id='nv-provisional-post';
DO $$DECLARE item public.shifts;BEGIN
 SELECT *INTO item FROM public.shifts WHERE id='nv-provisional-post';
 IF public.nv_import_assignment_matches(item)THEN RAISE EXCEPTION 'FAIL: revoked exception accepted';END IF;
END $$;
UPDATE public.import_assignment_authorizations SET revoked_at=NULL WHERE shift_id='nv-provisional-post';
UPDATE public.shifts SET status='cancelled'WHERE id='nv-provisional-post';
UPDATE public.shifts SET doctor_id=NULL,status='open'WHERE id='nv-provisional-post';
SELECT 'PASS: scoped provisional assignments, unchanged pending credentials, private authorizations, source immutability, overlap and confirmation blocking, cancellation and release';
ROLLBACK;
