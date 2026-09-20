-- NV Med: authenticated tenancy, private documents and operational scheduling.
-- Apply AFTER provisioning and linking at least one real SaaS administrator.
-- Run as postgres. Existing demo records are preserved, never auto-linked by email.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_auth_user_unique ON public.user_accounts(auth_user_id) WHERE auth_user_id IS NOT NULL;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS sector text;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS employment_type text CHECK (employment_type IN ('clt','concursado','pj'));
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS employer_name text;
ALTER TABLE public.medical_documents ADD COLUMN IF NOT EXISTS file_path text;

CREATE OR REPLACE FUNCTION public.nv_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_accounts WHERE auth_user_id = (SELECT auth.uid()) AND status='active' AND type='saas_admin');
$$;
CREATE OR REPLACE FUNCTION public.nv_org_access(org text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id=(SELECT auth.uid()) AND u.status='active' AND (u.type='saas_admin' OR u.organization_id=org));
$$;
CREATE OR REPLACE FUNCTION public.nv_can_write(org text, resource text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id=(SELECT auth.uid()) AND u.status='active' AND (
   (u.type='saas_admin' AND (
      u.role IN ('CEO','Gerente') OR
      (u.role IN ('Coordenador','Administrativo') AND resource IN ('doctors','units','shifts')) OR
      (u.role='Jurídico' AND resource='medical_documents')
   )) OR (u.type='tenant_user' AND u.organization_id=org AND (
      u.role='Diretor' OR
      (u.role IN ('Gerente','Coordenador de Escalas','Escalista') AND resource IN ('doctors','units','shifts','medical_documents')) OR
      (u.role='Jurídico' AND resource='medical_documents')
   ))
 ));
$$;
REVOKE ALL ON FUNCTION public.nv_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nv_org_access(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nv_can_write(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_admin(), public.nv_org_access(text), public.nv_can_write(text,text) TO authenticated;

DO $$ DECLARE p record; t text; BEGIN
 FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('organizations','user_accounts','doctors','units','medical_documents','shifts') LOOP
   EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname,p.schemaname,p.tablename);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['organizations','user_accounts','doctors','units','medical_documents','shifts'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);
   EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t);
   EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['doctors','units','medical_documents','shifts'] LOOP
   EXECUTE format('CREATE POLICY nv_read ON public.%I FOR SELECT TO authenticated USING(public.nv_org_access(organization_id))',t);
   EXECUTE format('CREATE POLICY nv_insert ON public.%I FOR INSERT TO authenticated WITH CHECK(public.nv_can_write(organization_id,%L))',t,t);
   EXECUTE format('CREATE POLICY nv_update ON public.%I FOR UPDATE TO authenticated USING(public.nv_can_write(organization_id,%L)) WITH CHECK(public.nv_can_write(organization_id,%L))',t,t,t);
   EXECUTE format('CREATE POLICY nv_delete ON public.%I FOR DELETE TO authenticated USING(public.nv_can_write(organization_id,%L))',t,t);
 END LOOP;
END $$;
CREATE POLICY nv_org_read ON public.organizations FOR SELECT TO authenticated USING(public.nv_org_access(id));
CREATE POLICY nv_org_insert ON public.organizations FOR INSERT TO authenticated WITH CHECK(public.nv_admin() AND public.nv_can_write(id,'organizations'));
CREATE POLICY nv_org_update ON public.organizations FOR UPDATE TO authenticated USING(public.nv_can_write(id,'organizations')) WITH CHECK(public.nv_can_write(id,'organizations'));
-- Profiles are modified only by the authorized server endpoint (service role).
REVOKE INSERT, UPDATE, DELETE ON public.user_accounts FROM authenticated;
CREATE POLICY nv_profile_read ON public.user_accounts FOR SELECT TO authenticated USING(auth_user_id=(SELECT auth.uid()) OR public.nv_admin());

-- Tenant-safe references: a shift cannot reference another tenant's doctor/unit.
CREATE UNIQUE INDEX IF NOT EXISTS doctors_id_org_unique ON public.doctors(id,organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS units_id_org_unique ON public.units(id,organization_id);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='shifts_doctor_tenant_fk') THEN
 ALTER TABLE public.shifts ADD CONSTRAINT shifts_doctor_tenant_fk FOREIGN KEY(doctor_id,organization_id) REFERENCES public.doctors(id,organization_id) ON DELETE CASCADE NOT VALID;
 ALTER TABLE public.shifts ADD CONSTRAINT shifts_unit_tenant_fk FOREIGN KEY(unit_id,organization_id) REFERENCES public.units(id,organization_id) ON DELETE CASCADE NOT VALID;
 ALTER TABLE public.medical_documents ADD CONSTRAINT documents_doctor_tenant_fk FOREIGN KEY(doctor_id,organization_id) REFERENCES public.doctors(id,organization_id) ON DELETE CASCADE NOT VALID;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.nv_validate_shift() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE starts timestamp; ends timestamp;
