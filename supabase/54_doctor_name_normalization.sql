-- Apply after 53. Existing names are reviewed and corrected in a separate transaction.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA nv_doctor_names;
REVOKE ALL ON SCHEMA nv_doctor_names FROM PUBLIC, anon, authenticated, service_role;

-- PostgreSQL 16/17 regular expressions have no Unicode property escapes.
-- The explicit ranges are the Unicode N (number), M (mark) and White_Space
-- properties used by src/lib/doctorName.ts. Whitespace also includes U+FEFF.
CREATE FUNCTION nv_doctor_names.number_pattern()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT $rx$[\u0030-\u0039\u00b2-\u00b3\u00b9\u00bc-\u00be\u0660-\u0669\u06f0-\u06f9\u07c0-\u07c9\u0966-\u096f\u09e6-\u09ef\u09f4-\u09f9\u0a66-\u0a6f\u0ae6-\u0aef\u0b66-\u0b6f\u0b72-\u0b77\u0be6-\u0bf2\u0c66-\u0c6f\u0c78-\u0c7e\u0ce6-\u0cef\u0d58-\u0d5e\u0d66-\u0d78\u0de6-\u0def\u0e50-\u0e59\u0ed0-\u0ed9\u0f20-\u0f33\u1040-\u1049\u1090-\u1099\u1369-\u137c\u16ee-\u16f0\u17e0-\u17e9\u17f0-\u17f9\u1810-\u1819\u1946-\u194f\u19d0-\u19da\u1a80-\u1a89\u1a90-\u1a99\u1b50-\u1b59\u1bb0-\u1bb9\u1c40-\u1c49\u1c50-\u1c59\u2070\u2074-\u2079\u2080-\u2089\u2150-\u2182\u2185-\u2189\u2460-\u249b\u24ea-\u24ff\u2776-\u2793\u2cfd\u3007\u3021-\u3029\u3038-\u303a\u3192-\u3195\u3220-\u3229\u3248-\u324f\u3251-\u325f\u3280-\u3289\u32b1-\u32bf\ua620-\ua629\ua6e6-\ua6ef\ua830-\ua835\ua8d0-\ua8d9\ua900-\ua909\ua9d0-\ua9d9\ua9f0-\ua9f9\uaa50-\uaa59\uabf0-\uabf9\uff10-\uff19\U00010107-\U00010133\U00010140-\U00010178\U0001018a-\U0001018b\U000102e1-\U000102fb\U00010320-\U00010323\U00010341\U0001034a\U000103d1-\U000103d5\U000104a0-\U000104a9\U00010858-\U0001085f\U00010879-\U0001087f\U000108a7-\U000108af\U000108fb-\U000108ff\U00010916-\U0001091b\U000109bc-\U000109bd\U000109c0-\U000109cf\U000109d2-\U000109ff\U00010a40-\U00010a48\U00010a7d-\U00010a7e\U00010a9d-\U00010a9f\U00010aeb-\U00010aef\U00010b58-\U00010b5f\U00010b78-\U00010b7f\U00010ba9-\U00010baf\U00010cfa-\U00010cff\U00010d30-\U00010d39\U00010d40-\U00010d49\U00010e60-\U00010e7e\U00010f1d-\U00010f26\U00010f51-\U00010f54\U00010fc5-\U00010fcb\U00011052-\U0001106f\U000110f0-\U000110f9\U00011136-\U0001113f\U000111d0-\U000111d9\U000111e1-\U000111f4\U000112f0-\U000112f9\U00011450-\U00011459\U000114d0-\U000114d9\U00011650-\U00011659\U000116c0-\U000116c9\U000116d0-\U000116e3\U00011730-\U0001173b\U000118e0-\U000118f2\U00011950-\U00011959\U00011bf0-\U00011bf9\U00011c50-\U00011c6c\U00011d50-\U00011d59\U00011da0-\U00011da9\U00011de0-\U00011de9\U00011f50-\U00011f59\U00011fc0-\U00011fd4\U00012400-\U0001246e\U00016130-\U00016139\U00016a60-\U00016a69\U00016ac0-\U00016ac9\U00016b50-\U00016b59\U00016b5b-\U00016b61\U00016d70-\U00016d79\U00016e80-\U00016e96\U00016ff4-\U00016ff6\U0001ccf0-\U0001ccf9\U0001d2c0-\U0001d2d3\U0001d2e0-\U0001d2f3\U0001d360-\U0001d378\U0001d7ce-\U0001d7ff\U0001e140-\U0001e149\U0001e2f0-\U0001e2f9\U0001e4f0-\U0001e4f9\U0001e5f1-\U0001e5fa\U0001e8c7-\U0001e8cf\U0001e950-\U0001e959\U0001ec71-\U0001ecab\U0001ecad-\U0001ecaf\U0001ecb1-\U0001ecb4\U0001ed01-\U0001ed2d\U0001ed2f-\U0001ed3d\U0001f100-\U0001f10c\U0001fbf0-\U0001fbf9]+$rx$;
$$;

