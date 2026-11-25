# Nomes de médicos

O cadastro persistido em `public.doctors.name` é a fonte para exibição em escalas, Portal Médico, seletores, relatórios e financeiro. Em credenciamentos em análise, o Portal e a fila administrativa usam o nome submetido. Documentos, notificações já emitidas e outros registros históricos mantêm seus valores originais.

- Formate no formulário depois da digitação, ao sair do campo ou ao salvar. Use `src/lib/doctorName.ts` nas entradas da aplicação. A migration `54_doctor_name_normalization.sql` aplica a regra nas duas tabelas, inclusive para integrações que gravam via Supabase.
- Use a inicial de cada parte em maiúscula e as demais em minúsculas. Partículas isoladas `de`, `da`, `do`, `das`, `dos`, `e` ficam em minúsculas depois da primeira palavra. Preserve grafia, acentos, apóstrofos e hífens. Colapse espaços Unicode e normalize sua representação em NFC.
- Valide de 3 a 150 caracteres após a limpeza. Nos cadastros novos, peça a correção de nomes com números e oriente o uso do CRM. Em importações, revise as linhas rejeitadas antes de reenviar. Preserve o texto original de planilhas e documentos na origem. A rotina de revisão legada identifica os trechos numéricos e os remove dos casos elegíveis, sem preencher o CRM.
- A opção **Preservar a capitalização informada** fica na edição administrativa para quem tem `medicos/edit`. Ela mantém a caixa informada, com a mesma validação de caracteres e espaços. Uma alteração de nome pelo próprio médico volta à regra padrão.
- Use `doctorNameSearchKey` para buscar nomes sem depender de caixa, acento ou espaçamento. Use os campos de registro para pesquisar CRM e RQE.

## Correção de cadastros existentes

1. Aplique a migration 54. Ela cria o esquema privado, as regras de gravação e as rotinas operacionais.
2. Execute [doctor-names.preflight.sql](../supabase/doctor-names.preflight.sql) com o proprietário do banco. Apresente as contagens e gere, para acesso administrativo restrito, a comparação com o trecho numérico e as possíveis duplicidades.

   ```sql
   SELECT * FROM nv_doctor_names.preview()
   ORDER BY source, organization_id, doctor_id;
   ```

   A comparação contém dados pessoais. Mantenha-a em local restrito, fora do controle de versão. Valores inválidos ou nomes potencialmente duplicados na mesma empresa aguardam revisão individual.

3. Aplique o token da comparação já revisada.

   ```sql
   SELECT * FROM nv_doctor_names.apply_reviewed_names('<token_da_prévia>');
   ```

   Se a base divergir, gere outra prévia. O lote grava os valores originais e propostos em `nv_doctor_names.correction_audit` antes da atualização. A revisão técnica do cadastro é atualizada pelo trigger existente para invalidar formulários desatualizados. A correção grava somente as colunas de nome e mantém os vínculos e os credenciamentos consolidados.

4. Confira as contagens com a prévia novamente. Se necessário, restaure um lote pelo seu ID.

   ```sql
   SELECT * FROM nv_doctor_names.restore_names('<id_do_lote>'::uuid);
   ```

   A restauração exige que o valor atual ainda corresponda ao valor aplicado. Para médicos, ela confere também a revisão, e para credenciamentos, a situação. Diferenças ficam pendentes para análise. A rotina exige acesso exclusivo imediato às tabelas e aborta se estiverem ocupadas.

O laboratório `scripts/test-database.ps1` verifica integridade e rollback com registros sintéticos. Atualize os testes JavaScript e SQL ao alterar a convenção, incluindo as faixas Unicode correspondentes quando mudar a regra de caracteres.
