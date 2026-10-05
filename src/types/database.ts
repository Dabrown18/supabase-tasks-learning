/**
 * TypeScript types describing the Postgres schema.
 *
 * In a real project you GENERATE this file from the database instead of
 * writing it by hand, so it can never drift from the migrations:
 *
 *   npm run db:types        (runs `supabase gen types typescript --linked`)
 *
 * It was hand-written here (in the exact shape the generator produces) so the
 * project type-checks before you have created a Supabase project. Once your
 * project is linked, run the command above and it will overwrite this file.
 *
 * Passing `Database` to `createClient<Database>()` makes every query typed:
 * `supabase.from('tasks').select()` returns `Task[]`, a typo in a column name
 * is a compile error, and `supabase.rpc('get_task_stats')` knows its return.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      tasks: {
        // Row: what SELECT returns.
        Row: {
          id: string;
          user_id: string;
          title: string;
          completed: boolean;
          created_at: string;
          updated_at: string;
        };
        // Insert: what INSERT accepts. Columns with defaults are optional —
        // including user_id, which defaults to auth.uid() in Postgres.
        Insert: {
          id?: string;
          user_id?: string;
          title: string;
          completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        // Update: what UPDATE accepts. Everything optional.
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_task_stats: {
        Args: never;
        // `returns table (...)` in SQL becomes an array of rows here.
        Returns: {
          total_count: number;
          completed_count: number;
          incomplete_count: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// Convenience aliases used throughout the app.
export type Task = Database['public']['Tables']['tasks']['Row'];
export type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
export type TaskUpdate = Database['public']['Tables']['tasks']['Update'];
export type TaskStats =
  Database['public']['Functions']['get_task_stats']['Returns'][number];
