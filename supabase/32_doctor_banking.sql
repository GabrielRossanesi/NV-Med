-- NV Med: private physician banking, incremental and compatible with existing enrollments.
-- Prepare/review only. Do not apply to a shared environment without authorization.
BEGIN;

ALTER FUNCTION public.nv_permission_actions() RENAME TO nv_permission_actions_before_banking;
CREATE FUNCTION public.nv_permission_actions()
RETURNS TABLE(module text, action text) LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT * FROM public.nv_permission_actions_before_banking()
  UNION ALL SELECT 'dados_bancarios', unnest(ARRAY['view','edit','history']);
$$;
ALTER FUNCTION public.nv_role_action(text,text,text,text) RENAME TO nv_role_action_before_banking;
CREATE FUNCTION public.nv_role_action(account_type text, account_role text, module text, action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN module = 'dados_bancarios' THEN action IN ('view','edit','history') AND
    CASE WHEN account_type = 'saas_admin' THEN account_role IN ('CEO','Gerente','Financeiro')
    ELSE account_role IN ('Diretor','Gerente','Financeiro') END
  ELSE public.nv_role_action_before_banking(account_type,account_role,module,action) END;
$$;

CREATE TABLE public.doctor_banking (
  doctor_id text PRIMARY KEY,
  organization_id text NOT NULL,
  pix_key text NOT NULL,
  pix_key_type text CHECK (pix_key_type IN ('cpf','cnpj','email','phone','evp')),
  bank text NOT NULL DEFAULT '',
  bank_code text NOT NULL DEFAULT '',
  bank_ispb text NOT NULL DEFAULT '',
  agency text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (doctor_id,organization_id) REFERENCES public.doctors(id,organization_id) ON DELETE CASCADE
);
CREATE TABLE public.doctor_banking_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id text NOT NULL,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  change_type text NOT NULL CHECK (change_type IN ('created','updated')),
  changed_fields text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doctor_banking_audit_target_idx ON public.doctor_banking_audit(doctor_id,id DESC);
ALTER TABLE public.doctor_banking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_banking_audit ENABLE ROW LEVEL SECURITY;
-- Deny direct access, including bulk SELECT. Only scoped SECURITY DEFINER RPCs expose data.
REVOKE ALL ON public.doctor_banking, public.doctor_banking_audit FROM PUBLIC, anon, authenticated;

-- Move the existing value without guessing its type. Retain the old nullable column for
-- schema compatibility; the private table is the only source of banking values thereafter.
INSERT INTO public.doctor_banking(doctor_id,organization_id,pix_key)
SELECT doctor_id,organization_id,pix_key FROM public.doctor_enrollments;
ALTER TABLE public.doctor_enrollments ALTER COLUMN pix_key DROP NOT NULL;
UPDATE public.doctor_enrollments SET pix_key = NULL;
COMMENT ON COLUMN public.doctor_enrollments.pix_key IS 'Retired compatibility column. Banking values live only in doctor_banking.';

CREATE FUNCTION public.nv_normalize_pix(kind text, value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE normalized text := btrim(value); total integer; size integer; remainder integer;
BEGIN
  IF normalized IS NULL OR length(normalized) NOT BETWEEN 1 AND 140 THEN
    RAISE EXCEPTION 'Informe a chave PIX.' USING ERRCODE = '22023';
  END IF;
  IF kind IN ('cpf','cnpj') THEN
    IF normalized !~ '^[0-9A-Za-z. /\t\r\n-]+$' THEN
      RAISE EXCEPTION 'Chave PIX inválida.' USING ERRCODE = '22023';
    END IF;
    normalized := upper(regexp_replace(normalized, '[. /[:space:]-]', '', 'g'));
    IF kind = 'cpf' THEN
      IF NOT public.nv_valid_cpf(normalized) THEN RAISE EXCEPTION 'CPF da chave PIX inválido.' USING ERRCODE = '22023'; END IF;
    ELSE
      IF normalized !~ '^[A-Z0-9]{12}[0-9]{2}$' OR normalized ~ '^([0-9])\1{13}$' THEN
        RAISE EXCEPTION 'CNPJ da chave PIX inválido.' USING ERRCODE = '22023';
      END IF;
      FOR size IN 12..13 LOOP
        SELECT sum((ascii(substring(normalized FROM n FOR 1)) - 48) * ((size - n) % 8 + 2)) INTO total
        FROM generate_series(1,size) n;
        remainder := total % 11;
        IF (CASE WHEN remainder < 2 THEN 0 ELSE 11 - remainder END) <> substring(normalized FROM size+1 FOR 1)::integer THEN
          RAISE EXCEPTION 'CNPJ da chave PIX inválido.' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
  ELSIF kind = 'email' THEN
    normalized := lower(normalized);
    IF length(normalized) > 77 OR normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'E-mail da chave PIX inválido.' USING ERRCODE = '22023';
    END IF;
  ELSIF kind = 'phone' THEN
    IF normalized !~ '^\+?[0-9 ().-]+$' THEN RAISE EXCEPTION 'Telefone da chave PIX inválido.' USING ERRCODE = '22023'; END IF;
    normalized := regexp_replace(normalized, '[ ().-]', '', 'g');
    IF normalized ~ '^[0-9]{10,11}$' THEN normalized := '+55' || normalized;
    ELSIF normalized ~ '^55[0-9]{10,11}$' THEN normalized := '+' || normalized; END IF;
    IF normalized !~ '^\+[1-9][0-9]{7,14}$' OR (normalized LIKE '+55%' AND normalized !~ '^\+55[1-9][0-9]{9,10}$') THEN
      RAISE EXCEPTION 'Use DDD brasileiro ou telefone internacional com +.' USING ERRCODE = '22023';
    END IF;
  ELSIF kind = 'evp' THEN
    normalized := lower(normalized);
    IF normalized !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Chave aleatória PIX inválida (UUID v4).' USING ERRCODE = '22023';
    END IF;
  ELSE RAISE EXCEPTION 'Selecione o tipo de chave PIX.' USING ERRCODE = '22023'; END IF;
  RETURN normalized;
END;
$$;

CREATE FUNCTION public.nv_validate_banking()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.pix_key := public.nv_normalize_pix(NEW.pix_key_type,NEW.pix_key);
  NEW.bank := btrim(NEW.bank); NEW.bank_code := btrim(NEW.bank_code); NEW.bank_ispb := btrim(NEW.bank_ispb);
  NEW.agency := btrim(NEW.agency); NEW.account_number := btrim(NEW.account_number);
  IF length(NEW.bank) > 200 OR NEW.bank ~ '[[:cntrl:]]'
    OR (NEW.bank_code <> '' AND NEW.bank_code !~ '^[0-9]{3}$')
    OR (NEW.bank_ispb <> '' AND NEW.bank_ispb !~ '^[0-9]{8}$')
    OR (NEW.agency <> '' AND NEW.agency !~ '^[0-9A-Za-z][0-9A-Za-z. /-]{0,29}$')
    OR (NEW.account_number <> '' AND NEW.account_number !~ '^[0-9A-Za-z][0-9A-Za-z. /-]{0,29}$') THEN
    RAISE EXCEPTION 'Confira o banco, a agência e a conta.' USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now(); RETURN NEW;
END;
$$;
CREATE TRIGGER nv_validate_banking BEFORE INSERT OR UPDATE ON public.doctor_banking
FOR EACH ROW EXECUTE FUNCTION public.nv_validate_banking();

CREATE FUNCTION public.nv_audit_banking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE fields text[]; audit_id bigint;
BEGIN
  SELECT array_agg(k ORDER BY k) INTO fields FROM unnest(ARRAY['pix_key','pix_key_type','bank','bank_code','bank_ispb','agency','account_number']) k
  WHERE TG_OP = 'INSERT' OR (to_jsonb(OLD)->k) IS DISTINCT FROM (to_jsonb(NEW)->k);
  IF fields IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.doctor_banking_audit(doctor_id,organization_id,actor_id,change_type,changed_fields)
  VALUES(NEW.doctor_id,NEW.organization_id,public.nv_session_actor(),CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END,fields)
  RETURNING id INTO audit_id;
  INSERT INTO public.portal_notifications(recipient_id,event_key,message)
  SELECT e.auth_user_id,'banking:' || audit_id,'Seus dados bancários foram atualizados. Se não reconhecer a alteração, entre em contato com a empresa.'
  FROM public.doctor_enrollments e WHERE e.doctor_id = NEW.doctor_id AND e.organization_id = NEW.organization_id AND e.auth_user_id IS NOT NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_audit_banking AFTER INSERT OR UPDATE ON public.doctor_banking
FOR EACH ROW EXECUTE FUNCTION public.nv_audit_banking();

CREATE FUNCTION public.nv_write_banking(target text, org text, details jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.doctor_banking(doctor_id,organization_id,pix_key,pix_key_type,bank,bank_code,bank_ispb,agency,account_number)
  VALUES(target,org,details->>'pix_key',details->>'pix_key_type',coalesce(details->>'bank',''),coalesce(details->>'bank_code',''),
    coalesce(details->>'bank_ispb',''),coalesce(details->>'agency',''),coalesce(details->>'account_number',''))
  ON CONFLICT (doctor_id) DO UPDATE SET pix_key = EXCLUDED.pix_key, pix_key_type = EXCLUDED.pix_key_type,
    bank = EXCLUDED.bank, bank_code = EXCLUDED.bank_code, bank_ispb = EXCLUDED.bank_ispb, agency = EXCLUDED.agency, account_number = EXCLUDED.account_number;
$$;

CREATE FUNCTION public.nv_doctor_banking(target text, reveal boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org text; details public.doctor_banking; own boolean;
BEGIN
  SELECT organization_id INTO org FROM public.doctors WHERE id = target;
  own := public.nv_owns_doctor(org,target);
  IF org IS NULL OR NOT (own OR public.nv_can_action(org,'dados_bancarios','view')) THEN
    RAISE EXCEPTION 'Dados bancários indisponíveis.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO details FROM public.doctor_banking WHERE doctor_id = target AND organization_id = org;
  RETURN jsonb_build_object('complete',coalesce(details.pix_key_type IS NOT NULL,false),
    'can_edit',own OR public.nv_can_action(org,'dados_bancarios','edit'),
    'can_history',public.nv_can_action(org,'dados_bancarios','history'),
    'details',jsonb_build_object('pix_key_type',coalesce(details.pix_key_type,''),
      'pix_key',CASE WHEN reveal THEN coalesce(details.pix_key,'') WHEN details.pix_key IS NOT NULL THEN '••••' || right(details.pix_key,2) ELSE '' END,
      'bank',coalesce(details.bank,''),'bank_code',coalesce(details.bank_code,''),'bank_ispb',coalesce(details.bank_ispb,''),
      'agency',CASE WHEN reveal THEN coalesce(details.agency,'') WHEN details.agency <> '' THEN '••••' || right(details.agency,2) ELSE '' END,
      'account_number',CASE WHEN reveal THEN coalesce(details.account_number,'') WHEN details.account_number <> '' THEN '••••' || right(details.account_number,2) ELSE '' END));
END;
$$;
CREATE FUNCTION public.nv_update_doctor_banking(target text, details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org text;
BEGIN
  SELECT organization_id INTO org FROM public.doctors WHERE id = target FOR UPDATE;
  IF org IS NULL OR NOT (public.nv_owns_doctor(org,target) OR public.nv_can_action(org,'dados_bancarios','edit')) THEN
    RAISE EXCEPTION 'Dados bancários indisponíveis.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.nv_write_banking(target,org,details);
END;
$$;
CREATE FUNCTION public.nv_doctor_banking_history(target text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org text;
BEGIN
  SELECT organization_id INTO org FROM public.doctors WHERE id = target;
  IF org IS NULL OR NOT public.nv_can_action(org,'dados_bancarios','history') THEN
    RAISE EXCEPTION 'Histórico indisponível.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id DESC),'[]'::jsonb)
    FROM (SELECT id,actor_id,doctor_id,created_at,change_type,changed_fields FROM public.doctor_banking_audit
      WHERE doctor_id = target AND organization_id = org ORDER BY id DESC LIMIT 50) a);
END;
$$;

-- Preserve all existing identity matching, duplicate checks, documents and review rules.
ALTER FUNCTION public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[]) RENAME TO nv_submit_enrollment_before_banking;
CREATE FUNCTION public.nv_submit_enrollment(org text, full_name text, registration text, uf text, tax_id text, birth date,
  phone_number text, pix text, specialties text[], banking jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target text; normalized text;
BEGIN
  normalized := public.nv_normalize_pix(banking->>'pix_key_type',pix);
  PERFORM public.nv_submit_enrollment_before_banking(org,full_name,registration,uf,tax_id,birth,phone_number,normalized,specialties);
  SELECT doctor_id INTO target FROM public.doctor_enrollments WHERE organization_id = org AND auth_user_id = public.nv_session_actor();
  PERFORM public.nv_write_banking(target,org,banking || jsonb_build_object('pix_key',normalized));
  UPDATE public.doctor_enrollments SET pix_key = NULL WHERE doctor_id = target;
END;
$$;
-- Old clients receive a safe validation error; they cannot submit without a key type.
CREATE FUNCTION public.nv_submit_enrollment(org text, full_name text, registration text, uf text, tax_id text, birth date,
  phone_number text, pix text, specialties text[])
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Atualize a página e selecione o tipo de chave PIX.' USING ERRCODE = '22023'; END;
$$;

CREATE FUNCTION public.nv_create_doctor_with_banking(profile jsonb, banking jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org text := profile->>'organization_id'; target text := profile->>'id';
BEGIN
  IF NOT public.nv_can_action(org,'medicos','create') THEN RAISE EXCEPTION 'Cadastro indisponível.' USING ERRCODE = '42501'; END IF;
  IF banking IS NOT NULL AND NOT public.nv_can_action(org,'dados_bancarios','edit') THEN
    RAISE EXCEPTION 'Sem permissão para editar dados bancários.' USING ERRCODE = '42501';
  END IF;
  IF banking IS NULL AND public.nv_can_action(org,'dados_bancarios','edit') THEN
    RAISE EXCEPTION 'Preencha a chave PIX e seu tipo.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,rqe,cpf,phone,email,specialty,address,status,contract_model,contract_signed,linked_units)
  VALUES(target,org,profile->>'name',profile->>'crm',profile->>'crm_uf',nullif(profile->>'rqe',''),profile->>'cpf',profile->>'phone',
    profile->>'email',profile->>'specialty',profile->>'address',CASE WHEN banking IS NULL THEN 'pending' ELSE profile->>'status' END,
    coalesce(profile->>'contract_model','pf'),coalesce((profile->>'contract_signed')::boolean,false),'{}');
  IF banking IS NOT NULL THEN PERFORM public.nv_write_banking(target,org,banking); END IF;
END;
$$;

-- A direct table insert or a pending -> active update must not bypass completion.
-- Deferred checking lets the existing doctor and its banking record be created atomically.
CREATE FUNCTION public.nv_require_new_doctor_banking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.doctors WHERE id = NEW.id AND status = 'active')
    AND NOT EXISTS (SELECT 1 FROM public.doctor_banking WHERE doctor_id = NEW.id AND organization_id = NEW.organization_id AND pix_key_type IS NOT NULL) THEN
    RAISE EXCEPTION 'Preencha a chave PIX e seu tipo antes de concluir o cadastro.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER nv_require_new_doctor_banking AFTER INSERT OR UPDATE OF status ON public.doctors
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.nv_require_new_doctor_banking();

-- Only new enrollment approvals require completion. Existing approved physicians remain
-- fully usable even when their migrated banking record has no type yet.
ALTER FUNCTION public.nv_review_enrollment(text,text,text,text[],text[]) RENAME TO nv_review_enrollment_before_banking;
CREATE FUNCTION public.nv_review_enrollment(target text, decision text, note text, specialties text[], units text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org text;
BEGIN
  SELECT organization_id INTO org FROM public.doctor_enrollments WHERE doctor_id = target FOR UPDATE;
  IF org IS NULL OR NOT public.nv_can_action(org,'medicos','approve') THEN
    RAISE EXCEPTION 'Cadastro indisponível.' USING ERRCODE = '42501';
  END IF;
  IF decision = 'approved' AND NOT EXISTS (SELECT 1 FROM public.doctor_banking WHERE doctor_id = target AND organization_id = org AND pix_key_type IS NOT NULL) THEN
    RAISE EXCEPTION 'Solicite a regularização da chave PIX e do tipo antes da aprovação.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.nv_review_enrollment_before_banking(target,decision,note,specialties,units);
END;
$$;

REVOKE ALL ON FUNCTION public.nv_permission_actions_before_banking(), public.nv_role_action_before_banking(text,text,text,text),
  public.nv_normalize_pix(text,text), public.nv_validate_banking(), public.nv_audit_banking(),public.nv_write_banking(text,text,jsonb),public.nv_require_new_doctor_banking(),
  public.nv_submit_enrollment_before_banking(text,text,text,text,text,date,text,text,text[]),
  public.nv_review_enrollment_before_banking(text,text,text,text[],text[]) FROM PUBLIC,anon,authenticated;
-- Pure permission helpers remain usable by existing invoker functions and RLS.
GRANT EXECUTE ON FUNCTION public.nv_permission_actions_before_banking(), public.nv_role_action_before_banking(text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.nv_permission_actions(),public.nv_role_action(text,text,text,text),
  public.nv_doctor_banking(text,boolean),public.nv_update_doctor_banking(text,jsonb),public.nv_doctor_banking_history(text),
  public.nv_create_doctor_with_banking(jsonb,jsonb),public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[],jsonb),
  public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[]),public.nv_review_enrollment(text,text,text,text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nv_permission_actions(),public.nv_role_action(text,text,text,text),
  public.nv_doctor_banking(text,boolean),public.nv_update_doctor_banking(text,jsonb),public.nv_doctor_banking_history(text),
  public.nv_create_doctor_with_banking(jsonb,jsonb),public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[],jsonb),
  public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[]),public.nv_review_enrollment(text,text,text,text[],text[]) TO authenticated;
COMMIT;
