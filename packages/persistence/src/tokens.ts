export type StoredApiToken = {
  token: string;
  name: string;
  accounts: string[];
  is_admin: boolean;
  created_at: string;
};

export type StoredApiTokenInput = Omit<StoredApiToken, 'created_at'> & {
  created_at?: string;
};