BEGIN
 IF NEW.sector IS NULL OR length(trim(NEW.sector))=0 OR length(NEW.sector)>100 THEN RAISE EXCEPTION 'Informe o setor (até 100 caracteres).'; END IF;
 IF NEW.employment_type IS NULL OR NEW.employment_type NOT IN ('clt','concursado','pj') THEN RAISE EXCEPTION 'Informe o vínculo de trabalho.'; END IF;
 IF NEW.employment_type='pj' AND coalesce(length(trim(NEW.employer_name)),0)=0 THEN RAISE EXCEPTION 'Informe a empresa PJ.'; END IF;
 IF length(NEW.employer_name)>150 THEN RAISE EXCEPTION 'Nome do empregador muito longo.'; END IF;
 IF NEW.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR NEW.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR NEW.start_time=NEW.end_time THEN RAISE EXCEPTION 'Informe horários válidos e diferentes.'; END IF;
 IF TG_OP='UPDATE' AND NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.doctors WHERE id=NEW.doctor_id AND organization_id=NEW.organization_id AND status='active') OR NOT EXISTS(SELECT 1 FROM public.units WHERE id=NEW.unit_id AND organization_id=NEW.organization_id AND status='active') THEN RAISE EXCEPTION 'Selecione médico e unidade ativos da mesma empresa.'; END IF;
 IF NEW.status<>'cancelled' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id || ':' || NEW.doctor_id,0));
   starts := NEW.date + NEW.start_time::time;
   ends := NEW.date + NEW.end_time::time + CASE WHEN NEW.end_time<NEW.start_time THEN interval '1 day' ELSE interval '0 day' END;
   IF EXISTS(SELECT 1 FROM public.shifts s WHERE s.doctor_id=NEW.doctor_id AND s.id<>NEW.id AND s.status<>'cancelled' AND s.organization_id=NEW.organization_id AND
     (s.date+s.start_time::time) < ends AND (s.date+s.end_time::time+CASE WHEN s.end_time<=s.start_time THEN interval '1 day' ELSE interval '0 day' END)>starts) THEN
     RAISE EXCEPTION 'Este médico já está escalado em um horário sobreposto.';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nv_validate_shift ON public.shifts;
CREATE TRIGGER nv_validate_shift BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.nv_validate_shift();

CREATE OR REPLACE FUNCTION public.nv_validate_links() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.'; END IF;
 IF TG_TABLE_NAME='doctors' THEN
   IF EXISTS(SELECT 1 FROM unnest(NEW.linked_units) AS links(unit_id) WHERE NOT EXISTS(SELECT 1 FROM public.units u WHERE u.id=links.unit_id AND u.organization_id=NEW.organization_id)) THEN RAISE EXCEPTION 'Unidade vinculada inválida.'; END IF;
 ELSIF TG_TABLE_NAME='medical_documents' AND NEW.file_path IS NOT NULL THEN
   IF split_part(NEW.file_path,'/',1)<>NEW.organization_id OR split_part(NEW.file_path,'/',2)<>NEW.doctor_id OR NEW.file_path LIKE '%..%' THEN RAISE EXCEPTION 'Caminho de documento inválido.'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nv_doctor_links ON public.doctors;
CREATE TRIGGER nv_doctor_links BEFORE INSERT OR UPDATE ON public.doctors FOR EACH ROW EXECUTE FUNCTION public.nv_validate_links();
DROP TRIGGER IF EXISTS nv_document_links ON public.medical_documents;
CREATE TRIGGER nv_document_links BEFORE INSERT OR UPDATE ON public.medical_documents FOR EACH ROW EXECUTE FUNCTION public.nv_validate_links();
DROP TRIGGER IF EXISTS nv_unit_links ON public.units;
CREATE TRIGGER nv_unit_links BEFORE UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION public.nv_validate_links();

CREATE OR REPLACE FUNCTION public.nv_create_required_documents() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE doc jsonb;
BEGIN
 FOR doc IN SELECT jsonb_array_elements(coalesce(settings->'requiredDocuments','[]'::jsonb)) FROM public.organizations WHERE id=NEW.organization_id LOOP
   INSERT INTO public.medical_documents(id,organization_id,doctor_id,name,type,status)
   VALUES(gen_random_uuid()::text,NEW.organization_id,NEW.id,doc->>'name',doc->>'type','not_sent');
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.nv_create_required_documents() FROM PUBLIC;
DROP TRIGGER IF EXISTS nv_create_required_documents ON public.doctors;
CREATE TRIGGER nv_create_required_documents AFTER INSERT ON public.doctors FOR EACH ROW EXECUTE FUNCTION public.nv_create_required_documents();

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('medical-documents','medical-documents',false,10485760,ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png'];
DROP POLICY IF EXISTS "Public Read Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS "Public Update Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS nv_files_read ON storage.objects;
DROP POLICY IF EXISTS nv_files_insert ON storage.objects;
DROP POLICY IF EXISTS nv_files_delete ON storage.objects;
CREATE POLICY nv_files_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='medical-documents' AND public.nv_org_access((storage.foldername(name))[1]));
CREATE POLICY nv_files_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='medical-documents' AND public.nv_can_write((storage.foldername(name))[1],'medical_documents') AND EXISTS(SELECT 1 FROM public.doctors d WHERE d.id=(storage.foldername(name))[2] AND d.organization_id=(storage.foldername(name))[1]));
CREATE POLICY nv_files_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='medical-documents' AND public.nv_can_write((storage.foldername(name))[1],'medical_documents'));
COMMIT;
