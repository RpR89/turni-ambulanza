/*
 * Collegamento al back end Supabase.
 *
 * Copia qui i due valori da Supabase → Project Settings → API:
 *   - Project URL            → supabaseUrl
 *   - anon / public key      → supabaseAnonKey
 * Sono pubblici per natura (finiscono comunque nel browser): la sicurezza è garantita
 * dalle regole del database (supabase/schema.sql). NON mettere qui la chiave "service_role".
 *
 * Lasciandoli vuoti l'app funziona come prima: senza login, con i dati nel browser.
 */
window.APP_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  allowedDomain: 'critn.it',
  organization: 'Croce Rossa Italiana',
  committee: 'Comitato di Trento'
};
