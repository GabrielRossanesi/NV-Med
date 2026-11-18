BEGIN;
DO $$ DECLARE extension text; BEGIN
 FOREACH extension IN ARRAY ARRAY['pdf','jpg','jpeg','png','doc','docx','heif','pages','mht']LOOP
  IF NOT public.nv_document_path_matches('tenant','doctor','tenant/doctor/file.'||extension)THEN
   RAISE EXCEPTION 'FAIL: original document path rejected';
  END IF;
 END LOOP;
 IF public.nv_document_path_matches('tenant','doctor','other/doctor/file.docx')
  OR public.nv_document_path_matches('tenant','doctor','tenant/other/file.docx')
  OR public.nv_document_path_matches('tenant','doctor','tenant/doctor/../file.docx')
  OR public.nv_document_path_matches('tenant','doctor','tenant/doctor/file.docx.exe')
  OR public.nv_document_path_matches('tenant','doctor','tenant/doctor/file.html')
  OR public.nv_document_path_matches('tenant','doctor','tenant/doctor/file.svg')THEN
  RAISE EXCEPTION 'FAIL: unsafe document path accepted';
 END IF;
 IF EXISTS(SELECT FROM storage.buckets WHERE id='medical-documents'AND public)THEN
  RAISE EXCEPTION 'FAIL: document bucket became public';
 END IF;
 IF NOT has_table_privilege('authenticated','public.nv_staff_shifts','SELECT')
  OR has_table_privilege('anon','public.nv_staff_shifts','SELECT')THEN
  RAISE EXCEPTION 'FAIL: staff permissions changed';
 END IF;
END $$;
ROLLBACK;