CREATE FUNCTION nv_doctor_names.clean_spacing(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT normalize(btrim(regexp_replace(value COLLATE pg_catalog."und-x-icu", $rx$[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028-\u2029\u202f\u205f\u3000\ufeff]+$rx$, ' ', 'g')), NFC);
$$;

CREATE FUNCTION nv_doctor_names.normalize_name(value text, preserve_capitalization boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE
  clean text := nv_doctor_names.clean_spacing(regexp_replace(value COLLATE pg_catalog."und-x-icu", nv_doctor_names.number_pattern(), '', 'g'));
  words text[];
  word_index integer;
  letter_index integer;
  letter text;
  initial text;
BEGIN
  IF preserve_capitalization OR clean = '' THEN RETURN clean; END IF;
  words := string_to_array(lower(clean COLLATE pg_catalog."und-x-icu"), ' ');
  FOR word_index IN 1..cardinality(words) LOOP
    IF word_index > 1 AND words[word_index] IN ('de', 'da', 'do', 'das', 'dos', 'e') THEN CONTINUE; END IF;
    FOR letter_index IN 1..length(words[word_index]) LOOP
      IF letter_index <> 1 AND substr(words[word_index], letter_index - 1, 1) NOT IN ('-', '‐', '‑', '''', '’', 'ʼ') THEN
        CONTINUE;
      END IF;
      letter := substr(words[word_index], letter_index, 1);
      initial := CASE WHEN letter = 'ß' THEN 'ẞ' ELSE upper(letter COLLATE pg_catalog."und-x-icu") END;
      IF length(initial) = 1 THEN
        words[word_index] := overlay(words[word_index] placing initial from letter_index for 1);
      END IF;
    END LOOP;
  END LOOP;
  RETURN normalize(array_to_string(words, ' '), NFC);
END;
$$;

CREATE FUNCTION nv_doctor_names.is_valid(value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(length(value) BETWEEN 3 AND 150 AND value COLLATE pg_catalog."und-x-icu" ~
    replace($rx$^[[:alpha:]]{mark}*(?:[[:alpha:]]{mark}*|[ 'ʼ‐‑’-][[:alpha:]]{mark}*)*\Z$rx$,
      '{mark}', $rx$[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7-\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u07fd\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u0897-\u089f\u08ca-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962-\u0963\u0981-\u0983\u09bc\u09be-\u09c4\u09c7-\u09c8\u09cb-\u09cd\u09d7\u09e2-\u09e3\u09fe\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47-\u0a48\u0a4b-\u0a4d\u0a51\u0a70-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2-\u0ae3\u0afa-\u0aff\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47-\u0b48\u0b4b-\u0b4d\u0b55-\u0b57\u0b62-\u0b63\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0c00-\u0c04\u0c3c\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55-\u0c56\u0c62-\u0c63\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5-\u0cd6\u0ce2-\u0ce3\u0cf3\u0d00-\u0d03\u0d3b-\u0d3c\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62-\u0d63\u0d81-\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2-\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0ebc\u0ec8-\u0ece\u0f18-\u0f19\u0f35\u0f37\u0f39\u0f3e-\u0f3f\u0f71-\u0f84\u0f86-\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f\u109a-\u109d\u135d-\u135f\u1712-\u1715\u1732-\u1734\u1752-\u1753\u1772-\u1773\u17b4-\u17d3\u17dd\u180b-\u180d\u180f\u1885-\u1886\u18a9\u1920-\u192b\u1930-\u193b\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f\u1ab0-\u1add\u1ae0-\u1aeb\u1b00-\u1b04\u1b34-\u1b44\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1be6-\u1bf3\u1c24-\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf4\u1cf7-\u1cf9\u1dc0-\u1dff\u20d0-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099-\u309a\ua66f-\ua672\ua674-\ua67d\ua69e-\ua69f\ua6f0-\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua82c\ua880-\ua881\ua8b4-\ua8c5\ua8e0-\ua8f1\ua8ff\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9e5\uaa29-\uaa36\uaa43\uaa4c-\uaa4d\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7-\uaab8\uaabe-\uaabf\uaac1\uaaeb-\uaaef\uaaf5-\uaaf6\uabe3-\uabea\uabec-\uabed\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\U000101fd\U000102e0\U00010376-\U0001037a\U00010a01-\U00010a03\U00010a05-\U00010a06\U00010a0c-\U00010a0f\U00010a38-\U00010a3a\U00010a3f\U00010ae5-\U00010ae6\U00010d24-\U00010d27\U00010d69-\U00010d6d\U00010eab-\U00010eac\U00010efa-\U00010eff\U00010f46-\U00010f50\U00010f82-\U00010f85\U00011000-\U00011002\U00011038-\U00011046\U00011070\U00011073-\U00011074\U0001107f-\U00011082\U000110b0-\U000110ba\U000110c2\U00011100-\U00011102\U00011127-\U00011134\U00011145-\U00011146\U00011173\U00011180-\U00011182\U000111b3-\U000111c0\U000111c9-\U000111cc\U000111ce-\U000111cf\U0001122c-\U00011237\U0001123e\U00011241\U000112df-\U000112ea\U00011300-\U00011303\U0001133b-\U0001133c\U0001133e-\U00011344\U00011347-\U00011348\U0001134b-\U0001134d\U00011357\U00011362-\U00011363\U00011366-\U0001136c\U00011370-\U00011374\U000113b8-\U000113c0\U000113c2\U000113c5\U000113c7-\U000113ca\U000113cc-\U000113d0\U000113d2\U000113e1-\U000113e2\U00011435-\U00011446\U0001145e\U000114b0-\U000114c3\U000115af-\U000115b5\U000115b8-\U000115c0\U000115dc-\U000115dd\U00011630-\U00011640\U000116ab-\U000116b7\U0001171d-\U0001172b\U0001182c-\U0001183a\U00011930-\U00011935\U00011937-\U00011938\U0001193b-\U0001193e\U00011940\U00011942-\U00011943\U000119d1-\U000119d7\U000119da-\U000119e0\U000119e4\U00011a01-\U00011a0a\U00011a33-\U00011a39\U00011a3b-\U00011a3e\U00011a47\U00011a51-\U00011a5b\U00011a8a-\U00011a99\U00011b60-\U00011b67\U00011c2f-\U00011c36\U00011c38-\U00011c3f\U00011c92-\U00011ca7\U00011ca9-\U00011cb6\U00011d31-\U00011d36\U00011d3a\U00011d3c-\U00011d3d\U00011d3f-\U00011d45\U00011d47\U00011d8a-\U00011d8e\U00011d90-\U00011d91\U00011d93-\U00011d97\U00011ef3-\U00011ef6\U00011f00-\U00011f01\U00011f03\U00011f34-\U00011f3a\U00011f3e-\U00011f42\U00011f5a\U00013440\U00013447-\U00013455\U0001611e-\U0001612f\U00016af0-\U00016af4\U00016b30-\U00016b36\U00016f4f\U00016f51-\U00016f87\U00016f8f-\U00016f92\U00016fe4\U00016ff0-\U00016ff1\U0001bc9d-\U0001bc9e\U0001cf00-\U0001cf2d\U0001cf30-\U0001cf46\U0001d165-\U0001d169\U0001d16d-\U0001d172\U0001d17b-\U0001d182\U0001d185-\U0001d18b\U0001d1aa-\U0001d1ad\U0001d242-\U0001d244\U0001da00-\U0001da36\U0001da3b-\U0001da6c\U0001da75\U0001da84\U0001da9b-\U0001da9f\U0001daa1-\U0001daaf\U0001e000-\U0001e006\U0001e008-\U0001e018\U0001e01b-\U0001e021\U0001e023-\U0001e024\U0001e026-\U0001e02a\U0001e08f\U0001e130-\U0001e136\U0001e2ae\U0001e2ec-\U0001e2ef\U0001e4ec-\U0001e4ef\U0001e5ee-\U0001e5ef\U0001e6e3\U0001e6e6\U0001e6ee-\U0001e6ef\U0001e6f5\U0001e8d0-\U0001e8d6\U0001e944-\U0001e94a\U000e0100-\U000e01ef]$rx$), false);
$$;

CREATE FUNCTION nv_doctor_names.validate_name(value text, preserve_capitalization boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE canonical text;
BEGIN
  IF value COLLATE pg_catalog."und-x-icu" ~ nv_doctor_names.number_pattern() THEN
    RAISE EXCEPTION 'O nome do médico não pode conter números. Utilize o campo de CRM para informações de registro profissional.' USING ERRCODE = '22023';
  END IF;
  canonical := nv_doctor_names.normalize_name(value, preserve_capitalization);
  IF NOT nv_doctor_names.is_valid(canonical) THEN
    RAISE EXCEPTION 'Informe um nome de médico válido, com 3 a 150 caracteres.' USING ERRCODE = '22023';
  END IF;
  RETURN canonical;
END;
$$;

ALTER TABLE public.doctors ADD COLUMN name_capitalization_override boolean NOT NULL DEFAULT false;

CREATE FUNCTION nv_doctor_names.guard_doctor_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  prior_override boolean := TG_OP = 'UPDATE' AND OLD.name_capitalization_override;
  staff boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.name, NEW.name_capitalization_override) IS NOT DISTINCT FROM (OLD.name, OLD.name_capitalization_override) THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.name_capitalization_override, false) OR prior_override THEN
    staff := coalesce(public.nv_can_action(NEW.organization_id, 'medicos', 'edit'), false);
    IF NEW.name_capitalization_override IS DISTINCT FROM prior_override AND NOT staff THEN
      RAISE EXCEPTION 'A capitalização manual do nome exige permissão de edição cadastral.' USING ERRCODE = '42501';
    END IF;
    IF NOT staff THEN NEW.name_capitalization_override := false; END IF;
  END IF;
  NEW.name := nv_doctor_names.validate_name(NEW.name, NEW.name_capitalization_override);
  RETURN NEW;
END;
$$;

CREATE TRIGGER nv_a0_doctor_name BEFORE INSERT OR UPDATE OF name, name_capitalization_override ON public.doctors
FOR EACH ROW EXECUTE FUNCTION nv_doctor_names.guard_doctor_name();

CREATE FUNCTION nv_doctor_names.guard_submitted_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  preserve_capitalization boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.submitted_name IS NOT DISTINCT FROM OLD.submitted_name THEN RETURN NEW; END IF;
  SELECT d.name_capitalization_override AND d.name = nv_doctor_names.clean_spacing(NEW.submitted_name)
    INTO preserve_capitalization FROM public.doctors d
    WHERE d.id = NEW.doctor_id AND d.organization_id = NEW.organization_id;
  NEW.submitted_name := nv_doctor_names.validate_name(NEW.submitted_name, coalesce(preserve_capitalization, false));
  RETURN NEW;
END;
$$;

CREATE TRIGGER nv_a0_submitted_name BEFORE INSERT OR UPDATE OF submitted_name ON public.doctor_enrollments
FOR EACH ROW EXECUTE FUNCTION nv_doctor_names.guard_submitted_name();

CREATE OR REPLACE FUNCTION public.nv_doctor_profile(target text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.doctors; e public.doctor_enrollments; personal boolean;
BEGIN
  SELECT * INTO d FROM public.doctors WHERE id = target;
  IF NOT FOUND OR NOT (public.nv_can_action(d.organization_id, 'medicos', 'view') OR public.nv_owns_doctor(d.organization_id, target)) THEN
    RAISE EXCEPTION 'Perfil indisponível.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.doctor_enrollments WHERE doctor_id = target;
  personal := public.nv_can_read_doctor_personal(d.organization_id, target);
  RETURN jsonb_build_object('profile', jsonb_build_object(
    'id', d.id, 'organization_id', d.organization_id, 'name', d.name, 'crm', d.crm, 'crm_uf', d.crm_uf,
    'rqe', d.rqe, 'specialty', d.specialty, 'status', d.status, 'linked_units', d.linked_units,
    'name_capitalization_override', d.name_capitalization_override,
    'contract_model', d.contract_model, 'contract_signed', d.contract_signed, 'updated_at', d.updated_at
  ) || CASE WHEN personal THEN jsonb_build_object('cpf', d.cpf, 'phone', d.phone, 'email', d.email, 'address', d.address)
    ELSE '{}'::jsonb END,
    'can_read_personal', personal, 'specialties', coalesce(e.approved_specialties, '{}'),
    'has_enrollment', e.doctor_id IS NOT NULL, 'enrollment_status', e.status, 'requested_specialties', coalesce(e.requested_specialties, '{}'),
    'can_approve', public.nv_can_action(d.organization_id, 'medicos', 'approve'),
    'can_preserve_name_capitalization', public.nv_can_action(d.organization_id, 'medicos', 'edit'),
    'can_edit', public.nv_can_action(d.organization_id, 'medicos', 'edit') OR public.nv_owns_doctor(d.organization_id, target)
  ) || CASE WHEN personal THEN jsonb_build_object('birth_date', e.birth_date) ELSE '{}'::jsonb END;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_update_doctor_profile_internal(target text,profile jsonb,revision timestamptz,specialties text[] DEFAULT NULL,birth date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.doctors; n public.doctors; staff boolean; catalog jsonb; e public.doctor_enrollments;
BEGIN
 SELECT * INTO d FROM public.doctors WHERE id=target FOR UPDATE;
 staff:=public.nv_can_action(d.organization_id,'medicos','edit');
 IF d.id IS NULL OR NOT(staff OR public.nv_owns_doctor(d.organization_id,target)) THEN RAISE EXCEPTION 'Edição não autorizada.' USING ERRCODE='42501'; END IF;
 IF revision IS NULL OR revision IS DISTINCT FROM d.updated_at THEN RAISE EXCEPTION 'O cadastro mudou. Reabra o formulário antes de salvar.' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(profile) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(profile) k WHERE k NOT IN('name','name_capitalization_override','phone','address','crm','crm_uf','rqe','cpf','specialty','status','contract_model','contract_signed')) THEN
  RAISE EXCEPTION 'Campos não permitidos.' USING ERRCODE='22023';
 END IF;
 IF NOT staff AND (EXISTS(SELECT FROM jsonb_object_keys(profile) k WHERE k NOT IN('name','phone','address')) OR specialties IS NOT NULL OR birth IS NOT NULL) THEN
  RAISE EXCEPTION 'A alteração profissional depende da coordenação.' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT FROM jsonb_each(profile) p WHERE p.value='null'::jsonb AND p.key<>'rqe') THEN RAISE EXCEPTION 'Confira os campos obrigatórios.' USING ERRCODE='22023'; END IF;
 IF profile ? 'name_capitalization_override' AND jsonb_typeof(profile->'name_capitalization_override') <> 'boolean' THEN
  RAISE EXCEPTION 'Informe se deseja preservar a capitalização do nome.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO n FROM jsonb_populate_record(d,profile);
 UPDATE public.doctors SET name=n.name,name_capitalization_override=n.name_capitalization_override,phone=n.phone,address=n.address,crm=n.crm,crm_uf=n.crm_uf,rqe=n.rqe,cpf=n.cpf,
  specialty=n.specialty,status=n.status,contract_model=n.contract_model,contract_signed=n.contract_signed WHERE id=target RETURNING * INTO n;
 SELECT * INTO e FROM public.doctor_enrollments WHERE doctor_id=target FOR UPDATE;
 IF e.status='approved' AND n.specialty IS DISTINCT FROM d.specialty AND NOT n.specialty=ANY(coalesce(specialties,e.approved_specialties)) THEN
  RAISE EXCEPTION 'A especialidade principal precisa estar entre as especialidades autorizadas.' USING ERRCODE='22023'; END IF;
 IF specialties IS NOT NULL AND specialties IS DISTINCT FROM (CASE WHEN e.status='approved' THEN e.approved_specialties ELSE e.requested_specialties END) THEN
  SELECT settings->'specialties' INTO catalog FROM public.organizations WHERE id=d.organization_id;
  IF e.doctor_id IS NULL OR e.status NOT IN('approved','pending','correction_requested') OR NOT staff OR (e.status='approved' AND NOT public.nv_can_action(d.organization_id,'medicos','approve')) THEN RAISE EXCEPTION 'Sem permissão para alterar as especialidades deste credenciamento.' USING ERRCODE='42501'; END IF;
  IF cardinality(specialties) NOT BETWEEN 1 AND 10 OR array_position(specialties,NULL) IS NOT NULL OR
   cardinality(specialties)<>(SELECT count(DISTINCT s) FROM unnest(specialties) s) OR EXISTS(SELECT FROM unnest(specialties) s WHERE NOT(catalog ? s)) OR NOT n.specialty=ANY(specialties) THEN
   RAISE EXCEPTION 'Selecione especialidades válidas, incluindo a principal.' USING ERRCODE='22023'; END IF;
  IF e.status='approved' AND EXISTS(SELECT FROM public.shifts s WHERE s.doctor_id=target AND s.status NOT IN('completed','cancelled') AND public.nv_shift_ends(s)>now() AND NOT s.specialty=ANY(specialties)) THEN
   RAISE EXCEPTION 'Uma especialidade removida está em uso em plantões futuros. Regularize a escala antes de removê-la.' USING ERRCODE='22023'; END IF;
  IF e.status='approved' THEN UPDATE public.doctor_enrollments SET approved_specialties=specialties,requested_specialties=ARRAY(SELECT DISTINCT unnest(requested_specialties||specialties)) WHERE doctor_id=target;
  ELSE UPDATE public.doctor_enrollments SET requested_specialties=specialties WHERE doctor_id=target; END IF;
  INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,changed_fields) VALUES(target,d.organization_id,public.nv_session_actor(),'profile_updated',ARRAY[CASE WHEN e.status='approved' THEN 'approved_specialties' ELSE 'requested_specialties' END]);
 END IF;
 IF birth IS NOT NULL AND birth IS DISTINCT FROM e.birth_date THEN
  IF e.doctor_id IS NULL OR birth>current_date-interval '18 years' OR birth<current_date-interval '120 years' THEN RAISE EXCEPTION 'Confira a data de nascimento.' USING ERRCODE='22023'; END IF;
  UPDATE public.doctor_enrollments SET birth_date=birth WHERE doctor_id=target;
  INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,changed_fields) VALUES(target,d.organization_id,public.nv_session_actor(),'profile_updated',ARRAY['birth_date']);
 END IF;
 -- Keep submitted display/contact values consistent, without changing credential decisions.
 UPDATE public.doctor_enrollments SET submitted_name=CASE WHEN n.name IS DISTINCT FROM d.name THEN n.name ELSE submitted_name END,
  submitted_phone=CASE WHEN n.phone IS DISTINCT FROM d.phone THEN coalesce(n.phone,'') ELSE submitted_phone END
  WHERE doctor_id=target AND (n.name IS DISTINCT FROM d.name OR n.phone IS DISTINCT FROM d.phone);
 IF staff AND n.specialty IS DISTINCT FROM d.specialty THEN
  UPDATE public.doctor_enrollments SET requested_specialties=ARRAY(SELECT DISTINCT unnest(requested_specialties||ARRAY[n.specialty])) WHERE doctor_id=target AND status='pending';
 END IF;
 PERFORM public.nv_sync_enrollment_documents(target);
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_submit_enrollment(org text,full_name text,registration text,uf text,tax_id text,birth date,phone_number text,pix text,specialties text[],banking jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT FROM public.doctors d WHERE d.organization_id=org AND
  (regexp_replace(d.cpf,'[^0-9]','','g')=tax_id OR (ltrim(d.crm,'0')=ltrim(registration,'0') AND upper(d.crm_uf)=upper(uf))
    OR lower(btrim(d.email))=(SELECT lower(email) FROM auth.users WHERE id=public.nv_session_actor()))
  AND NOT EXISTS(SELECT FROM public.doctor_enrollments e WHERE e.doctor_id=d.id AND e.auth_user_id=public.nv_session_actor())) THEN
  RAISE EXCEPTION 'Seu cadastro já existe. Solicite a liberação individual do portal à administração.' USING ERRCODE='42501';
 END IF;
 PERFORM public.nv_submit_enrollment_before_individual_access(org,
   nv_doctor_names.validate_name(full_name),registration,uf,tax_id,birth,phone_number,pix,specialties,banking);
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_portal_enrollments()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('doctor_id', d.id, 'organization_id', o.id, 'organization', o.name,
    'name', CASE WHEN e.status = 'approved' THEN d.name ELSE e.submitted_name END, 'crm', d.crm, 'uf', d.crm_uf, 'cpf', d.cpf, 'phone', e.submitted_phone, 'birth_date', e.birth_date,
    'status', e.status, 'portal_role', e.portal_role, 'review_note', e.review_note, 'legacy_link', e.legacy_link, 'specialties', e.requested_specialties) ORDER BY o.name), '[]'::jsonb)
  FROM public.doctor_enrollments e JOIN public.doctors d ON d.id = e.doctor_id
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE e.auth_user_id = (SELECT public.nv_session_actor()) AND o.status = 'active';
$$;

-- Primary-strength ICU matching flags case and accent variants within a company.
CREATE COLLATION nv_doctor_names.collision_key (provider = icu, locale = 'und-u-ks-level1', deterministic = false);

CREATE TABLE nv_doctor_names.correction_audit (
  run_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('doctors', 'doctor_enrollments')),
  organization_id text NOT NULL,
  doctor_id text NOT NULL,
  original_name text NOT NULL,
  proposed_name text NOT NULL,
  numbers_found text[] NOT NULL,
  enrollment_status text,
  applied_revision timestamptz,
  applied_by name NOT NULL DEFAULT session_user,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  restored_at timestamptz,
  PRIMARY KEY (run_id, source, doctor_id)
);
ALTER TABLE nv_doctor_names.correction_audit ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION nv_doctor_names.preview()
RETURNS TABLE(source text, organization_id text, doctor_id text, original_name text, proposed_name text,
  numbers_found text[], reasons text[], duplicate_doctors bigint, valid boolean, enrollment_status text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH candidates AS MATERIALIZED (
    SELECT 'doctors' AS source, d.organization_id, d.id AS doctor_id, d.name AS original_name,
      nv_doctor_names.normalize_name(d.name, d.name_capitalization_override) AS proposed_name, NULL::text AS enrollment_status
    FROM public.doctors d
    UNION ALL
    SELECT 'doctor_enrollments', e.organization_id, e.doctor_id, e.submitted_name,
      nv_doctor_names.normalize_name(e.submitted_name,
        d.name_capitalization_override AND d.name = nv_doctor_names.clean_spacing(e.submitted_name)), e.status
    FROM public.doctor_enrollments e
    JOIN public.doctors d ON (d.id, d.organization_id) = (e.doctor_id, e.organization_id)
    WHERE e.status IN ('pending', 'correction_requested')
  ), names AS (
    SELECT *, nv_doctor_names.is_valid(c.proposed_name) AS valid_name FROM candidates c
  ), groups AS (
    SELECT n.organization_id, n.proposed_name COLLATE nv_doctor_names.collision_key AS proposed_key,
      count(DISTINCT n.doctor_id) AS doctor_count
    FROM names n WHERE n.valid_name
    GROUP BY n.organization_id, proposed_key
  )
  SELECT n.source, n.organization_id, n.doctor_id, n.original_name, n.proposed_name,
    ARRAY(SELECT match[1] FROM regexp_matches(n.original_name COLLATE pg_catalog."und-x-icu", nv_doctor_names.number_pattern(), 'g') AS match),
    array_remove(ARRAY[
      CASE WHEN n.original_name COLLATE pg_catalog."und-x-icu" ~ nv_doctor_names.number_pattern() THEN 'numbers' END,
      CASE WHEN n.original_name IS DISTINCT FROM nv_doctor_names.clean_spacing(n.original_name) THEN 'spacing_or_unicode' END,
      CASE WHEN n.original_name = upper(n.original_name COLLATE pg_catalog."und-x-icu")
        AND n.original_name <> lower(n.original_name COLLATE pg_catalog."und-x-icu") THEN 'upper_case'
        WHEN n.original_name = lower(n.original_name COLLATE pg_catalog."und-x-icu")
        AND n.original_name <> upper(n.original_name COLLATE pg_catalog."und-x-icu") THEN 'lower_case'
        WHEN n.proposed_name <> nv_doctor_names.normalize_name(n.original_name, true) THEN 'mixed_case' END
    ], NULL),
    coalesce(g.doctor_count, 0), n.valid_name, n.enrollment_status
  FROM names n LEFT JOIN groups g ON g.organization_id = n.organization_id
    AND n.proposed_name COLLATE nv_doctor_names.collision_key = g.proposed_key
  WHERE n.original_name IS DISTINCT FROM n.proposed_name OR NOT n.valid_name;
$$;

CREATE FUNCTION nv_doctor_names.preview_token(comparison jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(comparison::text, 'UTF8')), 'hex');
$$;

CREATE FUNCTION nv_doctor_names.apply_reviewed_names(expected_token text)
RETURNS TABLE(run_id uuid, doctors_updated bigint, enrollments_updated bigint)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  batch uuid := gen_random_uuid();
  comparison jsonb;
  doctor_count bigint;
  enrollment_count bigint;
BEGIN
  LOCK TABLE public.doctors, public.doctor_enrollments IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.source, p.organization_id, p.doctor_id), '[]') INTO comparison
  FROM nv_doctor_names.preview() p;
  IF expected_token IS DISTINCT FROM nv_doctor_names.preview_token(comparison) THEN
    RAISE EXCEPTION 'O cadastro mudou desde a prévia. Gere uma nova comparação antes de corrigir.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO nv_doctor_names.correction_audit
    (run_id, source, organization_id, doctor_id, original_name, proposed_name, numbers_found, enrollment_status)
  SELECT batch, p.source, p.organization_id, p.doctor_id, p.original_name, p.proposed_name, p.numbers_found, p.enrollment_status
  FROM jsonb_to_recordset(comparison) AS p(source text, organization_id text, doctor_id text, original_name text,
    proposed_name text, numbers_found text[], enrollment_status text, valid boolean, duplicate_doctors bigint)
  WHERE p.valid AND p.duplicate_doctors <= 1 AND p.original_name IS DISTINCT FROM p.proposed_name;

  WITH updated AS (
    UPDATE public.doctors d SET name = a.proposed_name
    FROM nv_doctor_names.correction_audit a
    WHERE a.run_id = batch AND a.source = 'doctors' AND (d.id, d.organization_id) = (a.doctor_id, a.organization_id)
      AND d.name = a.original_name
    RETURNING d.id, d.organization_id, d.name, d.updated_at
  )
  UPDATE nv_doctor_names.correction_audit a SET applied_revision = u.updated_at
  FROM updated u
  WHERE a.run_id = batch AND a.source = 'doctors' AND (a.doctor_id, a.organization_id) = (u.id, u.organization_id)
    AND a.proposed_name = u.name;
  GET DIAGNOSTICS doctor_count = ROW_COUNT;

  WITH updated AS (
    UPDATE public.doctor_enrollments e SET submitted_name = a.proposed_name
    FROM nv_doctor_names.correction_audit a
    WHERE a.run_id = batch AND a.source = 'doctor_enrollments'
      AND (e.doctor_id, e.organization_id, e.status) = (a.doctor_id, a.organization_id, a.enrollment_status)
      AND e.submitted_name = a.original_name
    RETURNING e.doctor_id, e.organization_id, e.submitted_name
  )
  SELECT count(*) INTO enrollment_count FROM updated u
  JOIN nv_doctor_names.correction_audit a ON a.run_id = batch AND a.source = 'doctor_enrollments'
    AND (a.doctor_id, a.organization_id, a.proposed_name) = (u.doctor_id, u.organization_id, u.submitted_name);

  IF doctor_count + enrollment_count <> (SELECT count(*) FROM nv_doctor_names.correction_audit a WHERE a.run_id = batch) THEN
    RAISE EXCEPTION 'A correção divergiu da prévia. A transação foi revertida.';
  END IF;
  RETURN QUERY SELECT batch, doctor_count, enrollment_count;
END;
$$;

CREATE FUNCTION nv_doctor_names.restore_names(batch uuid)
RETURNS TABLE(doctors_restored bigint, enrollments_restored bigint, pending_review bigint)
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  doctor_count bigint;
  enrollment_count bigint;
BEGIN
  LOCK TABLE public.doctors, public.doctor_enrollments IN ACCESS EXCLUSIVE MODE NOWAIT;
  -- These triggers remain enabled for every other transaction. This owner-only
  -- rollback restores exact originals, including legacy invalid formatting.
  ALTER TABLE public.doctors DISABLE TRIGGER nv_a0_doctor_name;
  ALTER TABLE public.doctors DISABLE TRIGGER nv_a_doctor_profile_guard;
  ALTER TABLE public.doctor_enrollments DISABLE TRIGGER nv_a0_submitted_name;
  WITH restored AS (
    UPDATE public.doctors d SET name = a.original_name
    FROM nv_doctor_names.correction_audit a
    WHERE a.run_id = batch AND a.source = 'doctors' AND a.restored_at IS NULL
      AND (d.id, d.organization_id, d.name) = (a.doctor_id, a.organization_id, a.proposed_name)
      AND d.updated_at = a.applied_revision
    RETURNING d.id, d.organization_id
  )
  UPDATE nv_doctor_names.correction_audit a SET restored_at = clock_timestamp()
  FROM restored r WHERE a.run_id = batch AND a.source = 'doctors'
    AND (a.doctor_id, a.organization_id) = (r.id, r.organization_id);
  GET DIAGNOSTICS doctor_count = ROW_COUNT;

  WITH restored AS (
    UPDATE public.doctor_enrollments e SET submitted_name = a.original_name
    FROM nv_doctor_names.correction_audit a
    WHERE a.run_id = batch AND a.source = 'doctor_enrollments' AND a.restored_at IS NULL
      AND (e.doctor_id, e.organization_id, e.submitted_name, e.status) =
        (a.doctor_id, a.organization_id, a.proposed_name, a.enrollment_status)
    RETURNING e.doctor_id, e.organization_id
  )
  UPDATE nv_doctor_names.correction_audit a SET restored_at = clock_timestamp()
  FROM restored r WHERE a.run_id = batch AND a.source = 'doctor_enrollments'
    AND (a.doctor_id, a.organization_id) = (r.doctor_id, r.organization_id);
  GET DIAGNOSTICS enrollment_count = ROW_COUNT;
  ALTER TABLE public.doctors ENABLE TRIGGER nv_a0_doctor_name;
  ALTER TABLE public.doctors ENABLE TRIGGER nv_a_doctor_profile_guard;
  ALTER TABLE public.doctor_enrollments ENABLE TRIGGER nv_a0_submitted_name;

  RETURN QUERY SELECT doctor_count, enrollment_count,
    (SELECT count(*) FROM nv_doctor_names.correction_audit a WHERE a.run_id = batch AND a.restored_at IS NULL);
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nv_doctor_names FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA nv_doctor_names FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
