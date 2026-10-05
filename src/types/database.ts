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
      push_tokens: {
        Row: {
          token: string;
          user_id: string;
          platform: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          token: string;
          user_id: string;
          platform: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          token?: string;
          user_id?: string;
          platform?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      task_reminders: {
        Row: { task_id: string; sent_at: string };
        Insert: { task_id: string; sent_at?: string };
        Update: { task_id?: string; sent_at?: string };
        Relationships: [];
      };
      health_daily_summary: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          steps: number;
          workout_minutes: number;
          sleep_minutes: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          date: string;
          steps?: number;
          workout_minutes?: number;
          sleep_minutes?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          date?: string;
          steps?: number;
          workout_minutes?: number;
          sleep_minutes?: number | null;
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
      register_push_token: {
        Args: { p_token: string; p_platform: string };
        Returns: undefined;
      };
      claim_due_task_reminders: {
        Args: { p_older_than?: string; p_limit?: number };
        Returns: {
          user_id: string;
          task_id: string;
          title: string;
          created_at: string;
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
export type HealthDailySummary = Database['public']['Tables']['health_daily_summary']['Row'];
export type HealthDailySummaryInsert =
  Database['public']['Tables']['health_daily_summary']['Insert'];
export type TaskStats =
  Database['public']['Functions']['get_task_stats']['Returns'][number];
