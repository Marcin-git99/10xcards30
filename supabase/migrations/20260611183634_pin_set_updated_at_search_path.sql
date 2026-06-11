-- Review fix F1 (db-schema-mvp impl-review): pin search_path on set_updated_at()
-- to clear the Supabase advisor warning "function_search_path_mutable".
-- The function body only touches NEW, so an empty search_path is safe.
alter function set_updated_at() set search_path = '';
