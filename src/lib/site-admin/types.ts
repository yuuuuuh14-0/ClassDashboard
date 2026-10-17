export type SchoolManager = { user_id: string; display_name: string; username: string };
export type School = {
  id: string;
  name: string;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  administrators: SchoolManager[];
};
export type AdminAccount = SchoolManager & { school_id: string | null };
export type SiteAdminSnapshot = {
  schools: School[];
  accounts: AdminAccount[];
  active_accounts: number;
  recent_changes: { id: string; action: string; created_at: string; school_name: string; actor_name: string }[];
  updated_at: string;
};

export type AdminMutation =
  | { action: "create_school"; name: string }
  | { action: "save_school"; id: string; name: string; version: number; active?: boolean }
  | { action: "set_manager"; id: string; user_id: string; version: number; assign: boolean };
